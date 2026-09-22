"""
Stripe subscriptions and the credit allowance they fund.

Model
-----
* One subscription per user, monthly, billed by Stripe.
* Each **paid invoice** resets the user's allowance to the plan's credit count.
  Leftover credits do **not** roll over — the reset overwrites, it does not add.
* `users.credits_balance` therefore means "plan credits remaining in the current
  period". Temporary credits live separately in `temp_credits_balance` and are
  consumed first (credits.py).
* `users.credits_used_current_period` counts consumption against the allowance,
  including consumption paid for by temporary credits. That is what lets the
  progress bar read above 100%.

Webhook handling
----------------
Every event is recorded in `stripe_events` (primary key = Stripe's event id) and
claimed before it is processed. Stripe retries aggressively; without the claim,
one `invoice.paid` would grant a month of credits twice. If a handler fails, the
claim is released and a 5xx is returned so Stripe retries — a claim is never
allowed to swallow an event that was not actually processed.

Streamer payouts
----------------
`process_referral_purchase` (SQL, from the retired one-off purchase flow) is no
longer called. Payouts for subscription revenue are computed here instead, in
`_payout_streamers`, mirroring the percentages that function used. It is the only
place streamer rewards are calculated now, so the SQL function is legacy.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import stripe
from flask import current_app

import db
import plans
import sessions
from constants import REVOKE_SUBSCRIPTION_DELETED, SUBSCRIPTION_STATUSES, TX_SUBSCRIPTION_GRANT
from credits import record_transaction

logger = logging.getLogger(__name__)


def _ts(value) -> str | None:
    """Convert a Stripe unix timestamp to an ISO-8601 UTC string."""
    if value in (None, ""):
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def _id_of(value) -> str | None:
    """Stripe fields are sometimes an id, sometimes an expanded object."""
    if isinstance(value, dict):
        return value.get("id")
    return value or None


# ── Stripe configuration ────────────────────────────────────────────────────

def configure_stripe():
    key = current_app.config["STRIPE_SECRET_KEY"]
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY is not configured")
    stripe.api_key = key
    return stripe


def ensure_customer(user: dict) -> str:
    """
    Return the user's Stripe customer id, creating the customer if needed.

    Stored on `users.stripe_customer_id` so the billing portal and future
    invoices can always be traced back to an account.
    """
    stripe = configure_stripe()
    existing = user.get("stripe_customer_id")
    if existing:
        return existing

    customer = stripe.Customer.create(
        email=user.get("email"),
        metadata={"user_id": str(user["id"])},
    )
    db.require_client().table("users").update({"stripe_customer_id": customer["id"]}).eq(
        "id", user["id"]
    ).execute()
    logger.info("Created Stripe customer for user %s", user["id"])
    return customer["id"]


# ── Checkout and portal ─────────────────────────────────────────────────────

def create_subscription_checkout(user: dict, plan_id: str) -> dict:
    """
    Start a monthly subscription checkout for `plan_id`.

    `plan_id` is copied onto the subscription's metadata so later webhooks can
    resolve the plan without guessing from the price — which matters during a
    promotion or a price migration.

    The return URLs are absolute and come from configuration, not from the
    caller's `Origin`. Two reasons: a subscription belongs to SilverGate, so the
    user should land on SilverGate's own account page even if a platform started
    the checkout — and a return URL built from a request header is a redirect an
    attacker can aim. `?subscription=success` / `=cancel` is what the account page
    reads to show its banner.
    """
    stripe = configure_stripe()
    price_id = plans.price_id_for(plan_id)
    if not price_id:
        raise LookupError(f"Plan '{plan_id}' has no Stripe price configured")

    cfg = current_app.config
    customer_id = ensure_customer(user)
    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        automatic_tax={"enabled": True},
        # Stripe Tax needs a location to tax by, and the Customer we create has
        # none. Without this Stripe rejects the entire session with
        # `customer_tax_location_invalid`, so checkout failed for *every* user, not
        # just the first. `auto` writes the billing address the payer enters in
        # Checkout back onto the Customer, which satisfies the tax lookup here and
        # means later invoices are taxed from the same address.
        customer_update={"address": "auto"},
        client_reference_id=str(user["id"]),
        success_url=cfg["CHECKOUT_SUCCESS_URL"],
        cancel_url=cfg["CHECKOUT_CANCEL_URL"],
        allow_promotion_codes=True,
        metadata={"user_id": str(user["id"]), "plan_id": plan_id},
        subscription_data={
            "metadata": {"user_id": str(user["id"]), "plan_id": plan_id},
        },
    )
    return {"session_id": session.id, "url": session.url}


def create_portal_session(user: dict, return_url: str) -> dict:
    """Stripe's hosted portal: change plan, update card, cancel."""
    stripe = configure_stripe()
    customer_id = ensure_customer(user)
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return {"url": session.url}


# ── Subscription record ─────────────────────────────────────────────────────

def upsert_subscription(user_id: str, subscription: dict, *, plan_id: str | None = None) -> dict:
    """
    Write the subscription row for a user.

    `plan_id` is resolved from, in order: the caller, the subscription metadata,
    then the price ID. Never from the amount paid.
    """
    resolved_plan = (
        plan_id
        or (subscription.get("metadata") or {}).get("plan_id")
        or plans.plan_id_for_price_id(_price_id_of(subscription))
    )
    spec = plans.get(resolved_plan)

    items = (subscription.get("items") or {}).get("data") or []
    price_id = _price_id_of(subscription)

    status = (subscription.get("status") or "unknown").lower()
    if status not in SUBSCRIPTION_STATUSES:
        logger.warning("Storing an unrecognised Stripe subscription status: %r", status)

    row = {
        "user_id": user_id,
        "plan_id": resolved_plan or "unknown",
        "status": status,
        "stripe_customer_id": _id_of(subscription.get("customer")),
        "stripe_subscription_id": subscription.get("id"),
        "stripe_price_id": price_id,
        "credits_per_period": int(spec["credits"]) if spec else 0,
        "current_period_start": _ts(subscription.get("current_period_start")),
        "current_period_end": _ts(subscription.get("current_period_end")),
        "cancel_at_period_end": bool(subscription.get("cancel_at_period_end")),
        "started_at": _ts(subscription.get("start_date")),
        "canceled_at": _ts(subscription.get("canceled_at")),
        "updated_at": sessions.now_iso(),
    }

    if not items:
        logger.warning("Subscription %s has no items; no price recorded.", subscription.get("id"))

    db.require_client().table("subscriptions").upsert(row, on_conflict="user_id").execute()
    return row


def _price_id_of(subscription: dict) -> str | None:
    """The subscription's price id. `price` may be expanded or an id."""
    items = (subscription.get("items") or {}).get("data") or []
    if not items:
        return None
    return _id_of(items[0].get("price"))


def find_user_id(subscription: dict) -> str | None:
    """Resolve the owning user: metadata first, then the Stripe customer id."""
    from_metadata = (subscription.get("metadata") or {}).get("user_id")
    if from_metadata:
        return str(from_metadata)

    customer_id = _id_of(subscription.get("customer"))
    if not customer_id:
        return None

    result = (
        db.require_client()
        .table("users")
        .select("id")
        .eq("stripe_customer_id", customer_id)
        .limit(1)
        .execute()
    )
    return str(result.data[0]["id"]) if result.data else None


# ── Granting the period allowance ───────────────────────────────────────────

def grant_period_allowance(user_id: str, plan_id: str, *, invoice_id: str | None = None) -> int:
    """
    Reset a user's allowance for a new billing period.

    This is an overwrite, not an addition: leftover credits do not roll over. The
    usage counter is zeroed with it, which is what makes the progress bar start
    the period empty.
    """
    spec = plans.get(plan_id)
    if not spec:
        logger.error("Cannot grant an allowance for unknown plan '%s'", plan_id)
        return 0

    allowance = int(spec["credits"])
    db.require_client().table("users").update(
        {
            "credits_balance": allowance,
            "credits_used_current_period": 0,
        }
    ).eq("id", user_id).execute()

    # Record which invoice produced this allowance. Only this function writes it,
    # which is what makes it a reliable "already granted" marker for
    # `_on_invoice_paid` — unlike `current_period_start`, which other handlers also
    # write. Best effort: if it fails, a retry would re-grant, which is preferable
    # to not granting at all.
    if invoice_id:
        try:
            db.require_client().table("subscriptions").update(
                {"last_granted_invoice_id": invoice_id}
            ).eq("user_id", user_id).execute()
        except Exception as exc:
            logger.warning(
                "Could not record the granting invoice id for %s: %s", user_id, exc
            )

    record_transaction(
        db.require_client(),
        user_id,
        allowance,
        TX_SUBSCRIPTION_GRANT,
        f"{spec.get('name', plan_id)} plan allowance for the new billing period",
    )
    logger.info(
        "Granted %s credits to user %s for plan %s (invoice=%s)",
        allowance,
        user_id,
        plan_id,
        invoice_id,
    )
    return allowance


def revoke_allowance(user_id: str, reason: str) -> None:
    """Zero a lapsed plan's remaining credits. Temporary credits are untouched."""
    db.require_client().table("users").update({"credits_balance": 0}).eq("id", user_id).execute()
    logger.info("Revoked plan credits for user %s (%s)", user_id, reason)


# ── Streamer payouts ────────────────────────────────────────────────────────

def payout_streamers(user_id: str, amount_paid: float) -> None:
    """
    Pay the referring streamer (and its manager chain) a share of subscription
    revenue.

    Mirrors the percentages the retired `process_referral_purchase` used and is
    best effort: a payout failure must not roll back a paid subscription.
    """
    if amount_paid <= 0:
        return

    try:
        user = (
            db.require_client()
            .table("users")
            .select("id, referred_by_streamer")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        if not user.data:
            return

        streamer_id = user.data[0].get("referred_by_streamer")
        if not streamer_id:
            return

        to_streamer, to_manager = _percentages()

        _credit_streamer(streamer_id, amount_paid * (to_streamer / 100.0))

        # Walk up the management chain, paying each manager the same manager cut.
        current = streamer_id
        for _ in range(20):  # guard against a cycle in manager_id
            row = (
                db.require_client()
                .table("streamers")
                .select("manager_id, is_managed")
                .eq("streamer_id", current)
                .limit(1)
                .execute()
            )
            if not row.data:
                break

            manager_id = row.data[0].get("manager_id")
            if not manager_id or not row.data[0].get("is_managed"):
                break

            _credit_streamer(manager_id, amount_paid * (to_manager / 100.0))
            current = manager_id
    except Exception as exc:
        logger.error("Streamer payout failed for user %s: %s", user_id, exc)


def _percentages() -> tuple:
    """The configured cut, falling back to the values the SQL function used."""
    try:
        result = db.require_client().table("perc").select("to_streamer, to_manager").limit(1).execute()
        if result.data:
            row = result.data[0]
            if row.get("to_streamer") is not None and row.get("to_manager") is not None:
                return float(row["to_streamer"]), float(row["to_manager"])
    except Exception as exc:
        logger.warning("Could not read perc; using defaults: %s", exc)
    return 10.0, 5.0


def _credit_streamer(streamer_id: str, amount: float) -> None:
    if amount <= 0:
        return
    current = (
        db.require_client()
        .table("streamers")
        .select("balance_available, total_earned")
        .eq("streamer_id", streamer_id)
        .limit(1)
        .execute()
    )
    if not current.data:
        logger.warning("Cannot pay streamer %s: not found", streamer_id)
        return

    row = current.data[0]
    db.require_client().table("streamers").update(
        {
            "balance_available": float(row.get("balance_available") or 0) + amount,
            "total_earned": float(row.get("total_earned") or 0) + amount,
        }
    ).eq("streamer_id", streamer_id).execute()


# ── Webhook plumbing ────────────────────────────────────────────────────────

def claim_event(event: dict) -> bool:
    """
    Record an event and report whether we are the first to see it.

    Returns ``False`` only for a genuine replay — Stripe retries on any non-2xx and
    duplicate delivery is normal, not exceptional.

    Any OTHER failure (database down, network, a schema problem) is re-raised. The
    caller then answers 5xx and Stripe retries the event. Swallowing those as
    "duplicate" would return 200 and permanently drop a paid invoice.
    """
    try:
        db.require_client().table("stripe_events").insert(
            {
                "id": event.get("id"),
                "type": event.get("type"),
                "received_at": sessions.now_iso(),
                "payload": event,
            }
        ).execute()
        return True
    except Exception as exc:
        if _is_duplicate_event(exc):
            return False
        raise


def _is_duplicate_event(exc: Exception) -> bool:
    """Is this the unique-violation from the event id already being stored?"""
    # postgrest-py surfaces the Postgres error code on the exception.
    if getattr(exc, "code", None) == "23505":
        return True

    text = str(exc).lower()
    return "duplicate key" in text or "23505" in text or "already exists" in text


def release_event(event_id: str | None) -> None:
    """Give up a claim so Stripe's retry can process the event properly."""
    if not event_id:
        return
    try:
        db.require_client().table("stripe_events").delete().eq("id", event_id).execute()
    except Exception as exc:
        logger.error("Could not release stripe_events claim %s: %s", event_id, exc)


def handle_event(event: dict) -> None:
    """Dispatch a verified Stripe event. Raises on failure, so Stripe retries."""
    event_type = event.get("type")
    payload = (event.get("data") or {}).get("object") or {}

    handlers = {
        "checkout.session.completed": _on_checkout_completed,
        "invoice.paid": _on_invoice_paid,
        "invoice.payment_failed": _on_invoice_payment_failed,
        "customer.subscription.updated": _on_subscription_updated,
        "customer.subscription.deleted": _on_subscription_deleted,
    }

    handler = handlers.get(event_type)
    if not handler:
        logger.debug("Ignoring unhandled Stripe event type %s", event_type)
        return

    handler(payload)


def _on_checkout_completed(session: dict) -> None:
    """
    Link the Stripe customer and subscription to the account.

    Credits are deliberately NOT granted here. `invoice.paid` is the single
    granting event, so that an initial purchase and a renewal follow exactly the
    same path and cannot double-grant if both events arrive.
    """
    if session.get("mode") != "subscription":
        logger.info("Ignoring a non-subscription checkout session.")
        return

    metadata = session.get("metadata") or {}
    user_id = metadata.get("user_id") or session.get("client_reference_id")
    customer_id = _id_of(session.get("customer"))

    if user_id and customer_id:
        db.require_client().table("users").update({"stripe_customer_id": customer_id}).eq(
            "id", user_id
        ).execute()

    subscription_id = _id_of(session.get("subscription"))
    if user_id and subscription_id:
        stripe = configure_stripe()
        subscription = stripe.Subscription.retrieve(subscription_id)
        upsert_subscription(user_id, subscription, plan_id=metadata.get("plan_id"))


def _on_invoice_paid(invoice: dict) -> None:
    """A paid invoice: sync the subscription and reset the period allowance."""
    subscription_id = _id_of(invoice.get("subscription"))
    if not subscription_id:
        logger.debug("Ignoring a non-subscription invoice.")
        return

    stripe = configure_stripe()
    subscription = stripe.Subscription.retrieve(subscription_id)

    user_id = find_user_id(subscription)
    if not user_id:
        logger.error(
            "Paid invoice %s references subscription %s, but no user owns it.",
            invoice.get("id"),
            subscription_id,
        )
        return

    plan_id = (subscription.get("metadata") or {}).get("plan_id")

    # Dedupe on the INVOICE ID, not on the period start.
    #
    # The period start is also written by `checkout.session.completed` and
    # `customer.subscription.updated`. For a new subscription Stripe commonly
    # delivers `checkout.session.completed` first, which stores the period start —
    # and a period-start guard would then see it as "already granted" and skip the
    # grant entirely. The customer pays and receives no credits. The same collision
    # happens on renewals when `customer.subscription.updated` arrives first.
    # Only the granting path writes `last_granted_invoice_id`, so it is a marker
    # that cannot be set by any other handler.
    invoice_id = invoice.get("id")
    already_granted = _stored_granted_invoice_id(user_id)

    row = upsert_subscription(user_id, subscription, plan_id=plan_id)

    if not row["plan_id"] or row["plan_id"] == "unknown":
        logger.error("Subscription %s maps to no known plan; no credits granted.", subscription_id)
        return

    if invoice_id and already_granted == invoice_id:
        logger.info(
            "Invoice %s has already granted its allowance; skipping.", invoice_id
        )
        return

    # Overwrite, never add: leftover credits do not roll over.
    grant_period_allowance(user_id, row["plan_id"], invoice_id=invoice_id)

    logger.info(
        "Allowance reset for user %s from invoice %s (billing_reason=%s)",
        user_id,
        invoice_id,
        invoice.get("billing_reason"),
    )

    payout_streamers(user_id, (invoice.get("amount_paid") or 0) / 100.0)


def _stored_granted_invoice_id(user_id: str):
    """
    The invoice id that last granted an allowance to this user, or ``None``.

    Returns ``None`` on a read failure, which errs towards granting the credits:
    better to grant one period twice than to leave a paying customer with nothing
    because of a transient database error.
    """
    try:
        result = (
            db.require_client()
            .table("subscriptions")
            .select("last_granted_invoice_id")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.warning("Could not read the stored granted invoice id: %s", exc)
        return None

    return result.data[0].get("last_granted_invoice_id") if result.data else None


def _on_invoice_payment_failed(invoice: dict) -> None:
    """
    A failed payment. The plan is left in place: Stripe retries for days and the
    status is what tells the frontend to warn the user.
    """
    subscription_id = _id_of(invoice.get("subscription"))
    if not subscription_id:
        return

    stripe = configure_stripe()
    subscription = stripe.Subscription.retrieve(subscription_id)
    user_id = find_user_id(subscription)
    if not user_id:
        return

    upsert_subscription(user_id, subscription)
    logger.warning("Payment failed for user %s (subscription %s)", user_id, subscription_id)


def _on_subscription_updated(subscription: dict) -> None:
    """Plan change, cancellation scheduled, or status transition."""
    user_id = find_user_id(subscription)
    if not user_id:
        logger.error("Cannot sync subscription %s: no owning user.", subscription.get("id"))
        return

    row = upsert_subscription(user_id, subscription)
    logger.info(
        "Subscription sync for user %s: plan=%s status=%s cancel_at_period_end=%s",
        user_id,
        row["plan_id"],
        row["status"],
        row["cancel_at_period_end"],
    )


def _on_subscription_deleted(subscription: dict) -> None:
    """The subscription ended: stop the plan, keep the record."""
    user_id = find_user_id(subscription)
    if not user_id:
        return

    upsert_subscription(user_id, subscription)
    revoke_allowance(user_id, REVOKE_SUBSCRIPTION_DELETED)
    logger.info("Subscription ended for user %s", user_id)

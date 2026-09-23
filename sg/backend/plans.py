"""
Plans, usage presentation and the upgrade call to action.

This module is the **single source of truth** for what a user's plan looks like
over the API. `/api/credits` (used by the dashboard), `/api/me`,
`/api/sso/introspect` and the SSO token exchange all call `summarize()`, so a
platform can never see a different picture of a user's allowance than the
dashboard does.

Two things drive the design:

1. **Users are not shown raw credit numbers any more.** They see a progress bar,
   so `usage.percent` is the headline figure. The raw numbers are still returned
   because the admin platform needs them and because a bar with no underlying
   data is impossible to debug.

2. **Temporary credits fill the bar past full.** Consumption is counted against
   the *plan* allowance regardless of which bucket paid for it, so a user who has
   spent their way into bonus credits reads above 100%. That is the intended
   signal that they are running on temporary credits.
"""

from __future__ import annotations

import logging

from flask import current_app

import credits
import sessions
from constants import PLAN_BEARING_STATUSES

logger = logging.getLogger(__name__)

# ── Plan registry ───────────────────────────────────────────────────────────

def _registry() -> dict:
    return current_app.config["PLANS"]


def order() -> list:
    return list(current_app.config["PLAN_ORDER"])


def get(plan_id: str | None) -> dict | None:
    if not plan_id:
        return None
    spec = _registry().get(plan_id)
    return dict(spec) if spec else None


def public(plan_id: str | None) -> dict | None:
    """The API shape of a plan. Never leaks Stripe price IDs."""
    spec = get(plan_id)
    if not spec:
        return None
    return {
        "id": spec["id"],
        "name": spec.get("name", spec["id"].title()),
        "credits_per_period": int(spec.get("credits", 0)),
        "price_cents": int(spec.get("price_cents", 0)),
        "currency": spec.get("currency", "EUR"),
        "price_display": _price_display(spec),
        "interval": "month",
    }


def all_public() -> list:
    """Every plan, cheapest first. What `/api/plans` returns."""
    return [public(plan_id) for plan_id in order() if get(plan_id)]


def next_after(plan_id: str | None) -> dict | None:
    """
    The plan one step above `plan_id`, or the cheapest plan when there is none.
    Returns ``None`` for the top plan — there is nothing to upgrade to.
    """
    plan_ids = order()
    if not plan_ids:
        return None

    if plan_id not in plan_ids:
        return public(plan_ids[0])

    position = plan_ids.index(plan_id)
    if position + 1 >= len(plan_ids):
        return None
    return public(plan_ids[position + 1])


def price_id_for(plan_id: str) -> str:
    spec = get(plan_id) or {}
    return spec.get("stripe_price_id") or ""


def plan_id_for_price_id(price_id: str | None) -> str | None:
    if not price_id:
        return None
    for plan_id, spec in _registry().items():
        if spec.get("stripe_price_id") == price_id:
            return plan_id
    return None


def euro_value_of_credits(credits) -> float:
    """
    The euro value of a credit grant, derived from the plan it matches.

    `transactions` records credits, not money, so any euro figure has to be
    inferred. Matching the granted amount to a plan's allowance gives the real
    price the customer paid; an amount matching no plan (a bonus, a partial
    adjustment) has no defensible price and is valued at zero rather than at an
    invented per-credit rate.
    """
    try:
        credits = int(credits)
    except (TypeError, ValueError):
        return 0.0
    for plan_id in order():
        spec = get(plan_id)
        if spec and int(spec.get("credits", 0)) == credits:
            return int(spec.get("price_cents", 0)) / 100.0
    return 0.0


def _price_display(spec: dict) -> str:
    cents = int(spec.get("price_cents", 0))
    symbol = "€" if spec.get("currency", "EUR").upper() == "EUR" else ""
    return f"{symbol}{cents / 100:.2f}"


# ── Subscription state ──────────────────────────────────────────────────────

def load_subscription(supabase, user_id: str) -> dict | None:
    """
    The user's subscription row, or ``None``.

    Rows are never deleted, so a cancelled subscription is still readable and the
    admin platform can see the history of what someone used to be on.
    """
    try:
        result = (
            supabase.table("subscriptions").select("*").eq("user_id", user_id).limit(1).execute()
        )
    except Exception as exc:
        # A missing `subscriptions` table must not take down /api/session, which
        # every page calls. Degrade to "no plan" and complain loudly.
        logger.error(
            "Could not read subscriptions (has migration 003 been applied?): %s", exc
        )
        return None

    return result.data[0] if result.data else None


def resolve_plan(subscription: dict | None) -> tuple[str | None, bool]:
    """
    Return ``(plan_id, is_currently_providing_credits)``.

    A subscription stops providing credits when its period lapses or its status
    says so — checked lazily here rather than by a scheduled job, so a missed cron
    cannot hand out free months.
    """
    if not subscription:
        return None, False

    plan_id = subscription.get("plan_id")
    if not plan_id or not get(plan_id):
        return None, False

    status = (subscription.get("status") or "").lower()
    if status not in PLAN_BEARING_STATUSES:
        return plan_id, False

    period_end = subscription.get("current_period_end")
    if period_end:
        try:
            if sessions.parse_dt(period_end) < sessions.now():
                return plan_id, False
        except (TypeError, ValueError):
            logger.warning("Unparseable current_period_end: %r", period_end)

    return plan_id, True


# ── The payload everything shares ───────────────────────────────────────────

def summarize(supabase, user: dict) -> dict:
    """
    Everything the API knows about a user's allowance.

    Shape:

        plan     the current subscription, or None
        usage    percent + raw counts. `percent` is what the progress bar shows
        credits  remaining credits, raw. Not for end-user display
        upgrade  the call to action, or None when it should not be shown
    """
    subscription = load_subscription(supabase, user["id"])
    plan_id, is_active = resolve_plan(subscription)
    plan = public(plan_id) if is_active else None

    balances = credits.get_balances(user)
    used = int(user.get("credits_used_current_period") or 0)
    remaining = balances["credits_balance"] + balances["temp_credits"]

    if plan:
        # A paid period: the bar measures consumption against the plan allowance,
        # and going past it is the "now on bonus credits" signal.
        pool = plan["credits_per_period"]
        overfilled = bool(pool) and used > pool
    else:
        # No active plan, so there is no allowance to measure against. The credits
        # the user *does* hold — a signup bonus, a referral, an admin grant — are
        # the pool, and the bar measures progress through them. Without this a free
        # user saw a flat 0% and no bar at all, even while sitting on bonus credits.
        pool = used + remaining
        overfilled = False

    percent = round(used / pool * 100, 1) if pool else 0.0
    threshold = current_app.config["UPGRADE_CTA_THRESHOLD_PERCENT"]

    return {
        "plan": _plan_block(plan, subscription, plan_id),
        "usage": {
            "percent": percent,
            # The bar goes past full when temporary credits have been spent.
            "overfilled": overfilled,
            "credits_used": used,
            # For a paid user this is the plan allowance; for a free user it is the
            # bonus-credit pool, so `percent` is meaningful in both cases.
            "credits_allowance": pool,
        },
        "credits": {
            "plan_remaining": balances["credits_balance"],
            "temporary_remaining": balances["temp_credits"],
            "total_remaining": balances["credits_balance"] + balances["temp_credits"],
            "temporary_grants": balances["temp_grants"],
            "temporary_next_expiry": balances["temp_credits_next_expiry"],
        },
        "upgrade": upgrade_offer(plan_id if is_active else None, percent, threshold),
    }


def allowance_block(supabase, user: dict) -> dict:
    """
    Plan, usage bar and upgrade call to action — nothing else.

    The subset a *platform* renders, as opposed to `summarize`, which also
    carries the raw credit counts for the admin platform. Both live here because
    this module is the single source of truth for plan presentation: a platform
    and the dashboard must never see a different picture of the same allowance.
    """
    summary = summarize(supabase, user)
    return {
        "plan": summary["plan"],
        "usage": summary["usage"],
        "upgrade": summary["upgrade"],
    }


def _plan_block(plan: dict | None, subscription: dict | None, plan_id: str | None) -> dict | None:
    """
    The active plan, or a stub describing a lapsed one so the frontend can say
    "your subscription ended" rather than "you never had one".
    """
    if plan:
        return {
            **plan,
            "active": True,
            "status": (subscription or {}).get("status"),
            "current_period_start": (subscription or {}).get("current_period_start"),
            "current_period_end": (subscription or {}).get("current_period_end"),
            "cancel_at_period_end": bool((subscription or {}).get("cancel_at_period_end")),
        }

    if subscription and plan_id:
        return {
            **public(plan_id),
            "status": subscription.get("status"),
            "current_period_start": subscription.get("current_period_start"),
            "current_period_end": subscription.get("current_period_end"),
            "cancel_at_period_end": bool(subscription.get("cancel_at_period_end")),
            "active": False,
        }

    return None


def upgrade_offer(current_plan_id: str | None, percent: float, threshold: int) -> dict | None:
    """
    The upgrade call to action, or ``None`` when it should not be shown.

    Two cases produce it:

    * the user is at or above `threshold` percent of their allowance and a bigger
      plan exists;
    * the user has no plan at all, in which case it points at the entry plan —
      otherwise nothing on the page prompts them to subscribe.

    A user already on the top plan gets ``None``: there is nothing to sell.
    """
    target = next_after(current_plan_id)
    if not target:
        # Already on the top plan: nothing to sell.
        return None

    if current_plan_id is None:
        reason = "no_plan"
    elif percent >= threshold:
        reason = "within_threshold"
    else:
        return None

    return {
        "show": True,
        "reason": reason,
        "threshold_percent": threshold,
        "next_plan": target,
        # The wording the product asked for, with the plan name filled in — but in
        # **English only**. This service has no locale, so a client that translates
        # its own interface should build the sentence from `next_plan.name` instead;
        # rendering this verbatim is what puts an English label in the middle of a
        # translated page. Kept because not every consumer localises: a platform
        # backend, or a dashboard, may just print it.
        "cta_label": f"Upgrade to {target['name']} to have higher limits",
        "url": current_app.config["STORE_URL"],
    }

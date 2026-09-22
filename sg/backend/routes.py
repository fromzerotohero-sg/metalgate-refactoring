"""
SilverGate public API: accounts, sessions, credits, transactions, billing.

Authentication model
--------------------
`/api/login` (and its alias `/api/auth/login`) mints a **session** and sets the
session cookie. That cookie is the user's only credential, it is scoped to the
brand's registrable domain, and it does not expire until the user logs out — so
signing in on one platform signs the user in on every platform
(architecture/04).

The endpoint also returns a short-lived **access token**. That token is for
platforms, not for browsers: it is what a server-side integration presents while
acting on the user's behalf. Browsers should rely on the cookie alone and should
never be handed a long-lived credential.
"""

from __future__ import annotations

import logging
import secrets
import string
import uuid
from functools import wraps

import stripe
from flask import Blueprint, current_app, g, jsonify, request

import accounts
import auth
import billing
import db
import plans
import referrals
import sessions
from auth_utils import hash_password, verify_password
from constants import (
    REVOKE_ACCOUNT_DELETED,
    REVOKE_LOGOUT,
    REVOKE_LOGOUT_ALL,
    REVOKE_PASSWORD_CHANGE,
    TX_BONUS,
    TX_DEDUCTION,
)
from credits import (
    add_temp_credits,
    consume_credits,
    error_status,
    expire_stale_grants,
    make_grant,
    record_transaction,
)
from extensions import limiter

logger = logging.getLogger(__name__)

bp = Blueprint("api", __name__)


# ── Helpers ─────────────────────────────────────────────────────────────────

def generate_referral_code() -> str:
    """Generate a unique 8-character referral code."""
    alphabet = string.ascii_letters + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        if not (
            db.require_client().table("users").select("id").eq("referral_code", code).execute().data
            or db.require_client().table("tempusers").select("id").eq("referral_code", code).execute().data
        ):
            return code


def internal_api_key_required(view):
    """Guard for the server-to-server credit endpoints."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        if not auth.internal_key_ok():
            logger.warning("Internal API call rejected: missing or invalid key")
            return jsonify({"error": "Unauthorized"}), 401

        return view(*args, **kwargs)

    return wrapper


# ── Stats ───────────────────────────────────────────────────────────────────

@bp.route("/stats/users", methods=["GET"])
def get_user_count():
    """Public signup counter used by the marketing pages."""
    try:
        result = db.require_client().table("users").select("*", count="exact", head=True).execute()
        return jsonify({"count": result.count}), 200
    except Exception as exc:
        logger.error("Error getting user count: %s", exc)
        return jsonify({"count": 0}), 200


# ── Registration ────────────────────────────────────────────────────────────

@bp.route("/register", methods=["POST"])
@limiter.limit("5 per minute")
def register():
    """
    Register into `tempusers` and email a verification link.

    No session is created here. The session is created when the user consumes
    the verification link, so that registering once is enough to stay signed in
    forever (architecture/04 §4).
    """
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    username = (data.get("username") or "").strip()
    tag = (data.get("tag") or "").strip()
    referral_code = (data.get("referral_code") or "").strip()
    redirect_url = (data.get("redirect") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    problem = auth.password_problem(password)
    if problem:
        return jsonify({"error": problem}), 400

    client = db.require_client()
    if (
        client.table("users").select("id").eq("email", email).execute().data
        or client.table("tempusers").select("id").eq("email", email).execute().data
    ):
        return jsonify({"error": "Email already registered"}), 400

    try:
        user_data = {
            "id": str(uuid.uuid4()),
            "email": email,
            "username": username,
            "tag": tag,
            "password_hash": hash_password(password),
            "credits_balance": 0,
            "temp_credits_balance": [
                make_grant(
                    current_app.config["SIGNUP_BONUS_CREDITS"],
                    ttl_days=current_app.config["TEMP_GRANT_TTL_DAYS"],
                )
            ],
            "referral_code": generate_referral_code(),
            "email_verified": False,
            "created_at": sessions.now_iso(),
        }

        if referral_code:
            _apply_referral(user_data, referral_code)

        inserted = client.table("tempusers").insert(user_data).execute()
        user = inserted.data[0]

        try:
            from routes_sso import issue_email_verification

            sent = bool(issue_email_verification(user, redirect_url=redirect_url))
        except Exception as exc:
            logger.error("Failed to issue verification email for %s: %s", email, exc)
            sent = False

        return jsonify(
            {
                "message": "Registration successful",
                "verification_email_sent": sent,
                "user": {
                    "id": str(user["id"]),
                    "email": user.get("email"),
                    "username": user.get("username"),
                    "tag": user.get("tag"),
                    "credits": user.get("credits_balance", 0),
                    "referral_code": user.get("referral_code"),
                    "email_verified": False,
                },
            }
        )
    except Exception as exc:
        logger.error("Registration error for %s: %s", email, exc)
        return jsonify({"error": "Registration failed"}), 500


def _apply_referral(user_data: dict, referral_code: str) -> None:
    """
    Stamp the referring streamer or user onto a pending registration.

    Delegates to `referrals` so that the register form, the emailed-verification
    promotion and Google sign-in all resolve and record a referral the same way.
    Settlement is a separate step: it happens when the registration is verified.
    """
    referrals.attribute(db.require_client(), user_data, referral_code)


# ── Login ───────────────────────────────────────────────────────────────────

@bp.route("/login", methods=["POST"])
@bp.route("/auth/login", methods=["POST"])
@limiter.limit("10 per minute")
def login():
    """
    Sign a user in and establish the session that keeps them signed in
    everywhere, indefinitely, until they log out.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    service = (data.get("service") or "").strip() or auth.service_from_request()

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    return accounts.perform_login(email, password, service)


# ── Sessions ────────────────────────────────────────────────────────────────

@bp.route("/session", methods=["GET"])
@bp.route("/auth/session", methods=["GET"])
@auth.require_session
def get_session():
    """
    Is the caller signed in?

    200 with the user, or 401. The frontend calls this first on every page, which
    is what makes the login form unnecessary for a returning user.
    """
    return jsonify(accounts.public_user(g.user)), 200


@bp.route("/logout", methods=["POST"])
@bp.route("/auth/logout", methods=["POST"])
def logout():
    """
    End the current session. Idempotent.

    Resolves the caller the same way every other endpoint does, so a session
    established with a Bearer credential is revoked as well — not only a cookie
    one.
    """
    try:
        identity = auth.resolve_identity()
        if identity:
            sessions.revoke(db.require_client(), identity["session"]["id"], reason=REVOKE_LOGOUT)
    except Exception as exc:
        logger.warning("Failed to revoke session on logout: %s", exc)

    response = jsonify({"message": "Logged out successfully"})
    auth.clear_session_cookie(response)
    return response


@bp.route("/auth/logout-all", methods=["POST"])
@auth.require_session
def logout_all():
    """End every session for the user, on every platform and device."""
    count = sessions.revoke_all(db.require_client(), g.user["id"], reason=REVOKE_LOGOUT_ALL)
    response = jsonify({"message": "Logged out of all devices", "sessions_revoked": count})
    auth.clear_session_cookie(response)
    return response


@bp.route("/auth/sessions", methods=["GET"])
@auth.require_session
def list_sessions():
    """Devices currently signed in as this user."""
    rows = sessions.list_for_user(db.require_client(), g.user["id"])
    current_id = str(g.session["id"])
    return jsonify(
        {
            "sessions": [
                {
                    "id": str(row["id"]),
                    "current": str(row["id"]) == current_id,
                    "created_at": row.get("created_at"),
                    "last_seen_at": row.get("last_seen_at"),
                    "ip": row.get("ip"),
                    "user_agent": row.get("user_agent"),
                    "service": row.get("service"),
                }
                for row in rows
            ]
        }
    ), 200


@bp.route("/auth/sessions/<session_id>", methods=["DELETE"])
@auth.require_session
def revoke_session(session_id):
    """Sign one other device out."""
    revoked = sessions.revoke_owned(db.require_client(), g.user["id"], session_id, reason=REVOKE_LOGOUT)
    if not revoked:
        return jsonify({"error": "Session not found"}), 404

    response = jsonify({"message": "Session revoked"})
    if str(g.session["id"]) == str(session_id):
        auth.clear_session_cookie(response)
    return response


# ── Profile ─────────────────────────────────────────────────────────────────

def _profile_payload(user: dict) -> dict:
    referrals = (
        db.require_client().table("users").select("id").eq("referred_by", user["id"]).execute()
    )
    referral_count = len(referrals.data or [])
    expire_stale_grants(db.require_client(), user["id"])

    summary = plans.summarize(db.require_client(), user)
    balances = summary["credits"]

    return {
        "id": str(user["id"]),
        "email": user.get("email"),
        "username": user.get("username"),
        "tag": user.get("tag"),
        # Raw credit counts: kept for the admin platform and for debugging. The
        # user-facing UI shows `usage.percent` as a progress bar instead.
        "credits": balances["plan_remaining"],
        "temp_credits": balances["temporary_remaining"],
        "temp_credits_grants": balances["temporary_grants"],
        "temp_credits_next_expiry": balances["temporary_next_expiry"],
        "plan": summary["plan"],
        "usage": summary["usage"],
        "upgrade": summary["upgrade"],
        "referral_code": user.get("referral_code"),
        "referral_count": referral_count,
        # What a referral is worth, so the UI does not hardcode the number.
        "referral_bonus_credits": current_app.config["REFERRAL_BONUS_CREDITS"],
        "referral_earnings": referral_count * current_app.config["REFERRAL_BONUS_CREDITS"],
        "created_at": user.get("created_at"),
    }


@bp.route("/me", methods=["GET"])
@auth.require_session
def get_current_user():
    return jsonify(_profile_payload(g.user)), 200


@bp.route("/profile", methods=["PUT"])
@auth.require_session
def update_profile():
    data = request.get_json(silent=True) or {}
    updates = {}
    if "username" in data:
        updates["username"] = (data.get("username") or "").strip()
    if "tag" in data:
        updates["tag"] = (data.get("tag") or "").strip()

    if not updates:
        return jsonify({"error": "Nothing to update"}), 400

    try:
        db.require_client().table("users").update(updates).eq("id", g.user["id"]).execute()
    except Exception as exc:
        logger.error("Profile update failed for %s: %s", g.user["id"], exc)
        return jsonify({"error": "Update failed"}), 500

    updated = db.require_client().table("users").select("*").eq("id", g.user["id"]).execute()
    return jsonify({"message": "Profile updated", "user": accounts.public_user(updated.data[0])}), 200


@bp.route("/auth/change-password", methods=["POST"])
@auth.require_session
def change_password():
    """
    Change the password while signed in.

    Every other session is revoked, because a password change must invalidate
    anything that was authenticated with the old one.
    """
    data = request.get_json(silent=True) or {}
    current_password = data.get("current_password") or ""
    new_password = data.get("new_password") or ""

    if not current_password or not new_password:
        return jsonify({"error": "current_password and new_password are required"}), 400

    problem = auth.password_problem(new_password)
    if problem:
        return jsonify({"error": problem}), 400

    if not verify_password(g.user.get("password_hash"), current_password)[0]:
        return jsonify({"error": "Current password is incorrect"}), 401

    try:
        db.require_client().table("users").update(
            {"password_hash": hash_password(new_password)}
        ).eq("id", g.user["id"]).execute()
    except Exception as exc:
        logger.error("Password change failed for %s: %s", g.user["id"], exc)
        return jsonify({"error": "Failed to change password"}), 500

    sessions.revoke_all(
        db.require_client(),
        g.user["id"],
        reason=REVOKE_PASSWORD_CHANGE,
        except_session_id=g.session["id"],
    )
    return jsonify({"message": "Password updated. Other devices have been signed out."}), 200


@bp.route("/me", methods=["DELETE"])
@auth.require_session
def delete_account():
    """
    Delete the account.

    Every session is revoked first, so no credential survives the deletion.
    Note: this is a hard delete, matching the behaviour this API already had.
    architecture/07 recommends moving to soft-delete + anonymisation; that is a
    deliberate follow-up, not an oversight.

    The Stripe subscription is cancelled **before** anything is deleted, and the
    deletion is abandoned if that cannot be done. `subscriptions.user_id` cascades
    off `users`, so removing the row destroys the only local record of what to
    cancel — while Stripe keeps billing on its own schedule, with no webhook
    involved, and the user cannot stop it, because cancellation only lives in the
    billing portal behind a session this deletion revokes. Refusing costs them a
    retry; proceeding would cost them money every month, indefinitely.
    """
    user_id = g.user["id"]

    problem = billing.cancel_subscriptions_for_user(user_id)
    if problem:
        # The detail is for the logs. The client only needs to know that nothing was
        # deleted and that trying again is the correct next step.
        logger.error("Refusing to delete %s: %s", user_id, problem)
        return (
            jsonify(
                {
                    "error": "Could not cancel the active subscription, so the account was not deleted",
                    "reason": "subscription_not_cancelled",
                }
            ),
            502,
        )

    try:
        try:
            db.require_client().table("users").update({"referred_by": None}).eq(
                "referred_by", user_id
            ).execute()
        except Exception as exc:
            logger.warning("Failed to unlink referrals for %s: %s", user_id, exc)

        sessions.revoke_all(db.require_client(), user_id, reason=REVOKE_ACCOUNT_DELETED)
        db.require_client().table("transactions").delete().eq("user_id", user_id).execute()
        db.require_client().table("users").delete().eq("id", user_id).execute()

        response = jsonify({"message": "Account deleted successfully"})
        auth.clear_session_cookie(response)
        return response
    except Exception as exc:
        logger.error("Delete account failed for %s: %s", user_id, exc)
        return jsonify({"error": "Failed to delete account"}), 500


@bp.route("/transactions", methods=["GET"])
@auth.require_session
def get_transactions():
    result = (
        db.require_client()
        .table("transactions")
        .select("*")
        .eq("user_id", g.user["id"])
        .order("timestamp", desc=True)
        .limit(50)
        .execute()
    )
    return jsonify(
        {
            "transactions": [
                {
                    "id": row["id"],
                    "amount": row["amount"],
                    "type": row.get("type"),
                    "description": row.get("description"),
                    "status": row.get("status"),
                    "timestamp": row.get("timestamp"),
                }
                for row in (result.data or [])
            ]
        }
    ), 200


# ── Credit administration (server-to-server) ────────────────────────────────

@bp.route("/internal/balance", methods=["POST"])
@bp.route("/user/balance", methods=["POST"])
@internal_api_key_required
def get_user_balance():
    """
    Read a user's allowance and usage, server to server.

    Carries the same plan/usage/upgrade block as `/api/credits`, so a platform
    that only talks to the internal API can still render the bar and the upsell.
    Kept at both paths for compatibility.
    """
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    # select("*") because the usage summary needs the period counter too.
    result = db.require_client().table("users").select("*").eq("id", user_id).execute()
    if not result.data:
        return jsonify({"error": "User not found"}), 404

    user = result.data[0]
    summary = plans.summarize(db.require_client(), user)
    balances = summary["credits"]

    return jsonify(
        {
            "user_id": user_id,
            "balance": balances["plan_remaining"],
            "temp_balance": balances["temporary_remaining"],
            "total_balance": balances["total_remaining"],
            "plan": summary["plan"],
            "usage": summary["usage"],
            "upgrade": summary["upgrade"],
        }
    ), 200


@bp.route("/internal/add", methods=["POST"])
@bp.route("/user/add", methods=["POST"])
@internal_api_key_required
def internal_add_credits():
    """
    Grant temporary credits.

    The caller chooses when they lapse: pass `expires_at` (ISO-8601) or
    `expires_in_days`. Omitting both uses the configured default TTL
    (`SG_TEMP_GRANT_TTL_DAYS`).
    Kept at both paths for compatibility with existing callers.
    """
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")
    amount = data.get("amount")
    description = data.get("description") or "Credit addition"
    expires_at = data.get("expires_at")
    ttl_days = data.get("expires_in_days")

    amount, error = _coerce_credit_request(user_id, amount)
    if error:
        return error

    if ttl_days is not None:
        try:
            ttl_days = int(ttl_days)
        except (TypeError, ValueError):
            return jsonify({"error": "expires_in_days must be an integer"}), 400
    elif not expires_at:
        # Same implicit default as every other grant path, so the configured
        # lifetime is not silently ignored for callers that omit both fields.
        ttl_days = current_app.config["TEMP_GRANT_TTL_DAYS"]

    try:
        result = add_temp_credits(
            db.require_client(), user_id, amount, expires_at=expires_at, ttl_days=ttl_days
        )
        record_transaction(
            db.require_client(), user_id, amount, TX_BONUS, description
        )
        return jsonify(
            {
                "user_id": user_id,
                "amount_added": amount,
                "temp_balance": result["temp_credits"],
                "grant": result["grant"],
            }
        ), 200
    except ValueError as exc:
        return jsonify({"error": str(exc)}), error_status(exc)
    except Exception as exc:
        logger.error("Credit addition failed for %s: %s", user_id, exc)
        return jsonify({"error": "Failed to add credits"}), 500


@bp.route("/internal/deduct", methods=["POST"])
@bp.route("/user/deduct", methods=["POST"])
@internal_api_key_required
def internal_deduct_credits():
    """Spend a user's credits, draining temporary grants first."""
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")
    amount = data.get("amount")
    description = data.get("description") or "Credit deduction"

    amount, error = _coerce_credit_request(user_id, amount)
    if error:
        return error

    try:
        result = consume_credits(db.require_client(), user_id, amount)
        record_transaction(
            db.require_client(), user_id, -amount, TX_DEDUCTION, description
        )

        # Hand back the fresh usage so a platform can update its bar without a
        # second round trip.
        usage = None
        refreshed = db.require_client().table("users").select("*").eq("id", user_id).execute()
        if refreshed.data:
            summary = plans.summarize(db.require_client(), refreshed.data[0])
            usage = summary["usage"]
            upgrade = summary["upgrade"]
        else:
            upgrade = None

        return jsonify(
            {
                "user_id": user_id,
                "amount_deducted": amount,
                "new_balance": result["credits_balance"],
                "temp_balance": result["temp_credits"],
                "usage": usage,
                "upgrade": upgrade,
            }
        ), 200
    except ValueError as exc:
        return jsonify({"error": str(exc)}), error_status(exc)
    except Exception as exc:
        logger.error("Credit deduction failed for %s: %s", user_id, exc)
        return jsonify({"error": "Failed to deduct credits"}), 500


def _coerce_credit_request(user_id, amount):
    """
    Validate a credit request and normalise `amount` to a positive integer.

    Returns ``(amount, error_response)``; exactly one of the two is set. Floats
    and numeric strings are accepted for compatibility with callers that do not
    send a JSON integer, but a non-integral value is rejected rather than
    silently truncated.
    """
    if not user_id or amount is None:
        return None, (jsonify({"error": "user_id and amount required"}), 400)

    if isinstance(amount, bool):
        return None, (jsonify({"error": "amount must be an integer"}), 400)

    if isinstance(amount, float):
        if not amount.is_integer():
            return None, (jsonify({"error": "amount must be a whole number"}), 400)
        amount = int(amount)
    elif isinstance(amount, str):
        try:
            amount = int(amount.strip())
        except ValueError:
            return None, (jsonify({"error": "amount must be an integer"}), 400)
    elif not isinstance(amount, int):
        return None, (jsonify({"error": "amount must be an integer"}), 400)

    if amount <= 0:
        return None, (jsonify({"error": "Amount must be a positive integer"}), 400)

    return amount, None


@bp.route("/internal/expire-grants", methods=["POST"])
@internal_api_key_required
def expire_grants():
    """
    Housekeeping entry point for a scheduled job.

    Previously expired grants were only cleaned up opportunistically when a user
    happened to hit `/api/me`. On serverless that is unreliable, so this exposes
    the operation to Vercel Cron (architecture/02 §3).
    """
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    active = expire_stale_grants(db.require_client(), user_id)
    return jsonify({"user_id": user_id, "active_grants": len(active)}), 200


# ── Plans and usage ─────────────────────────────────────────────────────────

@bp.route("/plans", methods=["GET"])
def list_plans():
    """
    The available monthly plans, cheapest first.

    Public, because the pricing page needs it before anyone is signed in.
    """
    return jsonify({"plans": plans.all_public()}), 200


@bp.route("/credits", methods=["GET"])
@bp.route("/credits/", methods=["GET"])
@bp.route("/plan/usage", methods=["GET"])
@auth.require_session
def get_credits():
    """
    What the user may spend this billing period.

    This is the endpoint both SilverGate's own pages and the SSO platforms call.
    It is deliberately usage-shaped: users see a progress bar, not a credit count.
    The raw numbers remain in the payload because the admin platform needs them
    and because a bar with no underlying data cannot be debugged.

    Auth is the session cookie or a platform access token, so a connected
    platform can call it directly on the signed-in user's behalf.
    """
    return jsonify(plans.summarize(db.require_client(), g.user)), 200


# ── Subscriptions ───────────────────────────────────────────────────────────

@bp.route("/stripe/subscribe", methods=["POST"])
@limiter.limit("10 per minute")
def subscribe():
    """Start a monthly subscription for a plan."""
    data = request.get_json(silent=True) or {}
    plan_id = (data.get("plan_id") or "").strip()

    if not plans.get(plan_id):
        return jsonify(
            {
                "error": "Unknown plan_id",
                "available": [plan["id"] for plan in plans.all_public()],
            }
        ), 400

    if not current_app.config["STRIPE_SECRET_KEY"]:
        return jsonify({"error": "Billing is not configured"}), 503

    identity = auth.resolve_identity()
    if not identity:
        return jsonify({"error": "Sign in before subscribing"}), 401

    try:
        # No Origin involved: the return URLs come from configuration
        # (`billing.create_subscription_checkout`), so a caller cannot aim the
        # post-payment redirect anywhere.
        session = billing.create_subscription_checkout(identity["user"], plan_id)
    except LookupError as exc:
        # The plan exists in config but has no Stripe price yet.
        logger.error("Checkout refused: %s", exc)
        return jsonify({"error": "This plan is not available for purchase yet"}), 503
    except Exception as exc:
        logger.error("Subscription checkout failed for %s: %s", identity["user"]["id"], exc)
        return jsonify({"error": "Failed to start checkout"}), 500

    return jsonify(session), 200


@bp.route("/stripe/portal", methods=["POST"])
@limiter.limit("10 per minute")
@auth.require_session
def create_billing_portal():
    """
    Stripe's hosted portal, for changing plan, updating a card, or cancelling.

    Keeping cancellation in Stripe's own UI means we never store card data and
    never have to reimplement a dunning flow.
    """
    if not current_app.config["STRIPE_SECRET_KEY"]:
        return jsonify({"error": "Billing is not configured"}), 503

    data = request.get_json(silent=True) or {}
    requested = data.get("return_url")
    return_url = requested if auth.is_safe_redirect(requested) else current_app.config["DASHBOARD_URL"]

    try:
        return jsonify(billing.create_portal_session(g.user, return_url)), 200
    except Exception as exc:
        logger.error("Billing portal failed for %s: %s", g.user["id"], exc)
        return jsonify({"error": "Failed to open the billing portal"}), 500


@bp.route("/stripe/cancel", methods=["POST"])
@limiter.limit("10 per minute")
@auth.require_session
def cancel_subscription():
    """
    Stop — or resume — billing at the end of the current period.

    At period end, not immediately: the period the user is in has already been paid
    for, so ending it early would withdraw something they bought and make this a
    refund question. Stripe stops charging, and access lapses on its own.

    `cancel: false` resumes, which is the same Stripe call with the flag cleared. The
    UI only offers cancellation today; the endpoint supports the other direction so
    that offering it is not a new endpoint, a new deploy and a new review.
    """
    if not current_app.config["STRIPE_SECRET_KEY"]:
        return jsonify({"error": "Billing is not configured"}), 503

    data = request.get_json(silent=True) or {}
    cancel = data.get("cancel")
    if not isinstance(cancel, bool):
        cancel = True

    try:
        billing.set_subscription_cancellation(g.user["id"], cancel=cancel)
    except LookupError:
        return jsonify({"error": "There is no active subscription"}), 404
    except Exception as exc:
        logger.error("Could not change the subscription for %s: %s", g.user["id"], exc)
        return jsonify({"error": "Could not update the subscription"}), 500

    return jsonify({"message": "Subscription updated"}), 200


@bp.route("/stripe/invoices", methods=["GET"])
@limiter.limit("30 per minute")
@auth.require_session
def get_invoices():
    """The signed-in user's invoices, newest first, straight from Stripe."""
    # An empty list rather than a 503 when billing is unconfigured: the billing page
    # should still render its other cards, and there is nothing to show either way.
    if not current_app.config["STRIPE_SECRET_KEY"]:
        return jsonify({"invoices": []}), 200

    try:
        return jsonify({"invoices": billing.list_invoices(g.user["id"])}), 200
    except Exception as exc:
        logger.error("Could not list invoices for %s: %s", g.user["id"], exc)
        return jsonify({"error": "Could not load your invoices"}), 500


@bp.route("/stripe/webhook", methods=["POST"])
def stripe_webhook():
    """
    Receive Stripe events.

    Idempotency is handled by claiming the event id in `stripe_events` before
    processing, because Stripe retries on any non-2xx and duplicate delivery is
    normal rather than exceptional. A claim is released if the handler fails, so
    the retry can still do the work — a claim must never swallow an event that was
    not actually processed.
    """
    secret = current_app.config["STRIPE_WEBHOOK_SECRET"]
    if not current_app.config["STRIPE_SECRET_KEY"] or not secret:
        logger.error("Stripe webhook received, but billing is not configured.")
        return jsonify({"error": "Billing is not configured"}), 503

    signature = request.headers.get("stripe-signature")
    if not signature:
        return jsonify({"error": "No signature"}), 400

    try:
        event = stripe.Webhook.construct_event(request.get_data(), signature, secret)
    except ValueError:
        return jsonify({"error": "Invalid payload"}), 400
    except Exception as exc:
        # SignatureVerificationError lives in different places across stripe
        # library versions; construct_event only raises for bad payloads or bad
        # signatures, so this cannot hide a genuine server fault.
        logger.warning("Stripe signature verification failed: %s", exc)
        return jsonify({"error": "Invalid signature"}), 400

    if not billing.claim_event(event):
        logger.info("Ignoring a replayed Stripe event: %s", event.get("id"))
        return jsonify({"status": "duplicate"}), 200

    try:
        billing.handle_event(event)
    except Exception:
        billing.release_event(event.get("id"))
        logger.exception("Failed to process Stripe event %s", event.get("id"))
        return jsonify({"error": "Processing failed"}), 500

    return jsonify({"status": "success"}), 200


# ── Retired one-off purchases ───────────────────────────────────────────────
# These exist only to fail informatively. Removing them outright would produce a
# bare 404 for anything still calling them, which is harder to diagnose than an
# explicit "this moved".

@bp.route("/stripe/packs", methods=["GET"])
@bp.route("/stripe/create-checkout-session", methods=["POST"])
def retired_credit_packs():
    return jsonify(
        {
            "error": "One-time credit packs have been replaced by monthly plans.",
            "plans_endpoint": "/api/plans",
            "subscribe_endpoint": "/api/stripe/subscribe",
        }
    ), 410

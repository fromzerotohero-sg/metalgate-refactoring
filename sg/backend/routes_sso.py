"""
SilverGate SSO: email verification, password reset and platform sign-in.

Three ways a platform can obtain an identity (architecture/04 §6). They exist
because a cookie can only be shared between hosts under the same registrable
domain — and `*.vercel.app` hosts can never share one at all.

  **Path A — same registrable domain.**
  The session cookie is already sent to every `*.brand.com` host, so the
  platform simply asks SilverGate who the user is. Zero redirects, zero visible
  authentication step.

  **Path B — different registrable domain.**
  `/sso/authorize` issues a single-use code, the platform exchanges it at
  `/sso/token`. The user's eternal credential never leaves the brand domain.

  **Path C — server to server.**
  `/sso/introspect` with a platform API key, for backends acting on a user's
  behalf.

The previous deployment handed the *user's* 24-hour JWT to platforms through the
redirect URL (`?token=…`). That is gone: a credential that never expires must
never travel in an address bar, where it is copied into history, `Referer`
headers and server logs.
"""

from __future__ import annotations

import datetime
import hmac
import logging
import secrets
from urllib.parse import quote, urlencode

from flask import Blueprint, current_app, jsonify, redirect, request

import accounts
import auth
import db
import plans
import platforms
import referrals
import sessions
from auth_utils import hash_password
from constants import (
    REVOKE_PASSWORD_RESET,
    TOKEN_TYPE_EMAIL_VERIFICATION,
    TOKEN_TYPE_PASSWORD_RESET,
)
from email_service import EmailService
from extensions import limiter

sso_bp = Blueprint("sso", __name__)

logger = logging.getLogger(__name__)

EMAIL_TOKEN_LIFETIME_HOURS = 24
RESET_TOKEN_LIFETIME_MINUTES = 15
RESET_CODE_LIFETIME_MINUTES = 15
# Wrong guesses allowed against one issued code before it is burned. Six digits is
# 1,000,000 combinations; five attempts makes the guess hopeless without making a
# genuine fat-finger lock the user out.
MAX_RESET_CODE_ATTEMPTS = 5


# ── Email verification ──────────────────────────────────────────────────────

def build_email_verification_link(token: str, redirect_url: str | None = None) -> str:
    """
    Build the link that goes in the verification email.

    With SG_EMAIL_VERIFY_VIA_API enabled the link points straight at the API,
    which verifies the user *and* creates their session in one navigation — the
    user registers once and is never asked to log in (architecture/04 §4).
    Otherwise it points at the frontend page, which posts the token itself.
    """
    if current_app.config["EMAIL_VERIFY_VIA_API"]:
        base = current_app.config["API_PUBLIC_URL"].rstrip("/")
        link = f"{base}/api/auth/verify?token={quote(token)}"
    else:
        base = current_app.config["EMAIL_VERIFICATION_URL"]
        separator = "&" if "?" in base else "?"
        link = f"{base}{separator}token={quote(token)}"

    if redirect_url:
        link += f"&redirect={quote(redirect_url, safe='')}"
    return link


def issue_email_verification(user: dict, redirect_url: str | None = None) -> str:
    """Mint a verification token for a pending registration and email it."""
    token = auth.issue_purpose_token(
        {
            "temp_user_id": str(user["id"]),
            "email": user["email"],
            "type": TOKEN_TYPE_EMAIL_VERIFICATION,
        },
        lifetime=datetime.timedelta(hours=EMAIL_TOKEN_LIFETIME_HOURS),
    )
    link = build_email_verification_link(token, redirect_url=redirect_url)

    EmailService().send_verification_email(
        user_email=user["email"],
        username=user.get("username") or user["email"].split("@")[0],
        verification_link=link,
    )
    return link


def _promote_temp_user(temp_user: dict) -> dict:
    """
    Move a verified registration from `tempusers` into `users`.

    Note: the previous version dropped `temp_credits_balance` on promotion, so
    the signup bonus silently vanished. It is carried across here.
    """
    client = db.require_client()
    now_iso = sessions.now_iso()

    promoted = {
        "id": temp_user["id"],
        "username": temp_user.get("username"),
        "email": temp_user["email"],
        "password_hash": temp_user.get("password_hash"),
        "tag": temp_user.get("tag"),
        "referral_code": temp_user.get("referral_code"),
        "referred_by": temp_user.get("referred_by"),
        "stripe_customer_id": temp_user.get("stripe_customer_id"),
        "credits_balance": temp_user.get("credits_balance", 0),
        "temp_credits_balance": temp_user.get("temp_credits_balance") or [],
        "created_at": temp_user.get("created_at") or now_iso,
        "updated_at": now_iso,
        "email_verified": True,
        "referred_by_streamer": temp_user.get("referred_by_streamer"),
        "has_purchased": temp_user.get("has_purchased", False),
        "last_login": now_iso,
    }

    user = client.table("users").insert(promoted).execute().data[0]

    # Best effort: the column is added by the migration, but verification must
    # not fail if it has not been applied yet.
    try:
        client.table("users").update({"email_verified_at": now_iso}).eq(
            "id", user["id"]
        ).execute()
        user["email_verified_at"] = now_iso
    except Exception as exc:
        logger.warning("Could not set email_verified_at for %s: %s", user["id"], exc)

    _award_referral_bonus(user)

    client.table("tempusers").delete().eq("id", temp_user["id"]).execute()
    return user


def _award_referral_bonus(user: dict) -> None:
    """
    Pay the referrer now that the registration has been verified.

    Delegates to `referrals.settle`, which is the same call the Google path makes
    when it creates an account — the two moments at which a referral is real
    enough to be worth paying, and the only two places it can be paid from.
    """
    referrals.settle(db.require_client(), user)


def _resolve_email_token(token: str):
    """
    Turn a verification token into a live `users` row.

    Returns ``(user, error_response)``; exactly one of the two is set.
    """
    if not token:
        return None, (jsonify({"error": "Verification token required"}), 400)

    payload = auth.decode_purpose_token(token, expected_type=TOKEN_TYPE_EMAIL_VERIFICATION)
    if not payload:
        return None, (jsonify({"error": "Invalid or expired verification token"}), 401)

    client = db.require_client()
    temp_user_id = payload.get("temp_user_id")
    email = (payload.get("email") or "").strip().lower()

    # Already verified: treat as success and sign the user in. This is what a
    # user experiences if they click the link twice.
    active = client.table("users").select("*").eq("email", email).execute()
    if active.data:
        if temp_user_id:
            try:
                client.table("tempusers").delete().eq("id", temp_user_id).execute()
            except Exception:
                pass
        return active.data[0], None

    pending = (
        client.table("tempusers").select("*").eq("id", temp_user_id).eq("email", email).execute()
    )
    if not pending.data:
        return None, (jsonify({"error": "Invalid or expired verification token"}), 401)

    return _promote_temp_user(pending.data[0]), None


def _begin_session_response(user: dict, *, message: str, service: str | None = None):
    """Sign the freshly verified user in and return the standard payload."""
    material, token = accounts.start_session(user, service=service)

    response = jsonify(
        {
            "message": message,
            "token": token,
            "user": accounts.public_user(user),
        }
    )
    auth.set_session_cookie(response, material["token"])
    return response


@sso_bp.route("/sso/verify-code", methods=["POST"])
def verify_code():
    """Retired: verification codes were replaced by emailed links."""
    return (
        jsonify(
            {
                "error": "Verification codes are no longer supported. "
                "Please use the verification link sent by email."
            }
        ),
        410,
    )


@sso_bp.route("/sso/verify-email", methods=["POST"])
@limiter.limit("20 per minute")
def verify_email():
    """Verify a pending registration and sign the user in."""
    data = request.get_json(silent=True) or {}
    user, error = _resolve_email_token(data.get("token"))
    if error:
        return error

    return _begin_session_response(user, message="Email verified successfully"), 200


@sso_bp.route("/auth/verify", methods=["GET"])
@limiter.limit("30 per minute")
def verify_email_link():
    """
    Browser-facing verification endpoint.

    Used when the email link points directly at the API. Creates the session in
    the same navigation, then forwards the user into the app.
    """
    user, error = _resolve_email_token(request.args.get("token"))
    if error:
        return redirect(
            f"{current_app.config['LOGIN_URL']}?verification=failed", code=302
        )

    response = _begin_session_response(user, message="Email verified successfully")
    return auth.redirect_preserving(response, _destination_after_verification())


def _destination_after_verification() -> str:
    """
    Where to send the user after verifying.

    Only same-site destinations are honoured, so an attacker cannot turn the
    verification link into an open redirect.
    """
    requested = request.args.get("redirect")
    if requested and auth.is_safe_redirect(requested):
        return requested
    return current_app.config["DASHBOARD_URL"]


@sso_bp.route("/sso/send-verification", methods=["POST"])
@limiter.limit("5 per minute")
def send_verification_email():
    """Re-send the verification email for a pending registration."""
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    redirect_url = (data.get("redirect") or "").strip()

    if not email:
        return jsonify({"error": "Email required"}), 400

    client = db.require_client()
    pending = client.table("tempusers").select("*").eq("email", email).execute()

    if pending.data:
        try:
            issue_email_verification(pending.data[0], redirect_url=redirect_url)
        except Exception as exc:
            # Logged, not surfaced: a distinguishable failure would leak that the
            # address is a pending registration.
            logger.error("Failed to resend verification email to %s: %s", email, exc)

    # One response for every outcome — pending, already verified, or unknown.
    #
    # The endpoint is unauthenticated and cheap to call, so any difference would
    # turn it into a scriptable "is this email registered?" oracle. This matches
    # `forgot-password`, which already refuses to reveal existence. The trade-off
    # is that a user who is already verified gets the same neutral message as
    # everyone else; the login form is what tells them they are set up.
    elif client.table("users").select("id").eq("email", email).execute().data:
        logger.info("Verification resend requested for an already-verified account")
    else:
        logger.info("Verification resend requested for an unknown address")

    return jsonify(
        {
            "message": (
                "If that address is awaiting verification, a new link has been sent."
            )
        }
    ), 200


# ── Password reset ──────────────────────────────────────────────────────────

@sso_bp.route("/sso/forgot-password", methods=["POST"])
@limiter.limit("5 per minute")
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not email:
        return jsonify({"error": "Email required"}), 400

    client = db.require_client()
    found = client.table("users").select("*").eq("email", email).execute()

    # Never reveal whether an account exists.
    if not found.data:
        return jsonify({"message": "If an account exists, a reset code has been sent"}), 200

    user = found.data[0]
    reset_code = f"{secrets.randbelow(1000000):06d}"
    expires_at = sessions.to_iso(
        sessions.now() + datetime.timedelta(minutes=RESET_CODE_LIFETIME_MINUTES)
    )

    try:
        client.table("password_resets").delete().eq("user_id", user["id"]).execute()
        client.table("password_resets").insert(
            {"user_id": user["id"], "code": reset_code, "expires_at": expires_at}
        ).execute()
    except Exception as exc:
        logger.error("Failed to store reset code for %s: %s", email, exc)
        return jsonify({"error": "Failed to generate reset code"}), 500

    EmailService().send_password_reset_code(user_email=email, code=reset_code)
    return jsonify({"message": "Reset code sent"}), 200


@sso_bp.route("/sso/verify-reset-code", methods=["POST"])
@limiter.limit("10 per minute")
def verify_reset_code():
    """
    Exchange a valid reset code for a one-shot reset token.

    A 6-digit code has 1,000,000 combinations and lives for 15 minutes, so the
    rate limiter alone is not enough — it is per address, and an attacker with
    many addresses is not slowed by it. Each wrong guess also counts against the
    code itself (`password_resets.attempts`), and at the limit the code is burned
    so guessing cannot continue against it from anywhere.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    code = (data.get("code") or "").strip()

    if not email or not code:
        return jsonify({"error": "Email and code required"}), 400

    # Codes are exactly six digits. Rejecting anything else here also keeps
    # `compare_digest` below on two ASCII strings, where it cannot raise.
    if not code.isdigit() or len(code) != 6:
        return jsonify({"error": "Invalid or expired code"}), 400

    client = db.require_client()
    found = client.table("users").select("id").eq("email", email).execute()
    if not found.data:
        # Same message as a wrong code: this endpoint must not become a way to
        # find out which addresses are registered.
        return jsonify({"error": "Invalid or expired code"}), 400

    user_id = found.data[0]["id"]
    outstanding = (
        client.table("password_resets")
        .select("*")
        .eq("user_id", user_id)
        .is_("used_at", "null")
        .gt("expires_at", sessions.now_iso())
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not outstanding.data:
        return jsonify({"error": "Invalid or expired code"}), 400

    record = outstanding.data[0]

    if record.get("attempts", 0) >= MAX_RESET_CODE_ATTEMPTS:
        # Already exhausted: burn it so a later, luckier guess cannot succeed.
        _burn_reset_code(client, record["id"])
        logger.warning("Reset code for user %s exceeded its attempt limit", user_id)
        return jsonify({"error": "Invalid or expired code"}), 400

    if not hmac.compare_digest(str(record.get("code") or ""), code):
        _register_failed_reset_attempt(client, record)
        return jsonify({"error": "Invalid or expired code"}), 400

    reset_token = auth.issue_purpose_token(
        {
            "user_id": user_id,
            "type": TOKEN_TYPE_PASSWORD_RESET,
            "code_id": record["id"],
        },
        lifetime=datetime.timedelta(minutes=RESET_TOKEN_LIFETIME_MINUTES),
    )
    return jsonify({"message": "Code verified", "reset_token": reset_token}), 200


def _register_failed_reset_attempt(client, record: dict) -> None:
    """Count one wrong guess, burning the code if it is now exhausted."""
    attempts = int(record.get("attempts") or 0) + 1
    try:
        if attempts >= MAX_RESET_CODE_ATTEMPTS:
            _burn_reset_code(client, record["id"])
            logger.warning(
                "Reset code %s burned after %s failed attempts", record["id"], attempts
            )
            return
        client.table("password_resets").update({"attempts": attempts}).eq(
            "id", record["id"]
        ).execute()
    except Exception as exc:
        # Failing to count must not fail the request; it only means the code is
        # not one step closer to being burned.
        logger.error("Could not record a failed reset attempt: %s", exc)


def _burn_reset_code(client, code_id: str) -> None:
    try:
        client.table("password_resets").update(
            {"used_at": sessions.now_iso()}
        ).eq("id", code_id).execute()
    except Exception as exc:
        logger.error("Could not burn reset code %s: %s", code_id, exc)


@sso_bp.route("/sso/reset-password", methods=["POST"])
@limiter.limit("5 per minute")
def reset_password():
    """
    Set a new password from a verified reset token.

    Every existing session is revoked and no new one is created: the person
    completing the reset is not necessarily the person who was signed in.
    """
    data = request.get_json(silent=True) or {}
    token = data.get("token")
    new_password = data.get("password") or ""

    if not token or not new_password:
        return jsonify({"error": "Token and password required"}), 400

    problem = auth.password_problem(new_password)
    if problem:
        return jsonify({"error": problem}), 400

    payload = auth.decode_purpose_token(token, expected_type=TOKEN_TYPE_PASSWORD_RESET)
    if not payload:
        return jsonify({"error": "Invalid or expired reset token"}), 401

    user_id = payload.get("user_id")
    code_id = payload.get("code_id")
    client = db.require_client()

    try:
        if code_id:
            client.table("password_resets").update(
                {"used_at": sessions.now_iso()}
            ).eq("id", code_id).execute()

        client.table("users").update(
            {"password_hash": hash_password(new_password)}
        ).eq("id", user_id).execute()
    except Exception as exc:
        logger.error("Failed to reset password for %s: %s", user_id, exc)
        return jsonify({"error": "Failed to reset password"}), 500

    revoked = sessions.revoke_all(client, user_id, reason=REVOKE_PASSWORD_RESET)
    logger.info("Password reset for %s; revoked %s session(s)", user_id, revoked)
    return jsonify({"message": "Password updated successfully"}), 200


# ── Platform sign-in ────────────────────────────────────────────────────────

@sso_bp.route("/sso/authorize", methods=["GET"])
@limiter.limit("60 per minute")
def authorize():
    """
    Silent SSO entry point (Path B).

    If the user already has a session, they are sent straight back to the
    platform with a one-time code — the login form is never shown. If they do
    not, they are sent to the sign-in page and returned here afterwards.
    """
    client_id = request.args.get("client_id")
    redirect_uri = request.args.get("redirect_uri")
    state = request.args.get("state") or ""
    code_challenge = request.args.get("code_challenge")
    code_challenge_method = request.args.get("code_challenge_method")

    if not platforms.get(client_id):
        return jsonify({"error": "Unknown client_id"}), 400
    if not platforms.redirect_uri_allowed(client_id, redirect_uri):
        logger.warning("Rejected authorize for client %s: bad redirect_uri", client_id)
        return jsonify({"error": "Invalid redirect_uri"}), 400
    if code_challenge and code_challenge_method not in (None, "S256"):
        return jsonify({"error": "Unsupported code_challenge_method"}), 400

    identity = auth.resolve_identity()
    if not identity:
        return_to = quote(request.url, safe="")
        return redirect(f"{current_app.config['LOGIN_URL']}?return_to={return_to}", code=302)

    code = auth.create_auth_code(
        db.require_client(),
        user_id=identity["user"]["id"],
        client_id=client_id,
        redirect_uri=redirect_uri,
        session_id=identity["session"]["id"],
        code_challenge=code_challenge,
    )
    logger.info("Issued SSO code for client %s", client_id)

    params = {"code": code}
    if state:
        params["state"] = state
    return redirect(f"{redirect_uri}?{urlencode(params)}", code=302)


@sso_bp.route("/sso/token", methods=["POST"])
@limiter.limit("60 per minute")
def exchange_code():
    """
    Exchange a one-time code for a short-lived platform access token (Path B).

    The platform must authenticate: with its API key, or with a PKCE verifier if
    it is configured as a public client.
    """
    data = request.get_json(silent=True) or {}
    code = data.get("code")
    client_id = data.get("client_id")
    redirect_uri = data.get("redirect_uri")
    code_verifier = data.get("code_verifier")

    if not code or not client_id or not redirect_uri:
        return jsonify(
            {"error": "code, client_id and redirect_uri are required"}
        ), 400

    platform = platforms.get(client_id)
    if not platform:
        return jsonify({"error": "Unknown client_id"}), 400

    if platform.get("api_key"):
        provided = request.headers.get("X-Platform-Key")
        if platforms.authenticate_api_key(provided) != client_id:
            return jsonify({"error": "Invalid platform credentials"}), 401
    elif not code_verifier:
        # No shared secret configured, so PKCE is mandatory.
        return jsonify({"error": "code_verifier is required for this client"}), 400

    row = auth.consume_auth_code(
        db.require_client(),
        code=code,
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_verifier=code_verifier,
    )
    if not row:
        return jsonify({"error": "invalid_grant"}), 401

    found = db.require_client().table("users").select("*").eq("id", row["user_id"]).execute()
    if not found.data:
        return jsonify({"error": "invalid_grant"}), 401

    user = found.data[0]
    access_token = auth.issue_access_token(
        user, session_id=row.get("session_id"), client_id=client_id
    )
    return jsonify(
        {
            "access_token": access_token,
            # `token` is also returned so platforms written against the old
            # response shape need no change.
            "token": access_token,
            "token_type": "Bearer",
            "expires_in": current_app.config["ACCESS_TOKEN_TTL_MINUTES"] * 60,
            "user": accounts.public_user(user),
            **plans.allowance_block(db.require_client(), user),
        }
    ), 200


@sso_bp.route("/sso/introspect", methods=["POST"])
@limiter.limit("120 per minute")
def introspect():
    """
    Validate a session or access token server-to-server (Paths A and C).

    Returns the OAuth-style `active` flag, so a caller can always rely on a 200.
    """
    caller = platforms.authenticate_api_key(request.headers.get("X-Platform-Key"))
    if not caller and not auth.internal_key_ok():
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    token = data.get("token") or auth.current_session_token()
    if not token:
        return jsonify({"active": False}), 200

    identity = auth.resolve_bearer(token)
    if not identity:
        return jsonify({"active": False}), 200

    user = identity["user"]
    return jsonify(
        {
            "active": True,
            "client_id": caller,
            "service": identity["session"].get("service"),
            "session_id": str(identity["session"]["id"]),
            "user": accounts.public_user(user),
            "credits": user.get("credits_balance", 0),
            **plans.allowance_block(db.require_client(), user),
        }
    ), 200


# ── Compatibility endpoints ─────────────────────────────────────────────────
# These keep working with the platform integrations that already call them.
# They accept a short-lived access token, a raw session token, or the cookie.

def _verify_payload(identity: dict):
    user = identity["user"]
    return {
        "valid": True,
        "user": accounts.public_user(user),
        **plans.allowance_block(db.require_client(), user),
    }


def _token_from_request() -> str | None:
    header = request.headers.get("Authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    data = request.get_json(silent=True) or {}
    return data.get("token") or auth.current_session_token()


@sso_bp.route("/sso/verify", methods=["POST"])
@sso_bp.route("/sso/verify-token", methods=["POST"])
@limiter.limit("100 per minute")
def verify_token():
    """
    Validate a token and return the user plus their allowance.

    `/sso/verify-token` is the same endpoint under the name the older dashboard
    integration calls; both paths share one implementation so they cannot drift.
    """
    identity = auth.resolve_bearer(_token_from_request())
    if not identity:
        return jsonify({"error": "Invalid token"}), 401
    return jsonify(_verify_payload(identity)), 200


@sso_bp.route("/sso/user-info", methods=["POST"])
@limiter.limit("100 per minute")
def get_sso_user_info():
    identity = auth.resolve_bearer(_token_from_request())
    if not identity:
        return jsonify({"error": "Invalid token"}), 401

    user = identity["user"]
    payload = accounts.public_user(user)
    payload["email_verified_at"] = user.get("email_verified_at")
    return jsonify({"user": payload}), 200


@sso_bp.route("/sso/login", methods=["POST"])
@limiter.limit("10 per minute")
def sso_login():
    """
    Platform-facing sign-in. Same behaviour as `/api/login`, including the
    session cookie, because there is only one kind of session in SilverGate.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    service = (data.get("service") or "").strip() or auth.service_from_request()

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    return accounts.perform_login(email, password, service)

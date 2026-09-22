"""
Google sign-in: the two browser-facing endpoints.

Both are reached by a **top-level navigation**, not a fetch — the flow has to
leave our origin for Google's consent screen and come back. That is why every
outcome is a redirect to a page rather than a JSON body: a JSON error here would
be rendered raw in the address bar, and a user who declined consent would see
`{"error": "..."}` instead of the login form.

The outcome is always reported to the frontend as `?oauth=<code>`, which the
login and registration pages translate:

    success      a session was established
    cancelled    the user declined at Google, or Google refused
    invalid      a missing, expired or forged `state`, or a missing code
    failed       the exchange or the account linking failed
    unavailable  this deployment has no Google credentials

Nothing but `state` is trusted on the way back in, and `state` is a signed,
short-lived token (see `google_oauth`), so a forged callback cannot establish a
session.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets
from urllib.parse import urlencode

from flask import Blueprint, current_app, redirect, request

import accounts
import auth
import db
import google_oauth
import sessions
from extensions import limiter

logger = logging.getLogger(__name__)

google_bp = Blueprint("google_auth", __name__)

# The `type` claim that stops a Google-state token being usable as, say, a
# password-reset token. Both are signed with the same secret.
STATE_TYPE = "google_oauth_state"
STATE_TTL_MINUTES = 10

# Where a failure lands when the original target is unknown. The login page shows
# a translated message; signing in is the action the user was attempting.
DEFAULT_RETURN_PATH = "/login"


def _safe_return_path(value) -> str:
    """
    Only a relative path on this application may be used as the return target.

    An absolute URL here would make this endpoint an open redirect — and the
    redirect happens *after* a session cookie is set, which is exactly the
    handoff an attacker would want to abuse.
    """
    if not isinstance(value, str):
        return ""
    candidate = value.strip()
    if not candidate.startswith("/") or candidate.startswith("//"):
        return ""
    return candidate[:512]


def _frontend_url(return_path: str, outcome: str) -> str:
    base = current_app.config["APP_URL"]
    path = _safe_return_path(return_path) or DEFAULT_RETURN_PATH
    separator = "&" if "?" in path else "?"
    return f"{base}{path}{separator}{urlencode({'oauth': outcome})}"


@google_bp.route("/auth/google/start", methods=["GET"])
@limiter.limit("30 per minute")
def google_start():
    """
    Send the browser to Google.

    `redirect` is where the user should land afterwards — a path on this
    application, never an absolute URL.
    """
    return_path = _safe_return_path(request.args.get("redirect"))

    if not google_oauth.configured():
        logger.warning("Google sign-in was requested but is not configured.")
        return redirect(_frontend_url(return_path, "unavailable"), code=302)

    # The verifier travels inside the signed state token: there is no server-side
    # store to keep it in, and it is useless without the matching `state`.
    verifier = google_oauth.new_verifier()
    state = auth.issue_purpose_token(
        {
            "type": STATE_TYPE,
            "nonce": secrets.token_urlsafe(16),
            "verifier": verifier,
            "redirect": return_path,
        },
        lifetime=dt.timedelta(minutes=STATE_TTL_MINUTES),
    )

    return redirect(
        google_oauth.authorization_url(
            state=state, code_challenge=google_oauth.challenge_for(verifier)
        ),
        code=302,
    )


@google_bp.route("/auth/google/callback", methods=["GET"])
@limiter.limit("30 per minute")
def google_callback():
    """Complete the handshake and establish a normal SilverGate session."""
    # Google reports a refusal (consent denied, access blocked) as query params
    # rather than by calling us with a code.
    if request.args.get("error"):
        logger.info("Google sign-in did not complete: %s", str(request.args.get("error"))[:64])
        return redirect(_frontend_url("", "cancelled"), code=302)

    state = request.args.get("state") or ""
    code = request.args.get("code") or ""

    payload = auth.decode_purpose_token(state, expected_type=STATE_TYPE) if state else None
    if not payload or not code:
        # No return path is trusted from an unverified state, so this lands on the
        # default destination.
        logger.warning("Google callback with a missing code or an unusable state.")
        return redirect(_frontend_url("", "invalid"), code=302)

    return_path = _safe_return_path(payload.get("redirect"))

    try:
        tokens = google_oauth.exchange_code(code, payload.get("verifier") or "")
        claims = google_oauth.verify_id_token(tokens["id_token"])
        client = db.require_client()
        user = google_oauth.link_or_create_user(client, claims)
    except google_oauth.GoogleAuthError as exc:
        logger.warning("Google sign-in rejected (%s).", exc.reason)
        return redirect(_frontend_url(return_path, "failed"), code=302)
    except Exception as exc:
        logger.error("Google sign-in failed: %s", exc)
        return redirect(_frontend_url(return_path, "failed"), code=302)

    # From here on this is an ordinary sign-in: one session, one cookie, one
    # audit event — identical to the password path.
    accounts.record_service_login(user, "google")
    material, _token = accounts.start_session(user, service="google")
    sessions.record_login_event(
        client,
        user_id=user["id"],
        service="google",
        success=True,
        ip=auth.client_ip(),
        user_agent=auth.user_agent(),
    )

    response = redirect(_frontend_url(return_path, "success"), code=302)
    auth.set_session_cookie(response, material["token"])
    logger.info("Google sign-in succeeded for user %s.", user["id"])
    return response

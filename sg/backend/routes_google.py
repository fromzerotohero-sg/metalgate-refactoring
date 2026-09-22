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
session. That extends to the referral code: it is carried inside `state` rather
than a cookie, because the trip to Google leaves this origin and a cookie set
here would not come back with a callback, which is a navigation and cannot carry
a header either.
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
import referrals
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


def _return_target(value) -> str:
    """
    Resolve where the browser goes after the handshake.

    A site-relative path resolves against the frontend; an **absolute URL on an
    origin SilverGate recognises** is returned unchanged, which is what lets a
    platform start the Google flow and get the user back on its own domain. The
    allowlist is the same one that governs every other post-authentication
    redirect (see `auth.resolve_return_target`), so this stays safe to use here
    even though it runs *after* a session cookie has been set.

    Returns "" when the value is missing or unrecognised; the caller then falls
    back to the sign-in page.
    """
    if not isinstance(value, str):
        return ""
    return auth.resolve_return_target(value.strip()) or ""


def _destination_url(target: str, outcome: str) -> str:
    base = target or f"{current_app.config['APP_URL']}{DEFAULT_RETURN_PATH}"
    separator = "&" if "?" in base else "?"
    return f"{base}{separator}{urlencode({'oauth': outcome})}"


@google_bp.route("/auth/google/start", methods=["GET"])
@limiter.limit("30 per minute")
def google_start():
    """
    Send the browser to Google.

    `redirect` is where the user should land afterwards — a path on this
    application, or an absolute URL on a registered platform origin (so a platform
    can start the handshake and get the user back). `ref` is the referral code the
    user arrived through, if any; it is normalised here so that whatever reaches
    the signed state is already known to be a code and nothing else.
    """
    return_target = _return_target(request.args.get("redirect"))

    if not google_oauth.configured():
        logger.warning("Google sign-in was requested but is not configured.")
        return redirect(_destination_url(return_target, "unavailable"), code=302)

    # The verifier travels inside the signed state token: there is no server-side
    # store to keep it in, and it is useless without the matching `state`.
    verifier = google_oauth.new_verifier()
    state = auth.issue_purpose_token(
        {
            "type": STATE_TYPE,
            "nonce": secrets.token_urlsafe(16),
            "verifier": verifier,
            "redirect": return_target,
            # Carried so that a signup completed through Google can still credit
            # whoever referred the user. Only the account-creation path reads it.
            "ref": referrals.normalize_code(request.args.get("ref")),
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
        return redirect(_destination_url("", "cancelled"), code=302)

    state = request.args.get("state") or ""
    code = request.args.get("code") or ""

    payload = auth.decode_purpose_token(state, expected_type=STATE_TYPE) if state else None
    if not payload or not code:
        # No return path is trusted from an unverified state, so this lands on the
        # default destination.
        logger.warning("Google callback with a missing code or an unusable state.")
        return redirect(_destination_url("", "invalid"), code=302)

    return_target = _return_target(payload.get("redirect"))

    try:
        tokens = google_oauth.exchange_code(code, payload.get("verifier") or "")
        claims = google_oauth.verify_id_token(tokens["id_token"])
        client = db.require_client()
        user = google_oauth.link_or_create_user(client, claims, payload.get("ref"))
    except google_oauth.GoogleAuthError as exc:
        logger.warning("Google sign-in rejected (%s).", exc.reason)
        return redirect(_destination_url(return_target, "failed"), code=302)
    except Exception as exc:
        logger.error("Google sign-in failed: %s", exc)
        return redirect(_destination_url(return_target, "failed"), code=302)

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

    response = redirect(_destination_url(return_target, "success"), code=302)
    auth.set_session_cookie(response, material["token"])
    logger.info("Google sign-in succeeded for user %s.", user["id"])
    return response

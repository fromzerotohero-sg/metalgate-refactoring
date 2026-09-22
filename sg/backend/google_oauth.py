"""
Google as an external identity provider (OpenID Connect, authorization code flow).

Google is the *relying party's* side of the exchange: SilverGate trusts an
identity that Google has already verified, and then issues exactly the same
session it issues for a password login. Nothing downstream knows the difference —
`accounts.start_session` is the single definition of "signed in", and this module
deliberately does not add a second one.

The flow, in the order the browser walks it:

1. `/api/auth/google/start` builds a signed `state` token and redirects to Google.
2. Google authenticates the user and redirects back to
   `/api/auth/google/callback` with a one-time `code`.
3. The code is exchanged server-to-server for tokens, and the `id_token` — a JWT
   signed by Google — is verified against Google's published keys.
4. The verified identity is matched to a SilverGate account and a normal session
   begins.

Design decisions worth knowing, because they are the security-relevant ones:

* **`state` is a signed JWT, not a server-side row.** It carries a nonce, the PKCE
  verifier and the return path, and it expires in ten minutes. On serverless there
  is no memory to hold it in, and a signed, short-lived token is verifiable
  without a database round trip.

* **The email is only trusted when Google says it is verified.** `email_verified`
  is the whole basis for matching an existing account, so an unverified address
  is refused rather than linked. Linking on an unverified address is the classic
  account-takeover route.

* **The subject (`sub`), not the email, is the identity.** Emails change; `sub`
  does not. The link is stored in `oauth_identities` so a later email change
  cannot orphan an account or point it at a different one.

* **PKCE is used even though this is a confidential client.** It costs one hash
  and closes the authorization-code interception window.

See architecture/04 for the session model this plugs into.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import uuid
from urllib.parse import urlencode

import jwt
import requests
from flask import current_app

import sessions

logger = logging.getLogger(__name__)

PROVIDER = "google"

AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
# The v3 certs endpoint publishes the same keys as v1/v2 and is the one Google's
# own libraries use.
JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs"

# Google hands back either spelling, and both are currently valid.
ISSUERS = ("https://accounts.google.com", "accounts.google.com")

# `openid` is what makes this OIDC and gets us an id_token at all; `email` and
# `profile` are what fill in the claims we link on.
SCOPES = "openid email profile"

# Bound every outbound call: a hung token endpoint must not hold a function open
# until the platform timeout.
HTTP_TIMEOUT_SECONDS = 10

# Tolerance for clock drift between Google's signers and this function.
LEEWAY_SECONDS = 60


class GoogleAuthError(Exception):
    """A Google sign-in that must not result in a session."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# ── Configuration ───────────────────────────────────────────────────────────

def configured() -> bool:
    """
    Whether Google sign-in can be attempted at all.

    Both halves are required: a client id with no secret cannot complete the
    server-to-server exchange, so it is treated as unconfigured rather than
    failing later with a confusing upstream error.
    """
    cfg = current_app.config
    return bool(cfg.get("GOOGLE_CLIENT_ID") and cfg.get("GOOGLE_CLIENT_SECRET"))


def redirect_uri() -> str:
    """
    The callback Google will call.

    Must match an authorized redirect URI on the OAuth client **exactly** —
    Google rejects anything else before the request ever reaches us, so a typo
    here looks like a Google-side error rather than a configuration mistake.
    """
    return current_app.config["GOOGLE_REDIRECT_URI"]


# ── PKCE + authorization URL ────────────────────────────────────────────────

def new_verifier() -> str:
    """A fresh PKCE code verifier (RFC 7636: 43-128 chars, unreserved)."""
    return secrets.token_urlsafe(64)[:128]


def challenge_for(verifier: str) -> str:
    """The S256 challenge for `verifier`, base64url without padding."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def authorization_url(*, state: str, code_challenge: str) -> str:
    cfg = current_app.config
    params = {
        "client_id": cfg["GOOGLE_CLIENT_ID"],
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        # This sign-in is for authentication, not for offline access: we never
        # call Google's APIs on the user's behalf, so no refresh token is wanted
        # (`access_type=online` is the default, and is stated for clarity).
        "access_type": "online",
        # Always show the chooser. A shared browser otherwise silently reuses
        # whichever Google account happens to be signed in.
        "prompt": "select_account",
    }
    return f"{AUTHORIZATION_ENDPOINT}?{urlencode(params)}"


# ── Token exchange + ID token verification ──────────────────────────────────

def exchange_code(code: str, code_verifier: str) -> dict:
    """
    Trade the one-time authorization code for tokens.

    The client secret is sent here and only here — it never reaches a browser.
    """
    cfg = current_app.config
    try:
        response = requests.post(
            TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": cfg["GOOGLE_CLIENT_ID"],
                "client_secret": cfg["GOOGLE_CLIENT_SECRET"],
                "redirect_uri": redirect_uri(),
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
            timeout=HTTP_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.error("Google token exchange could not be reached: %s", exc)
        raise GoogleAuthError("token_endpoint_unreachable") from None

    if response.status_code != 200:
        # The body can carry a client id or a redirect URI echo, so only the
        # error code is logged — never the whole payload.
        logger.error(
            "Google token exchange failed with %s: %s",
            response.status_code,
            _safe_error_code(response),
        )
        raise GoogleAuthError("token_exchange_failed")

    payload = response.json()
    if not payload.get("id_token"):
        logger.error("Google token exchange returned no id_token.")
        raise GoogleAuthError("missing_id_token")
    return payload


def _safe_error_code(response) -> str:
    try:
        return str((response.json() or {}).get("error") or "unknown")[:64]
    except ValueError:
        return "unknown"


_JWKS_CLIENT = None


def _jwks_client():
    """
    Google's public keys, cached per instance.

    `PyJWKClient` refetches on its own schedule and on an unknown `kid`, so a key
    rotation does not require a deploy. One instance-level client avoids a fetch
    per request.
    """
    global _JWKS_CLIENT
    if _JWKS_CLIENT is None:
        _JWKS_CLIENT = jwt.PyJWKClient(JWKS_URI, cache_keys=True, lifespan=3600)
    return _JWKS_CLIENT


def verify_id_token(id_token: str) -> dict:
    """
    Verify Google's ID token and return its claims.

    Verification is done here rather than by trusting the token's contents: the
    signature, the audience (this client id, so a token minted for another
    application cannot be replayed at us), the issuer, and the expiry are all
    checked. The audience check is the one that matters most — without it, a
    token issued to any other Google client by a real Google would be accepted.
    """
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=current_app.config["GOOGLE_CLIENT_ID"],
            issuer=list(ISSUERS),
            leeway=LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except jwt.PyJWTError as exc:
        # Never log the token itself: it is a bearer credential for its lifetime.
        logger.warning("Google ID token rejected: %s", exc)
        raise GoogleAuthError("invalid_id_token") from None
    except Exception as exc:  # key fetch failures, malformed JWKS
        logger.error("Could not verify the Google ID token: %s", exc)
        raise GoogleAuthError("id_token_unverifiable") from None
    return claims


# ── Account linking ─────────────────────────────────────────────────────────

def link_or_create_user(client, claims: dict) -> dict:
    """
    Resolve the SilverGate user for a verified Google identity.

    Order matters. An existing link wins, so a user who has changed their Google
    address keeps the same account; only then is the (Google-verified) email used
    to adopt an existing account, and only then is a new one created.
    """
    subject = str(claims.get("sub") or "").strip()
    email = (claims.get("email") or "").strip().lower()

    if not subject or not email:
        raise GoogleAuthError("incomplete_identity")

    # The basis for matching an existing account. Refusing an unverified address
    # is what stops an attacker with a Google account for a victim's address from
    # walking into that victim's SilverGate account.
    if not claims.get("email_verified", False):
        logger.warning("Refused a Google identity whose email is not verified.")
        raise GoogleAuthError("email_not_verified")

    linked = _find_linked_user(client, subject)
    if linked is not None:
        _touch_link(client, subject)
        return linked

    existing = client.table("users").select("*").eq("email", email).limit(1).execute()
    if existing.data:
        user = existing.data[0]
        _link(client, user["id"], subject, email)
        _absorb_pending_registration(client, email)
        return user

    user = _create_user(client, email, claims)
    _link(client, user["id"], subject, email)
    _absorb_pending_registration(client, email)
    logger.info("Created a SilverGate account from a Google identity.")
    return user


def _find_linked_user(client, subject: str) -> dict | None:
    """The user this Google account is already linked to, or None."""
    found = (
        client.table("oauth_identities")
        .select("user_id")
        .eq("provider", PROVIDER)
        .eq("provider_subject", subject)
        .limit(1)
        .execute()
    )
    if not found.data:
        return None

    user_id = found.data[0]["user_id"]
    user = client.table("users").select("*").eq("id", user_id).limit(1).execute()
    if user.data:
        return user.data[0]

    # The link outlived its user (account deletion should cascade, so this is
    # defensive): drop the orphan and let the caller re-link from the email.
    logger.warning("Removing an oauth_identities row with no user.")
    client.table("oauth_identities").delete().eq("provider", PROVIDER).eq(
        "provider_subject", subject
    ).execute()
    return None


def _link(client, user_id: str, subject: str, email: str) -> None:
    """
    Record the link between a SilverGate user and a Google subject.

    Upsert rather than insert: two concurrent first sign-ins race here, and the
    unique index on (provider, provider_subject) is the arbiter. Losing that race
    is not an error — the link exists either way.
    """
    client.table("oauth_identities").upsert(
        {
            "user_id": user_id,
            "provider": PROVIDER,
            "provider_subject": subject,
            "email": email,
            "last_login_at": sessions.now_iso(),
        },
        on_conflict="provider,provider_subject",
    ).execute()


def _touch_link(client, subject: str) -> None:
    """Best effort: a failure here must not fail a sign-in."""
    try:
        client.table("oauth_identities").update(
            {"last_login_at": sessions.now_iso()}
        ).eq("provider", PROVIDER).eq("provider_subject", subject).execute()
    except Exception as exc:
        logger.warning("Could not update the oauth_identities timestamp: %s", exc)


def _create_user(client, email: str, claims: dict) -> dict:
    """
    Create an account for a Google-verified address.

    `password_hash` is left null: this account has no password, and
    `verify_password` fails closed on an empty hash, so the password login path
    can never be used to enter it. The signup bonus matches registration exactly —
    a Google signup is a signup.
    """
    from credits import make_grant
    from routes import generate_referral_code

    cfg = current_app.config
    stamp = sessions.now_iso()
    row = {
        "id": str(uuid.uuid4()),
        "email": email,
        "username": _username_from(claims, email),
        "tag": "",
        "password_hash": None,
        "credits_balance": 0,
        "temp_credits_balance": [
            make_grant(
                cfg["SIGNUP_BONUS_CREDITS"],
                ttl_days=cfg["TEMP_GRANT_TTL_DAYS"],
            )
        ],
        "referral_code": generate_referral_code(),
        # Google verified the address; that is the whole point of this path, and
        # it is why no verification email is sent.
        "email_verified": True,
        "email_verified_at": stamp,
        "created_at": stamp,
    }
    return client.table("users").insert(row).execute().data[0]


def _username_from(claims: dict, email: str) -> str:
    """
    A first username, best effort.

    Google's `name` is neither unique nor ours, so it is only a starting point —
    the account page lets the user change it, and nothing keys on it.
    """
    candidate = (claims.get("name") or "").strip() or email.split("@", 1)[0]
    return candidate[:60]


def _absorb_pending_registration(client, email: str) -> None:
    """
    Drop a half-finished email/password registration for the same address.

    A row in `tempusers` is only a pending registration. Now that the address has
    a real, Google-verified account, the pending row can never be promoted without
    colliding with it — leaving it there would strand the user on "check your
    email" forever. Best effort: it must not fail a sign-in.
    """
    try:
        client.table("tempusers").delete().eq("email", email).execute()
    except Exception as exc:
        logger.warning("Could not clear a pending registration for a Google user: %s", exc)

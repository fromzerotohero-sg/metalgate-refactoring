"""
SilverGate request authentication.

Two credential shapes arrive here:

1. **The session cookie** — the user's long-lived credential. It is opaque,
   database-backed and revocable, and it is what keeps the user signed in on
   every platform of the brand without ever logging in again
   (architecture/04, decision D5).

2. **A short-lived access token** (JWT, minutes) — what a *platform* receives
   from the SSO exchange and presents on behalf of the user. It carries the
   session id, so revocation still takes effect.

There is deliberately no third mechanism. The previous deployment also accepted
a 24-hour JWT from localStorage and a Flask signed-cookie session; both are gone.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import ipaddress
import logging
import secrets
from base64 import urlsafe_b64encode
from functools import wraps
from urllib.parse import urlparse

import jwt
from flask import current_app, g, jsonify, redirect, request

import db
import platforms
import sessions
from constants import TOKEN_TYPE_ACCESS

logger = logging.getLogger(__name__)

BEARER_PREFIX = "bearer "


# ── Request metadata ────────────────────────────────────────────────────────

def client_ip() -> str | None:
    """
    The client's address, as resolved by the trusted proxy.

    Uses `request.remote_addr`, which `ProxyFix(x_for=1)` has already set from the
    rightmost `X-Forwarded-For` entry — the address the proxy actually saw.
    Parsing the header here would read the *leftmost* entry instead, which is
    client-supplied, letting a caller forge the IP recorded against their session
    and in `login_events`.

    Validated before use because it is written to an `inet` column.
    """
    candidate = request.remote_addr
    if not candidate:
        return None
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        return None
    return candidate


def user_agent() -> str | None:
    raw = request.headers.get("User-Agent") or ""
    return raw[:500] or None


def service_from_request() -> str | None:
    """Identify the originating platform from the request, when we can."""
    explicit = request.args.get("service") or (request.get_json(silent=True) or {}).get("service")
    if explicit:
        return str(explicit)[:64]
    origin = request.headers.get("Origin")
    if origin:
        for client_id in platforms.all_ids():
            if origin in ((platforms.get(client_id) or {}).get("origins") or []):
                return client_id
    return None


# ── Session cookie ──────────────────────────────────────────────────────────

def cookie_name() -> str:
    return current_app.config["SESSION_COOKIE_NAME"]


def set_session_cookie(response, token: str):
    """
    Attach the session cookie to a response.

    Max-Age is a *sliding* window: it is re-issued on activity so that an active
    user is never asked to log in again, while a browser that caps cookie
    lifetime (Chrome caps at 400 days) still accepts it.
    """
    cfg = current_app.config
    max_age = int(dt.timedelta(days=cfg["SESSION_TTL_DAYS"]).total_seconds())
    response.set_cookie(
        cfg["SESSION_COOKIE_NAME"],
        token,
        max_age=max_age,
        domain=cfg["SESSION_COOKIE_DOMAIN"],
        path=cfg["SESSION_COOKIE_PATH"],
        secure=cfg["SESSION_COOKIE_SECURE"],
        httponly=cfg["SESSION_COOKIE_HTTPONLY"],
        samesite=cfg["SESSION_COOKIE_SAMESITE"],
    )
    return response


def clear_session_cookie(response):
    cfg = current_app.config
    response.delete_cookie(
        cfg["SESSION_COOKIE_NAME"],
        domain=cfg["SESSION_COOKIE_DOMAIN"],
        path=cfg["SESSION_COOKIE_PATH"],
        secure=cfg["SESSION_COOKIE_SECURE"],
        httponly=cfg["SESSION_COOKIE_HTTPONLY"],
        samesite=cfg["SESSION_COOKIE_SAMESITE"],
    )
    return response


def renew_session_cookie(response):
    """
    Extend the session cookie's sliding window on any authenticated request.

    Registered as an `after_request` hook rather than handled per endpoint. A user
    who only ever reaches SilverGate through `/api/credits` on a platform must
    still have their cookie re-issued, or the browser's 400-day cap would
    eventually sign them out — which is precisely what "never log in again" is
    supposed to avoid.
    """
    if not getattr(g, "identity_from_cookie", False):
        return response

    session_row = getattr(g, "resolved_session", None)
    token = request.cookies.get(cookie_name())
    if not token or not session_row or not session_row.get("created_at"):
        return response

    renew_after_hours = current_app.config["SESSION_RENEW_AFTER_HOURS"]
    if renew_after_hours <= 0:
        return response

    try:
        age = sessions.now() - sessions.parse_dt(session_row["created_at"])
    except (TypeError, ValueError):
        return response

    if age > dt.timedelta(hours=renew_after_hours):
        set_session_cookie(response, token)
    return response


# ── Access tokens (platform-facing, short lived) ────────────────────────────

def issue_access_token(user: dict, *, session_id: str | None = None, client_id: str | None = None) -> str:
    cfg = current_app.config
    issued = dt.datetime.now(dt.timezone.utc)
    payload = {
        "iss": cfg["ACCESS_TOKEN_ISSUER"],
        "iat": issued,
        "exp": issued + dt.timedelta(minutes=cfg["ACCESS_TOKEN_TTL_MINUTES"]),
        "sub": str(user["id"]),
        "sid": str(session_id) if session_id else None,
        "email": user.get("email"),
        "type": "access",
        # Kept for compatibility with platform code written against the previous
        # token format, which read `user_id` out of the payload.
        "user_id": str(user["id"]),
    }
    if client_id:
        payload["aud"] = client_id
    return jwt.encode(payload, cfg["JWT_SECRET"], algorithm="HS256")


def decode_access_token(token: str) -> dict | None:
    """
    Decode a platform access token.

    The `type` claim is checked explicitly: streamer tokens are signed with the
    same secret, and only the type claim stops one from being accepted as the
    other.
    """
    cfg = current_app.config
    try:
        payload = jwt.decode(
            token,
            cfg["JWT_SECRET"],
            algorithms=["HS256"],
            issuer=cfg["ACCESS_TOKEN_ISSUER"],
            options={"verify_aud": False},
        )
    except jwt.PyJWTError:
        return None

    if payload.get("type") != TOKEN_TYPE_ACCESS:
        return None
    return payload


# ── Single-purpose tokens (email verification, password reset) ──────────────

def issue_purpose_token(payload: dict, *, lifetime: dt.timedelta) -> str:
    cfg = current_app.config
    issued = dt.datetime.now(dt.timezone.utc)
    body = {
        **payload,
        "iss": cfg["ACCESS_TOKEN_ISSUER"],
        "iat": issued,
        "exp": issued + lifetime,
    }
    return jwt.encode(body, cfg["JWT_SECRET"], algorithm="HS256")


def decode_purpose_token(token: str, *, expected_type: str) -> dict | None:
    cfg = current_app.config
    try:
        payload = jwt.decode(
            token,
            cfg["JWT_SECRET"],
            algorithms=["HS256"],
            issuer=cfg["ACCESS_TOKEN_ISSUER"],
        )
    except jwt.PyJWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    return payload


# ── SSO one-time codes (cross-domain handoff) ───────────────────────────────

def _code_hash(code: str) -> str:
    """The same fast one-way hash the session store uses for opaque tokens."""
    return sessions.hash_token(code)


def create_auth_code(
    supabase,
    *,
    user_id: str,
    client_id: str,
    redirect_uri: str,
    session_id: str | None = None,
    code_challenge: str | None = None,
) -> str:
    """
    Issue a single-use code bound to a client and redirect URI.

    The code is short-lived and exchangeable exactly once, so an eternal
    credential never has to travel through the browser's address bar.
    """
    code = secrets.token_urlsafe(32)
    issued = sessions.now()
    ttl = current_app.config["SSO_CODE_TTL_SECONDS"]

    supabase.table("auth_codes").insert(
        {
            "code_hash": _code_hash(code),
            "user_id": user_id,
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256" if code_challenge else None,
            "session_id": session_id,
            "created_at": sessions.to_iso(issued),
            "expires_at": sessions.to_iso(issued + dt.timedelta(seconds=ttl)),
        }
    ).execute()
    return code


def verify_pkce(code_verifier: str, code_challenge: str) -> bool:
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    computed = urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return secrets.compare_digest(computed, code_challenge.rstrip("="))


def consume_auth_code(
    supabase,
    *,
    code: str,
    client_id: str,
    redirect_uri: str | None,
    code_verifier: str | None,
) -> dict | None:
    """Validate and burn a one-time code. Returns the code row, or ``None``."""
    try:
        found = (
            supabase.table("auth_codes")
            .select("*")
            .eq("code_hash", _code_hash(code))
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("Failed to read auth code: %s", exc)
        return None

    if not found.data:
        return None

    row = found.data[0]
    if row.get("used_at"):
        logger.warning("Rejected a replayed SSO code for client %s", row.get("client_id"))
        return None
    if sessions.parse_dt(row["expires_at"]) < sessions.now():
        return None
    if row.get("client_id") != client_id:
        return None
    # Required and compared unconditionally: `/sso/authorize` always binds a
    # redirect URI, so accepting an exchange that omits it would leave that binding
    # unenforced.
    if not redirect_uri or row.get("redirect_uri") != redirect_uri:
        return None

    challenge = row.get("code_challenge")
    if challenge:
        if not code_verifier or not verify_pkce(code_verifier, challenge):
            return None

    # Conditional update: whoever wins the race gets the row, everyone else
    # sees an empty result and is rejected.
    burned = (
        supabase.table("auth_codes")
        .update({"used_at": sessions.now_iso()})
        .eq("id", row["id"])
        .is_("used_at", "null")
        .execute()
    )
    if not burned.data:
        return None
    return row


# ── Identity resolution ─────────────────────────────────────────────────────

def resolve_identity() -> dict | None:
    """
    Return ``{"session": …, "user": …}`` for the current request, or ``None``.

    Resolution order: the session cookie first (the normal case), then an
    Authorization Bearer credential, which may be either a short-lived access
    token or a raw session token.
    """
    from app import supabase

    if supabase is None:
        return None

    cookie_token = request.cookies.get(cookie_name())
    if cookie_token:
        identity = sessions.load(supabase, cookie_token)
        if identity:
            # Remember that the cookie authenticated this request, so the sliding
            # window can be extended on the way out (see renew_session_cookie).
            g.identity_from_cookie = True
            g.resolved_session = identity["session"]
            return identity

    header = request.headers.get("Authorization") or ""
    if header.lower().startswith(BEARER_PREFIX):
        return resolve_bearer(header[len(BEARER_PREFIX):].strip())

    return None


def resolve_bearer(bearer: str | None) -> dict | None:
    """
    Resolve a Bearer credential to ``{"session": …, "user": …}``.

    A Bearer value is either a short-lived access token (the normal case for a
    platform) or a raw session token (what an older integration may still hold),
    so both are tried. This is also the resolution used by the compatibility
    `/api/sso/verify*` endpoints.
    """
    if not bearer:
        return None

    supabase = db.client()
    if supabase is None:
        return None

    payload = decode_access_token(bearer)
    if payload and payload.get("sid"):
        identity = sessions.load_by_id(supabase, payload["sid"])
        if identity:
            return identity

    return sessions.load(supabase, bearer)


def require_session(view):
    """
    Guard for endpoints that need a signed-in user.

    Sets ``g.user`` and ``g.session``. Returns 401 rather than redirecting,
    because every guarded endpoint is a JSON API.
    """

    @wraps(view)
    def wrapper(*args, **kwargs):
        identity = resolve_identity()
        if not identity:
            return jsonify({"error": "Unauthorized"}), 401
        g.user = identity["user"]
        g.session = identity["session"]
        return view(*args, **kwargs)

    return wrapper


def current_session_token() -> str | None:
    return request.cookies.get(cookie_name())


# ── Password policy ─────────────────────────────────────────────────────────

def password_problem(password: str) -> str | None:
    """
    The reason `password` is unacceptable, or ``None`` when it is fine.

    Registration, password change and password reset all call this, so the three
    cannot disagree about the policy. The upper bound is not a security control —
    it exists so a client cannot make the hasher do unbounded work by posting a
    multi-megabyte "password".
    """
    minimum = current_app.config["MIN_PASSWORD_LENGTH"]
    maximum = current_app.config["MAX_PASSWORD_LENGTH"]
    if len(password) < minimum:
        return f"Password must be at least {minimum} characters"
    if len(password) > maximum:
        return f"Password must be at most {maximum} characters"
    return None


def internal_key_ok() -> bool:
    """
    Constant-time check of the server-to-server shared secret.

    Used both by the internal credit endpoints in `routes` and by
    `/sso/introspect`, so it lives here rather than in a route module that the
    other would then have to import.
    """
    provided = (request.headers.get("X-Internal-API-Key") or "").strip()
    expected = (current_app.config["INTERNAL_API_KEY"] or "").strip()
    return bool(provided and expected and hmac.compare_digest(expected, provided))


# ── Redirect safety ─────────────────────────────────────────────────────────

def allowed_origins() -> set[str]:
    """Every origin SilverGate is willing to send a browser back to."""
    config = current_app.config
    origins = set(config["CORS_ORIGINS"])

    for key in ("APP_URL", "LOGIN_URL", "DASHBOARD_URL"):
        value = config[key]
        if value:
            origins.add(value)

    for client_id in platforms.all_ids():
        platform = platforms.get(client_id) or {}
        origins.update(platform.get("origins") or [])
        origins.update(platform.get("redirect_uris") or [])

    cleaned = set()
    for value in origins:
        if not value:
            continue
        parsed = urlparse(value)
        if parsed.scheme and parsed.netloc:
            cleaned.add(f"{parsed.scheme}://{parsed.netloc}")
    return cleaned


def is_safe_redirect(target: str | None) -> bool:
    """
    Guard against open redirects.

    Accepts a site-relative path, or an absolute URL whose origin SilverGate
    knows about. Rejects protocol-relative values such as ``//evil.example``.
    """
    if not target:
        return False

    parsed = urlparse(target)
    if not parsed.scheme and not parsed.netloc:
        return target.startswith("/") and not target.startswith("//")

    if parsed.scheme not in ("http", "https"):
        return False

    return f"{parsed.scheme}://{parsed.netloc}" in allowed_origins()


def redirect_preserving(response, location: str, *, code: int = 302):
    """
    Turn a response into a redirect while keeping the cookies it set.

    The email-verification link needs to do both: establish the session and then
    send the browser on into the app.
    """
    target = redirect(location, code=code)
    for value in response.headers.getlist("Set-Cookie"):
        target.headers.add("Set-Cookie", value)
    return target


# ── CSRF-ish origin guard ───────────────────────────────────────────────────

def enforce_origin_on_cookie_requests():
    """
    Reject cookie-authenticated state changes from an unrecognised origin.

    The session cookie is scoped to the whole brand domain, so `SameSite=Lax`
    alone does not stop a sibling subdomain from forging a request — browsers
    treat subdomains as the same site. `Origin` is always present on a
    cross-origin state-changing request, so an unrecognised value is a reliable
    signal. A missing `Origin` is left alone: those are server-to-server callers,
    and server-to-server callers do not authenticate with the cookie.
    """
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return None

    if not request.cookies.get(cookie_name()):
        return None

    origin = request.headers.get("Origin")
    if not origin or origin in allowed_origins():
        return None

    logger.warning(
        "Blocked a cookie-authenticated %s from an unlisted origin: %s",
        request.method,
        origin,
    )
    return jsonify({"error": "Origin not allowed"}), 403

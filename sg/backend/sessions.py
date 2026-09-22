"""
SilverGate session store.

The session token is the only credential a user holds, and the only mechanism
that keeps them signed in across every platform of the brand:

  * opaque    — 256 bits from secrets.token_urlsafe
  * hashed    — only sha256(token) is persisted, so a database dump yields
                nothing usable, and lookups stay a single indexed read
  * revocable — logging out is one UPDATE, which is what makes a session that
                "never expires" safe to hand out

A session has no expiry of its own (architecture/04, decision D5). Revocation is
the only way one ends. SESSION_IDLE_TIMEOUT_DAYS can add an idle cap if wanted.

The token is deliberately *not* hashed with bcrypt/argon2: those exist to slow
down guessing of low-entropy secrets, and a 256-bit random token has none to
guess. A fast one-way hash is the correct tool here.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from flask import current_app

from constants import (
    REVOKE_IDLE_TIMEOUT,
    REVOKE_LOGOUT,
    REVOKE_LOGOUT_ALL,
)

logger = logging.getLogger(__name__)

TOKEN_BYTES = 32

# PostgREST embed: session row plus its owning user in one round trip.
_SELECT_EMBEDDED = "*, users(*)"
_SELECT_PLAIN = "*"

_TOUCH_INTERVAL = timedelta(minutes=5)


# ── Primitives ──────────────────────────────────────────────────────────────

def now() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def now_iso() -> str:
    """The current UTC instant as an ISO-8601 string.

    Every timestamp written to Supabase goes through here, so stored values are
    always tz-aware and comparable regardless of the server's local timezone.
    """
    return to_iso(now())


def parse_dt(value) -> datetime:
    """Parse a timestamp coming back from Supabase into an aware datetime."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def configure(*, touch_interval_minutes: int) -> None:
    """Apply the touch debounce interval from configuration."""
    global _TOUCH_INTERVAL
    _TOUCH_INTERVAL = timedelta(minutes=max(0, touch_interval_minutes))


# ── Reads ───────────────────────────────────────────────────────────────────

def _select_one(supabase, token: str) -> dict | None:
    token_hash = hash_token(token)
    try:
        result = (
            supabase.table("sessions")
            .select(_SELECT_EMBEDDED)
            .eq("token_hash", token_hash)
            .limit(1)
            .execute()
        )
    except Exception:
        # The embedded select depends on PostgREST detecting the foreign key.
        # If that ever fails, fall back to a plain row and a second query.
        logger.warning("Embedded session select failed; falling back to a plain select.")
        result = (
            supabase.table("sessions")
            .select(_SELECT_PLAIN)
            .eq("token_hash", token_hash)
            .limit(1)
            .execute()
        )
    return result.data[0] if result.data else None


def _user_for(supabase, row: dict) -> dict | None:
    embedded = row.get("users")
    if isinstance(embedded, dict):
        return embedded
    if isinstance(embedded, list) and embedded:
        return embedded[0]

    if not row.get("user_id"):
        return None
    result = (
        supabase.table("users").select("*").eq("id", row["user_id"]).limit(1).execute()
    )
    return result.data[0] if result.data else None


def load(supabase, token: str, *, touch: bool = True) -> dict | None:
    """
    Resolve a session token to ``{"session": …, "user": …}``.

    Returns ``None`` when the token is unknown, revoked, or idle-expired.
    """
    if not token:
        return None

    row = _select_one(supabase, token)
    if not row:
        return None

    if row.get("revoked_at"):
        return None

    last_seen = parse_dt(row["last_seen_at"]) if row.get("last_seen_at") else now()

    idle_days = current_app.config["SESSION_IDLE_TIMEOUT_DAYS"]
    if idle_days and now() - last_seen > timedelta(days=idle_days):
        revoke(supabase, row["id"], reason=REVOKE_IDLE_TIMEOUT)
        return None

    user = _user_for(supabase, row)
    if not user:
        return None

    if touch and now() - last_seen > _TOUCH_INTERVAL:
        _touch(supabase, row)

    return {"session": row, "user": user}


def load_by_id(supabase, session_id: str) -> dict | None:
    """Resolve a session by its id. Used for short-lived access tokens."""
    if not session_id:
        return None
    result = (
        supabase.table("sessions").select(_SELECT_PLAIN).eq("id", session_id).limit(1).execute()
    )
    if not result.data:
        return None
    row = result.data[0]
    if row.get("revoked_at"):
        return None
    user = _user_for(supabase, row)
    if not user:
        return None
    return {"session": row, "user": user}


def _touch(supabase, row: dict) -> None:
    """Debounced activity heartbeat. Never allowed to break a request."""
    stamp = to_iso(now())
    try:
        supabase.table("sessions").update({"last_seen_at": stamp}).eq("id", row["id"]).execute()
        supabase.table("users").update({"last_activity_at": stamp}).eq(
            "id", row["user_id"]
        ).execute()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to update session activity: %s", exc)


# ── Writes ──────────────────────────────────────────────────────────────────

def create(
    supabase,
    user_id: str,
    *,
    ip: str | None = None,
    user_agent: str | None = None,
    service: str | None = None,
) -> dict:
    """
    Mint a session. Returns ``{"token": <raw token>, "session": <row>}``.

    The raw token is returned exactly once and never stored; only its hash is.
    """
    token = new_token()
    stamp = to_iso(now())
    row = {
        "user_id": user_id,
        "token_hash": hash_token(token),
        "created_at": stamp,
        "last_seen_at": stamp,
        "ip": ip or None,
        "user_agent": (user_agent or "")[:500] or None,
        "service": service or None,
    }
    result = supabase.table("sessions").insert(row).execute()
    return {"token": token, "session": result.data[0]}


def revoke(supabase, session_id: str, *, reason: str = REVOKE_LOGOUT) -> bool:
    if not session_id:
        return False
    result = (
        supabase.table("sessions")
        .update({"revoked_at": to_iso(now()), "revoked_reason": reason})
        .eq("id", session_id)
        .is_("revoked_at", "null")
        .execute()
    )
    return bool(result.data)


def revoke_all(
    supabase, user_id: str, *, reason: str = REVOKE_LOGOUT_ALL, except_session_id: str | None = None
) -> int:
    """Revoke every live session for a user, optionally sparing one."""
    query = (
        supabase.table("sessions")
        .update({"revoked_at": to_iso(now()), "revoked_reason": reason})
        .eq("user_id", user_id)
        .is_("revoked_at", "null")
    )
    if except_session_id:
        query = query.neq("id", except_session_id)
    result = query.execute()
    return len(result.data or [])


def list_for_user(supabase, user_id: str) -> list:
    result = (
        supabase.table("sessions")
        .select("id, created_at, last_seen_at, ip, user_agent, service")
        .eq("user_id", user_id)
        .is_("revoked_at", "null")
        .order("last_seen_at", desc=True)
        .execute()
    )
    return result.data or []


def revoke_owned(supabase, user_id: str, session_id: str, *, reason: str = REVOKE_LOGOUT) -> bool:
    """Revoke a session, but only if it belongs to ``user_id``."""
    result = (
        supabase.table("sessions")
        .update({"revoked_at": to_iso(now()), "revoked_reason": reason})
        .eq("id", session_id)
        .eq("user_id", user_id)
        .is_("revoked_at", "null")
        .execute()
    )
    return bool(result.data)


# ── Login events ────────────────────────────────────────────────────────────

def record_login_event(
    supabase,
    *,
    user_id: str | None,
    service: str | None,
    success: bool,
    ip: str | None = None,
    user_agent: str | None = None,
    failure_reason: str | None = None,
) -> None:
    """
    Append to the authentication event log.

    Best effort by design: an analytics write must never break a login.
    """
    try:
        supabase.table("login_events").insert(
            {
                "user_id": user_id,
                "service": service,
                "success": success,
                "failure_reason": failure_reason,
                "ip": ip or None,
                "user_agent": (user_agent or "")[:500] or None,
                "created_at": to_iso(now()),
            }
        ).execute()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to record login event: %s", exc)

"""
Credit helpers — all credit logic lives here, no DB-side functions.

Two buckets, and one counter:

* ``users.credits_balance`` — credits remaining from the current subscription
  period. It is reset (never topped up) by every paid invoice, so leftovers do
  not roll over. A user with no plan has a balance from before plans existed and
  no allowance.

* ``users.temp_credits_balance`` — a JSONB list of expiring grants:
      [ { "amount": <int>, "expires_at": "<ISO-8601 UTC>" }, ... ]
  Grants are consumed FIFO (earliest-expiring first) and always before plan
  credits, which is what lets a user keep working once their allowance is gone.

* ``users.credits_used_current_period`` — consumption this period, counting both
  buckets. This is what the usage bar is drawn from, so spending temporary
  credits pushes usage past 100% of the plan allowance.

Every credit movement is also appended to `transactions`, through
``record_transaction`` — the single writer of that table.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

import pagination
import sessions
from constants import (
    CREDIT_IN_TYPES,
    CREDIT_OUT_TYPES,
    REVENUE_TX_TYPES,
    TX_STATUS_COMPLETED,
)

logger = logging.getLogger(__name__)


# ── The ledger ──────────────────────────────────────────────────────────────

def record_transaction(
    supabase,
    user_id: str,
    amount: int,
    type_: str,
    description: str,
    *,
    status: str = TX_STATUS_COMPLETED,
    **extra,
) -> None:
    """
    Append a row to `transactions`.

    Best effort: a ledger write must never fail the operation it records — the
    credit change is the source of truth, and the history is derived from it.
    The ``id`` is supplied rather than left to the database so the fake/PostgREST
    paths behave identically.

    ``extra`` passes additional columns through (e.g. `service`, the platform that
    recorded the spend). If such a column does not exist yet — its migration has
    not been applied — the insert is retried **without** the extra columns rather
    than losing the row, because an attribution column must never cost us the
    ledger entry it was meant to annotate.
    """
    row = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "amount": amount,
        "type": type_,
        "description": description,
        "status": status,
        "timestamp": sessions.now_iso(),
    }
    try:
        supabase.table("transactions").insert({**row, **extra}).execute()
        return
    except Exception as exc:
        if extra:
            logger.warning(
                "Transaction insert with extra columns failed (%s); retrying "
                "without them so the ledger row is not lost — has migration 006 "
                "been applied?",
                exc,
            )
            try:
                supabase.table("transactions").insert(row).execute()
                return
            except Exception as retry_exc:
                logger.error(
                    "Failed to record %s transaction for %s: %s",
                    type_,
                    user_id,
                    retry_exc,
                )
                return

        logger.error(
            "Failed to record %s transaction for %s: %s", type_, user_id, exc
        )


# ── Low-level helpers ───────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def error_status(exc: ValueError) -> int:
    """
    The HTTP status for a `ValueError` raised by this module.

    404 when the user does not exist, 400 for everything else (a bad expiry or an
    over-spend), so callers do not each re-derive it from the message text.
    """
    return 404 if "not found" in str(exc).lower() else 400


def make_grant(amount: int, *, expires_at=None, ttl_days: int | None = None) -> dict:
    """
    Build a temporary credit grant.

    An explicit `expires_at` (ISO-8601) wins; otherwise `ttl_days` is required.
    There is deliberately no built-in default: the configured lifetime lives in
    `Config.TEMP_GRANT_TTL_DAYS`, and the callers resolve it. A second default
    here would silently diverge from `SG_TEMP_GRANT_TTL_DAYS`.

    Raises ValueError on an unparseable date, a non-positive TTL, or neither
    input, so the caller can turn it into a 400 rather than a 500.
    """
    if expires_at:
        try:
            expiry = _parse_dt(str(expires_at))
        except (TypeError, ValueError):
            raise ValueError("expires_at must be an ISO-8601 timestamp") from None
        if expiry <= _now():
            raise ValueError("expires_at must be in the future")
    else:
        if ttl_days is None:
            raise ValueError("either expires_at or ttl_days is required")
        if ttl_days <= 0:
            raise ValueError("ttl_days must be positive")
        expiry = _now() + timedelta(days=ttl_days)

    return {"amount": amount, "expires_at": expiry.isoformat()}


def parse_grants(raw) -> list:
    """Safely parse the temp_credits_balance value from Supabase."""
    if not raw:
        return []
    if isinstance(raw, str):
        raw = json.loads(raw)
    return list(raw) if isinstance(raw, list) else []


def _parse_dt(s: str) -> datetime:
    return sessions.parse_dt(s)


def split_grants(grants: list) -> tuple:
    """Return (active_grants, expired_grants) with active sorted by earliest expiry."""
    now = _now()
    active, expired = [], []
    for g in grants:
        if _parse_dt(g["expires_at"]) > now:
            active.append(g)
        else:
            expired.append(g)
    active.sort(key=lambda g: g["expires_at"])
    return active, expired


def sum_active(grants: list) -> int:
    """Sum the amounts of already-filtered active grants."""
    return sum(g["amount"] for g in grants)


# ── High-level operations ────────────────────────────────────────────────────


def add_temp_credits(
    supabase,
    user_id: str,
    amount: int,
    *,
    expires_at=None,
    ttl_days: int | None = None,
) -> dict:
    """
    Append a new expiring grant to a user's temp_credits_balance.

    The expiry is chosen by the caller — the whole point of a temporary credit is
    that whoever grants it decides when it lapses. Pass `expires_at` or
    `ttl_days`; the configured default is applied by the caller.

    Returns { credits_balance, temp_credits, temp_grants, grant }.
    Raises ValueError if the user is missing or the expiry is invalid.
    """
    result = (
        supabase.table("users")
        .select("credits_balance, temp_credits_balance")
        .eq("id", user_id)
        .execute()
    )
    if not result.data:
        raise ValueError("User not found")

    user = result.data[0]
    active, _ = split_grants(parse_grants(user["temp_credits_balance"]))

    new_grant = make_grant(amount, expires_at=expires_at, ttl_days=ttl_days)
    active.append(new_grant)

    supabase.table("users").update(
        {"temp_credits_balance": active}
    ).eq("id", user_id).execute()

    return {
        "credits_balance": user["credits_balance"],
        "temp_credits": sum_active(active),
        "temp_grants": active,
        "grant": new_grant,
    }


def consume_credits(supabase, user_id: str, amount: int) -> dict:
    """
    Deduct `amount` from a user, draining temp grants FIFO first, then plan
    credits.

    Also advances `credits_used_current_period`, which is the figure the usage bar
    is drawn from. It counts the whole consumption regardless of which bucket paid
    for it, so spending temporary credits pushes usage past 100% of the plan
    allowance — the intended "overfilled bar" signal.

    Returns { credits_balance, temp_credits, temp_grants, credits_used_period }.
    Raises ValueError on user-not-found or insufficient credits.
    """
    # select("*") rather than a column list: the period counter is added by
    # migration 003, and a missing column must degrade to "not tracked" instead of
    # breaking every credit deduction.
    result = supabase.table("users").select("*").eq("id", user_id).execute()
    if not result.data:
        raise ValueError("User not found")

    user = result.data[0]
    perm = user.get("credits_balance") or 0
    active, _ = split_grants(parse_grants(user.get("temp_credits_balance")))
    temp_total = sum_active(active)

    if temp_total + perm < amount:
        raise ValueError("Insufficient credits")

    # Drain temp grants FIFO (earliest-expiring first)
    remaining = amount
    new_grants = []
    for g in active:
        if remaining == 0:
            new_grants.append(g)
            continue
        take = min(remaining, g["amount"])
        remaining -= take
        leftover = g["amount"] - take
        if leftover > 0:
            new_grants.append({**g, "amount": leftover})

    new_perm = perm - remaining  # remainder from the plan balance

    update = {"credits_balance": new_perm, "temp_credits_balance": new_grants}
    tracks_usage = "credits_used_current_period" in user
    if tracks_usage:
        update["credits_used_current_period"] = int(
            user.get("credits_used_current_period") or 0
        ) + amount

    supabase.table("users").update(update).eq("id", user_id).execute()

    return {
        "credits_balance": new_perm,
        "temp_credits": sum_active(new_grants),
        "temp_grants": new_grants,
        "credits_used_period": update.get("credits_used_current_period", 0),
    }


def get_balances(user_row: dict) -> dict:
    """
    Given a raw user row from Supabase, return clean balance info.
    Does NOT write back to the DB — call expire_stale_grants() to persist cleanup.
    """
    active, _ = split_grants(parse_grants(user_row.get("temp_credits_balance")))
    next_expiry = min((g["expires_at"] for g in active), default=None)
    return {
        "credits_balance": user_row.get("credits_balance", 0),
        "temp_credits": sum_active(active),
        "temp_grants": active,
        "temp_credits_next_expiry": next_expiry,
    }


def expire_stale_grants(supabase, user_id: str) -> list:
    """
    Persist removal of expired grants for a user.
    Returns the surviving active grants.
    Good to call on login.
    """
    result = (
        supabase.table("users")
        .select("temp_credits_balance")
        .eq("id", user_id)
        .execute()
    )
    if not result.data:
        return []
    active, expired = split_grants(parse_grants(result.data[0]["temp_credits_balance"]))
    if expired:
        supabase.table("users").update(
            {"temp_credits_balance": active}
        ).eq("id", user_id).execute()
    return active


# ── Bulk ledger reads ───────────────────────────────────────────────────────

def _empty_totals() -> dict:
    return {"bought": 0, "spent": 0, "euros": 0.0, "last_at": None, "count": 0}


def bulk_user_totals(supabase, user_ids, *, euro_value=None) -> dict:
    """
    Per-user aggregates from the ledger, for many users at once.

    Returns ``{user_id: {bought, spent, euros, last_at, count}}``. Used by the
    admin user list and by the streamer portal's network view, which are both
    reporting over a set of users rather than spending one.

    The `user_id` filter is chunked (every id goes in the URL) and each chunk is
    paged, so a ledger larger than PostgREST's 1,000-row cap is summed in full
    rather than silently truncated.

    ``euro_value(credits) -> float`` is supplied by the caller: converting granted
    credits to money is a *plan* fact, and `plans` imports this module, so the
    mapping cannot live here without a cycle.
    """
    totals = {str(uid): _empty_totals() for uid in user_ids or []}
    if not totals:
        return totals

    for chunk in pagination.chunked(list(totals)):
        rows = pagination.fetch_all(
            lambda offset, limit, chunk=chunk: (
                supabase.table("transactions")
                .select("user_id, amount, type, timestamp")
                .in_("user_id", chunk)
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )
        )

        for row in rows:
            uid = str(row.get("user_id"))
            entry = totals.get(uid)
            if entry is None:
                continue

            amount = _safe_amount(row.get("amount"))
            tx_type = str(row.get("type") or "").lower()
            entry["count"] += 1

            timestamp = row.get("timestamp")
            if timestamp and (entry["last_at"] is None or timestamp > entry["last_at"]):
                entry["last_at"] = timestamp

            if is_credit_in(row):
                entry["bought"] += amount
                if tx_type in REVENUE_TX_TYPES and euro_value is not None:
                    entry["euros"] += euro_value(amount)
            elif is_credit_out(row):
                entry["spent"] += abs(amount)

    return totals


def _safe_amount(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def is_credit_in(transaction) -> bool:
    """Did this ledger row add credits? (a positive amount of a credit-in type)"""
    return (
        _safe_amount(transaction.get("amount")) > 0
        and str(transaction.get("type") or "").lower() in CREDIT_IN_TYPES
    )


def is_credit_out(transaction) -> bool:
    """Did this ledger row remove credits?"""
    amount = _safe_amount(transaction.get("amount"))
    return amount < 0 or str(transaction.get("type") or "").lower() in CREDIT_OUT_TYPES

"""
Admin routes — customer analytics and telemetry.

Access is gated by the ADMIN_CODE shared secret, which is read from the
environment. It has no source-code default: the previous version shipped
"FZTH_ADMIN_2024" in the repository, which is a published credential.

architecture/08 replaces this with real admin identities and roles; until then
the shared secret is at least configurable and revocable without a deploy.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps

import requests
from flask import Blueprint, current_app, g, jsonify, request

import auth
import db
import plans
import sessions
import streamers
import totp
from auth_utils import hash_password
from constants import PLAN_BEARING_STATUSES, REVENUE_TX_TYPES, TX_BONUS
from credits import (
    add_temp_credits,
    bulk_user_totals,
    get_balances,
    is_credit_in,
    is_credit_out,
    record_transaction,
)
from email_service import MAX_BATCH_SIZE, EmailService, build_campaign_bodies
from extensions import limiter
from pagination import DEFAULT_PAGE_SIZE as MAX_PAGE_SIZE, fetch_all
from routes_chat import (
    MAX_MESSAGE_LENGTH as MAX_CHAT_MESSAGE_LENGTH,
    MAX_OPEN_CONVERSATIONS_PER_USER,
    last_messages_by_conversation,
)

logger = logging.getLogger(__name__)

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")


# ── Auth ────────────────────────────────────────────────────────────────────


def _admin_code_matches(provided) -> bool:
    """
    Constant-time comparison of the admin shared secret.

    `provided` comes from a header or a JSON body, so it is not guaranteed to be a
    string — a non-string must fail the check rather than raise.
    """
    expected = (current_app.config["ADMIN_CODE"] or "").strip()
    if not expected or not isinstance(provided, str):
        return False
    return hmac.compare_digest(expected, provided.strip())


def _ip_allowed(ip: str | None) -> bool:
    """
    Is this address inside `SG_ADMIN_IP_ALLOWLIST`?

    An empty allowlist means "no restriction". When one is configured, an
    unparseable or missing address is refused: this control exists to keep the
    admin surface off the open internet, so it has to fail closed.
    """
    allowlist = current_app.config["ADMIN_IP_ALLOWLIST"]
    if not allowlist:
        return True
    if not ip:
        return False

    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False

    for entry in allowlist:
        try:
            if "/" in entry:
                if address in ipaddress.ip_network(entry, strict=False):
                    return True
            elif address == ipaddress.ip_address(entry):
                return True
        except ValueError:
            # A malformed entry must not silently widen access. Report it once per
            # request rather than at import time, so a bad value is visible in the
            # logs next to the 403 it caused.
            logger.error("Ignoring a malformed SG_ADMIN_IP_ALLOWLIST entry: %r", entry)
    return False


def _totp_problem() -> tuple | None:
    """
    ``(response, status)`` when the second factor is missing or wrong, else None.

    When `SG_ADMIN_TOTP_SECRET` is unset the surface runs single-factor: the
    shared code alone opens it. The operator chose this trade-off explicitly, so
    it is allowed in production too — and logged, because a leaked string is then
    all it takes.
    """
    secret = current_app.config["ADMIN_TOTP_SECRET"]

    if not secret:
        logger.warning("SG_ADMIN_TOTP_SECRET is unset: admin request authorized by the shared code alone.")
        return None

    if not totp.verify(secret, request.headers.get("X-Admin-TOTP") or ""):
        logger.warning("Rejected an admin request with a missing or invalid TOTP code.")
        return jsonify({"error": "Unauthorized"}), 401

    return None


def admin_auth_required(f):
    """
    Guard for admin-only routes.

    Three independent checks, cheapest and most decisive first:

      1. **Source address** against `SG_ADMIN_IP_ALLOWLIST` (opt-in). Refused
         before a credential is even examined.
      2. **The shared code**, header only. Accepting it in the query string would
         write it into access logs, browser history and `Referer` headers.
      3. **A TOTP code**, but only when `SG_ADMIN_TOTP_SECRET` is set. Without a
         secret the surface runs single-factor by explicit operator choice.

    On success it marks the request as authenticated, which is what the audit
    hook below records.
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        client = auth.client_ip()
        if not _ip_allowed(client):
            logger.warning("Rejected an admin request from %s (not allowed)", client)
            return jsonify({"error": "Forbidden"}), 403

        if not _admin_code_matches(request.headers.get("X-Admin-Code")):
            logger.warning("Rejected an admin request with an invalid code.")
            return jsonify({"error": "Unauthorized"}), 401

        problem = _totp_problem()
        if problem:
            return problem

        g.admin_authenticated = True
        return f(*args, **kwargs)

    return decorated_function


@admin_bp.after_request
def _record_admin_action(response):
    """
    Append every authenticated admin request to `admin_audit_log`.

    Detection, not prevention: if the credential ever leaks, this is the only
    thing that says what was done with it, from where, and when. Best effort — an
    audit write must never turn a successful action into an error the operator
    cannot see past, so a failure is logged loudly and the response stands.
    """
    if not getattr(g, "admin_authenticated", False):
        return response

    try:
        db.require_client().table("admin_audit_log").insert(
            {
                "method": request.method,
                "path": request.path,
                "status": response.status_code,
                "ip": auth.client_ip(),
                "user_agent": (auth.user_agent() or "")[:500] or None,
                "actor": "shared_admin_code",
                # What the action actually did ("granted 50 credits, reason: …").
                # Views set `g.admin_action_detail`; reads leave it NULL. The
                # column is added by migration 007 — on a database without it
                # the insert fails, is logged below, and the response stands.
                "detail": getattr(g, "admin_action_detail", None),
            }
        ).execute()
    except Exception as exc:
        logger.error("Could not write the admin audit record: %s", exc)

    return response


@admin_bp.route("/login", methods=["POST"])
@limiter.limit("10 per minute")
def admin_login():
    """
    Check the admin credentials without performing an action.

    The admin frontend calls this to decide whether to show the UI. It grants
    nothing on its own — every real endpoint re-checks the same credentials — so
    it is a convenience, not a session.
    """
    if not _ip_allowed(auth.client_ip()):
        logger.warning("Rejected an admin login from a disallowed address")
        return jsonify({"error": "Forbidden"}), 403

    data = request.get_json(silent=True) or {}

    if not _admin_code_matches(data.get("code")):
        return jsonify({"error": "Invalid admin code"}), 401

    secret = current_app.config["ADMIN_TOTP_SECRET"]
    if secret:
        provided = str(
            data.get("totp") or request.headers.get("X-Admin-TOTP") or ""
        )
        if not totp.verify(secret, provided):
            logger.warning("Rejected an admin login with an invalid TOTP code.")
            return jsonify({"error": "Invalid second factor"}), 401

    return jsonify({"message": "Admin authenticated"})


def _safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _exact_count(result, rows) -> int:
    """
    PostgREST's exact count when the caller asked for it, else the row count.

    A `count="exact"` request returns the true total alongside a possibly capped
    page, so preferring it is what keeps a statistic correct past 1,000 rows.
    """
    count = getattr(result, "count", None)
    return int(count) if count is not None else len(rows)


def _admin_page_params(prefix: str = "") -> tuple:
    """
    `(page, per_page)` from the query string, clamped.

    `prefix` allows one endpoint to page two collections independently, e.g.
    `?users_page=2&subordinates_page=1`. Clamped rather than trusted: `0` would
    divide by zero and an unbounded value would defeat the paging.
    """
    key = f"{prefix}_" if prefix else ""
    try:
        page = max(1, _safe_int(request.args.get(f"{key}page"), 1))
        per_page = max(
            1,
            min(MAX_PAGE_SIZE, _safe_int(request.args.get(f"{key}per_page"), 50)),
        )
    except (TypeError, ValueError):
        page, per_page = 1, 50
    return page, per_page


def _admin_paginate(rows: list, page: int, per_page: int) -> dict:
    """Slice a page out of `rows` and describe it, in the admin envelope shape."""
    total = len(rows)
    start = (page - 1) * per_page
    return {
        "items": rows[start : start + per_page],
        "meta": {
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page,
        },
    }


def _admin_sort_params(allowed: tuple, default: str, default_desc: bool = True):
    """
    ``(column, descending)`` for the request's `sort`/`order` params, or
    ``None`` when either is invalid — the caller answers 400 and names the
    whitelist.

    The whitelist is the whole point: the chosen column goes straight into a
    PostgREST `order()` call, so it must be one of these constants and never
    raw caller input.
    """
    sort = (request.args.get("sort") or "").strip() or default
    if sort not in allowed:
        return None
    order = (request.args.get("order") or "").strip().lower()
    if order not in ("", "asc", "desc"):
        return None
    descending = default_desc if not order else order == "desc"
    return sort, descending


def _date_bound(value, *, end_of_day: bool):
    """
    An ISO date/datetime query value as a timestamp bound, or ``None``.

    A bare `YYYY-MM-DD` means the start of that day for a lower bound and the
    end of it for an upper bound, so `created_from=2026-09-01&created_to=
    2026-09-21` covers the whole last day instead of its first second. Raises
    ``ValueError`` on anything unparseable; the caller turns that into a 400.
    """
    raw = (value or "").strip()
    if not raw:
        return None
    candidate = raw
    if len(raw) == 10:  # YYYY-MM-DD
        candidate = raw + ("T23:59:59.999999+00:00" if end_of_day else "T00:00:00+00:00")
    try:
        return sessions.parse_dt(candidate).isoformat()
    except (TypeError, ValueError):
        raise ValueError(f"Invalid ISO date: {raw!r}") from None


def _invalid_sort(allowed: tuple):
    return (
        jsonify({"error": f"Invalid sort or order. Sortable columns: {', '.join(allowed)}"}),
        400,
    )


def _total_available_credits(user: dict) -> int:
    """
    Everything the user can actually spend: plan credits plus still-valid
    temporary credits.

    `credits_balance` alone is only the unused plan allowance, so anything that
    filters or reports on it in isolation understates a user's real balance — and
    wrongly excludes users whose balance is entirely temporary credits.
    """
    balances = get_balances(user)
    return balances["credits_balance"] + balances["temp_credits"]


def _estimated_revenue(transactions) -> float:
    """
    Revenue implied by the ledger.

    Only a grant that corresponds to money moving counts: a `subscription_grant`
    is written once per paid invoice and a `purchase` is a completed legacy
    payment, so their amounts map to a real price via
    `plans.euro_value_of_credits`. `bonus` credits (referral, signup, admin) are
    free and contribute nothing. This replaces a flat "credits x a fixed rate"
    estimate, which double-counted renewals and contradicted its own comment.
    """
    total = 0.0
    for tx in transactions or []:
        if str(tx.get("type") or "").lower() not in REVENUE_TX_TYPES:
            continue
        total += plans.euro_value_of_credits(_safe_int(tx.get("amount"), 0))
    return total


def _user_totals(supabase, user_ids):
    """
    Bought/spent credits per user, from the shared bulk ledger read.

    Kept as a thin adapter so the user list keeps its `credits_bought` /
    `credits_spent` keys while the paging and chunking live in `credits`. The
    euro value of a grant is a plan fact, so it is passed in rather than imported
    there.
    """
    totals = bulk_user_totals(
        supabase, user_ids, euro_value=plans.euro_value_of_credits
    )
    bought = {uid: entry["bought"] for uid, entry in totals.items()}
    spent = {uid: entry["spent"] for uid, entry in totals.items()}
    return bought, spent


def _ai_usage_by_streamer(supabase, *, days: int) -> dict:
    """
    ``{streamer_id: {requests, cost}}`` over the last `days` days, in one pass.

    The streamer list needs this per row; querying it per row made the endpoint
    N+1 and made each query vulnerable to the 1,000-row cap independently.
    """
    since = (sessions.now() - timedelta(days=days)).isoformat()
    try:
        rows = fetch_all(
            lambda offset, limit: (
                supabase.table("ai_usage_logs")
                .select("streamer_id, cost_estimate")
                .not_.is_("streamer_id", "null")
                .gte("created_at", since)
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )
        )
    except Exception as exc:
        # `ai_usage_logs` is written by the platforms and may not exist yet.
        logger.error("ai_usage_logs query failed: %s", exc)
        return {}

    usage: dict = {}
    for row in rows:
        key = str(row.get("streamer_id"))
        entry = usage.setdefault(key, {"requests": 0, "cost": 0.0})
        entry["requests"] += 1
        entry["cost"] = round(entry["cost"] + _safe_float(row.get("cost_estimate")), 6)
    return usage


def _parse_iso_datetime(raw_value):
    """
    Parse a stored timestamp to an aware UTC datetime, or ``None``.

    The result is timezone-aware, which is what makes the subtraction in
    `_days_since` well-defined when the server's local timezone is not UTC.
    """
    if not raw_value:
        return None
    try:
        return sessions.parse_dt(raw_value)
    except (TypeError, ValueError):
        logger.warning("Unparseable timestamp in an admin filter: %r", raw_value)
        return None


def _days_since(raw_value):
    parsed = _parse_iso_datetime(raw_value)
    if not parsed:
        return None
    return (sessions.now() - parsed).total_seconds() / 86400


def _normalize_campaign_filters(filters):
    filters = filters or {}
    return {
        "search": str(filters.get("search", "")).strip().lower(),
        "verified_status": str(filters.get("verified_status", "all")).strip().lower(),
        "min_credits": _safe_int(filters.get("min_credits"), 0),
        "created_within_days": _safe_int(filters.get("created_within_days"), 0),
        "active_within_days": _safe_int(filters.get("active_within_days"), 0),
        "inactive_days_over": _safe_int(filters.get("inactive_days_over"), 0),
        "referral_type": str(filters.get("referral_type", "all")).strip().lower(),
        "tag_contains": str(filters.get("tag_contains", "")).strip().lower(),
    }


def _normalize_email_list(raw_emails):
    normalized = []
    seen = set()
    for raw in raw_emails or []:
        email = str(raw or "").strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        normalized.append(email)
    return normalized


def _filter_users_for_campaign(users, normalized_filters):
    filtered = []
    for user in users:
        email = str(user.get("email") or "").strip().lower()
        if not email:
            continue

        username = str(user.get("username") or "").strip()
        email_verified = bool(user.get("email_verified"))
        credits_balance = _safe_int(user.get("credits_balance"), 0)
        available_credits = _total_available_credits(user)
        created_at = user.get("created_at")
        last_login = user.get("last_login")
        tag = str(user.get("tag") or "").strip().lower()
        referred_by = user.get("referred_by")
        referred_by_streamer = user.get("referred_by_streamer")

        search = normalized_filters["search"]
        if search and search not in username.lower() and search not in email:
            continue

        verified_status = normalized_filters["verified_status"]
        if verified_status == "verified" and not email_verified:
            continue
        if verified_status == "unverified" and email_verified:
            continue

        min_credits = normalized_filters["min_credits"]
        if min_credits > 0 and available_credits < min_credits:
            continue

        created_within_days = normalized_filters["created_within_days"]
        if created_within_days > 0:
            created_age = _days_since(created_at)
            if created_age is None or created_age > created_within_days:
                continue

        active_within_days = normalized_filters["active_within_days"]
        if active_within_days > 0:
            last_login_age = _days_since(last_login)
            if last_login_age is None or last_login_age > active_within_days:
                continue

        inactive_days_over = normalized_filters["inactive_days_over"]
        if inactive_days_over > 0:
            last_login_age = _days_since(last_login)
            if last_login_age is None or last_login_age < inactive_days_over:
                continue

        referral_type = normalized_filters["referral_type"]
        if referral_type == "user" and not referred_by:
            continue
        if referral_type == "streamer" and not referred_by_streamer:
            continue
        if referral_type == "none" and (referred_by or referred_by_streamer):
            continue

        tag_contains = normalized_filters["tag_contains"]
        if tag_contains and tag_contains not in tag:
            continue

        filtered.append(user)

    return filtered


CAMPAIGN_USER_COLUMNS = (
    "id, username, email, email_verified, created_at, last_login, "
    "credits_balance, temp_credits_balance, referred_by, referred_by_streamer, tag"
)

USER_LIST_COLUMNS = (
    "id, username, email, tag, credits_balance, temp_credits_balance, "
    "email_verified, created_at, last_login, "
    "referral_code, referred_by, referred_by_streamer, stripe_customer_id"
)

# The only columns the list endpoints will ever order by. A `sort` value goes
# into a PostgREST `order()` call, so it is checked against these constants
# and never passed through raw.
USER_SORT_COLUMNS = (
    "created_at",
    "last_login",
    "last_activity_at",
    "credits_balance",
    "username",
    "email",
)
TRANSACTION_SORT_COLUMNS = ("timestamp", "amount", "type", "status")
STREAMER_SORT_COLUMNS = (
    "created_at",
    "referred_num",
    "total_earned",
    "balance_available",
)

# How many sample recipients a preview returns (the full count is returned too).
PREVIEW_RECIPIENT_LIMIT = 200
# A campaign above this size is refused rather than half-delivered inside the
# request timeout.
MAX_CAMPAIGN_RECIPIENTS = 3000
# Per-recipient failure detail kept in the response, so one bad address cannot
# produce a multi-megabyte body.
REPORTED_ERROR_LIMIT = 20


def _require_hosted_images(payload):
    """
    Refuse a campaign whose images are embedded base64.

    `email_service.sanitize_image_src` accepts `data:` URLs, and the single-send
    path turns them into inline CID attachments. **The batch endpoint cannot carry
    attachments at all**, so a campaign with an embedded image would either fail
    outright or silently lose the image.

    Embedding also duplicates the image into every copy of the email, so hosting
    it and passing the URL is the better answer regardless of batching.
    """
    offenders = [
        field
        for field in ("banner_image", "logo_image")
        if str(payload.get(field) or "").strip().startswith("data:image/")
    ]
    if not offenders:
        return None
    return (
        "Campaign images must be hosted URLs, not embedded base64. Replace the "
        "inline image in: " + ", ".join(offenders) + "."
    )


def _load_campaign_users(supabase):
    """
    Every user a campaign may target.

    Paginated, because PostgREST caps a single response at 1,000 rows — an
    unpaginated read would quietly cap every campaign at its first thousand
    recipients. The explicit order keeps paging stable: without it Postgres is
    free to reorder between requests and rows can be skipped or repeated.
    """
    return fetch_all(
        lambda offset, limit: (
            supabase.table("users")
            .select(CAMPAIGN_USER_COLUMNS)
            .order("email")
            .range(offset, offset + limit - 1)
            .execute()
            .data
        )
    )


def _record_email_campaign(
    supabase,
    *,
    mode: str,
    subject: str,
    heading: str,
    filters: dict,
    recipients_count: int,
    sent: int,
    failed: int,
    campaign_id: str,
):
    """
    One history row per send, best effort.

    The table comes from migration 008; on a database without it the insert
    fails, is logged, and the send result stands — recording history must never
    turn a delivered campaign into an error.
    """
    try:
        supabase.table("email_campaigns").insert(
            {
                "mode": mode,
                "subject": subject,
                "heading": heading,
                "filters": filters,
                "recipients_count": recipients_count,
                "sent": sent,
                "failed": failed,
                "campaign_id": campaign_id,
            }
        ).execute()
    except Exception as exc:
        logger.warning(
            "Could not record the email campaign (has migration 008 been applied?): %s",
            exc,
        )


@admin_bp.route("/email-campaign/preview", methods=["POST"])
@limiter.limit("30 per minute")
@admin_auth_required
def preview_email_campaign():
    """Preview recipients count for an internal email campaign."""
    try:
        supabase = db.require_client()
        data = request.get_json() or {}
        filters = _normalize_campaign_filters(data.get("filters"))

        # Non-blocking here: the operator should still see recipient counts while
        # fixing an image, but the send endpoint will refuse the same payload.
        image_warnings = [
            message
            for message in (
                _require_hosted_images(
                    {
                        "banner_image": data.get("banner_image"),
                        "logo_image": data.get("logo_image"),
                    }
                ),
            )
            if message
        ]

        users = _load_campaign_users(supabase)
        recipients = _filter_users_for_campaign(users, filters)

        recipients_preview = [
            {
                "email": u.get("email"),
                "username": u.get("username") or "",
                "email_verified": bool(u.get("email_verified")),
                "credits_balance": _safe_int(u.get("credits_balance"), 0),
                "last_login": u.get("last_login"),
                "created_at": u.get("created_at"),
                "tag": u.get("tag") or "",
                "referral_type": (
                    "streamer"
                    if u.get("referred_by_streamer")
                    else "user" if u.get("referred_by") else "none"
                ),
            }
            for u in recipients[:PREVIEW_RECIPIENT_LIMIT]
        ]
        recipient_emails = sorted(
            _normalize_email_list([u.get("email") for u in recipients])
        )

        verified_count = sum(1 for u in recipients if bool(u.get("email_verified")))
        unverified_count = len(recipients) - verified_count
        active_30d_count = 0
        inactive_30d_count = 0
        for u in recipients:
            last_login_age = _days_since(u.get("last_login"))
            if last_login_age is None or last_login_age > 30:
                inactive_30d_count += 1
            else:
                active_30d_count += 1

        return jsonify(
            {
                "filters": filters,
                "warnings": image_warnings,
                "recipients_count": len(recipients),
                "verified_count": verified_count,
                "unverified_count": unverified_count,
                "active_30d_count": active_30d_count,
                "inactive_30d_count": inactive_30d_count,
                "preview_limit": PREVIEW_RECIPIENT_LIMIT,
                "recipients_preview": recipients_preview,
                "recipient_emails": recipient_emails,
            }
        )
    except Exception as e:
        logger.error("Email campaign preview error: %s", e)
        return jsonify({"error": "Failed to preview email recipients"}), 500


@admin_bp.route("/email-campaign/render", methods=["POST"])
@limiter.limit("30 per minute")
@admin_auth_required
def render_email_campaign():
    """Render the campaign email HTML for preview purposes; never sends anything."""
    try:
        data = request.get_json() or {}
        heading = str(data.get("heading") or "").strip()

        payload = {
            "heading": heading,
            "intro_text": str(data.get("intro_text") or "").strip(),
            "body_text": str(data.get("body_text") or "").strip(),
            "footer_note": str(data.get("footer_note") or "").strip()
            or "Il team di From Zero To Hero",
            "cta_text": str(data.get("cta_text") or "").strip(),
            "cta_url": str(data.get("cta_url") or "").strip(),
            "banner_image": str(data.get("banner_image") or "").strip(),
            "logo_image": str(data.get("logo_image") or "").strip(),
        }
        image_error = _require_hosted_images(payload)
        if image_error:
            return jsonify({"error": image_error}), 400

        # A fixed sample username, so the operator sees the greeting exactly as a
        # recipient would. Empty intro/body renders fine — this is a preview.
        html_body, _ = build_campaign_bodies(payload, "Mario Rossi")
        return jsonify({"html": html_body})
    except Exception as e:
        logger.error("Email campaign render error: %s", e)
        return jsonify({"error": "Failed to render the campaign email"}), 500


@admin_bp.route("/email-campaign/send", methods=["POST"])
@limiter.limit("5 per minute")
@admin_auth_required
def send_email_campaign():
    """Send an internal email campaign with simple filtering."""
    try:
        supabase = db.require_client()
        data = request.get_json() or {}
        filters = _normalize_campaign_filters(data.get("filters"))
        recipient_emails = _normalize_email_list(data.get("recipient_emails") or [])
        exclude_emails = set(_normalize_email_list(data.get("exclude_emails") or []))

        # `or ""` rather than a `.get` default: a client sending `{"subject": null}`
        # (what an empty form field usually serialises to) would otherwise become
        # the literal string "None", which is truthy and non-empty.
        subject = str(data.get("subject") or "").strip()
        heading = str(data.get("heading") or "").strip()
        intro_text = str(data.get("intro_text") or "").strip()
        body_text = str(data.get("body_text") or "").strip()
        footer_note = str(data.get("footer_note") or "").strip()
        cta_text = str(data.get("cta_text") or "").strip()
        cta_url = str(data.get("cta_url") or "").strip()
        banner_image = str(data.get("banner_image") or "").strip()
        logo_image = str(data.get("logo_image") or "").strip()
        test_email = str(data.get("test_email") or "").strip().lower()

        if not subject:
            return jsonify({"error": "Subject is required"}), 400
        if not intro_text and not body_text:
            return jsonify({"error": "Write at least intro or body text"}), 400

        payload = {
            "heading": heading,
            "intro_text": intro_text,
            "body_text": body_text,
            "footer_note": footer_note or "Il team di From Zero To Hero",
            "cta_text": cta_text,
            "cta_url": cta_url,
            "banner_image": banner_image,
            "logo_image": logo_image,
        }
        # Refuse embedded images before a single email goes out, rather than
        # half-way through a campaign.
        image_error = _require_hosted_images(payload)
        if image_error:
            return jsonify({"error": image_error}), 400

        # Reuse this id when resuming a partially delivered campaign: it is the
        # basis of the per-batch idempotency keys.
        campaign_id = str(data.get("campaign_id") or "").strip() or str(uuid.uuid4())
        email_service = EmailService()

        if test_email:
            html_body, text_body = build_campaign_bodies(payload, "Test user")
            email_service.send_email(test_email, subject, html_body, text_body)
            _record_email_campaign(
                supabase,
                mode="test",
                subject=subject,
                heading=payload["heading"],
                filters=filters,
                recipients_count=1,
                sent=1,
                failed=0,
                campaign_id=campaign_id,
            )
            g.admin_action_detail = (
                f"Sent a test email to {test_email} "
                f"(subject {subject!r}, campaign {campaign_id})"
            )
            return jsonify(
                {
                    "mode": "test",
                    "campaign_id": campaign_id,
                    "sent": 1,
                    "failed": 0,
                    "recipients_count": 1,
                }
            )

        users = _load_campaign_users(supabase)

        if recipient_emails:
            recipient_set = set(recipient_emails)
            recipients = [
                u
                for u in users
                if str(u.get("email") or "").strip().lower() in recipient_set
            ]
        else:
            recipients = _filter_users_for_campaign(users, filters)
        recipients = sorted(
            recipients, key=lambda user: str(user.get("email") or "").strip().lower()
        )

        if exclude_emails:
            recipients = [
                u
                for u in recipients
                if str(u.get("email") or "").strip().lower() not in exclude_emails
            ]

        if not recipients:
            return jsonify({"error": "No recipients with current filters"}), 400

        if len(recipients) > MAX_CAMPAIGN_RECIPIENTS:
            return jsonify(
                {
                    "error": (
                        "Too many recipients. Please narrow filters under "
                        f"{MAX_CAMPAIGN_RECIPIENTS} users."
                    )
                }
            ), 400

        # Recipients we can actually address, in a stable order.
        addressable = []
        for user in recipients:
            user_email = str(user.get("email") or "").strip().lower()
            if user_email:
                addressable.append(
                    (
                        user_email,
                        str(user.get("username") or user_email.split("@")[0]).strip(),
                    )
                )

        sent = 0
        failed = 0
        batches = 0
        sent_emails = []
        failed_recipients = []
        errors = []

        # Batched: 100 recipients per Resend call instead of one call each. A
        # per-recipient loop cannot finish inside a function timeout — 3,000
        # sequential API calls is tens of minutes — whereas 30 batched calls fit
        # comfortably. Messages are built one batch at a time so a large campaign
        # does not hold every rendered email in memory at once.
        for start in range(0, len(addressable), MAX_BATCH_SIZE):
            chunk = addressable[start : start + MAX_BATCH_SIZE]
            batches += 1

            messages = []
            for user_email, username in chunk:
                html_body, text_body = build_campaign_bodies(payload, username)
                messages.append(
                    {
                        "from": f"{email_service.from_name} <{email_service.from_email}>",
                        "to": [user_email],
                        "subject": subject,
                        "html": html_body,
                        "text": text_body,
                    }
                )

            # Idempotency is per batch *and per recipient set*.
            #
            # Keying on the batch index alone would be wrong: if the recipient list
            # shifted between the first attempt and a retry — one new signup is
            # enough — a different group of 100 would inherit an already-used key
            # and Resend would silently skip it. Fingerprinting the recipients
            # means the same people get the same key (safe to retry) while a
            # different group gets a fresh one.
            fingerprint = hashlib.sha256(
                "\n".join(user_email for user_email, _ in chunk).encode("utf-8")
            ).hexdigest()[:16]
            idempotency_key = f"campaign-{campaign_id}-{fingerprint}"

            try:
                email_service.send_campaign_batch(
                    messages, idempotency_key=idempotency_key
                )
                sent += len(chunk)
                sent_emails.extend(user_email for user_email, _ in chunk)
            except Exception as send_exc:
                # The whole batch is reported as failed. Which of the 100 actually
                # landed is unknowable from here, and the idempotency key is what
                # makes the retry safe.
                failed += len(chunk)
                logger.error("Campaign batch %s failed: %s", idempotency_key, send_exc)
                for user_email, _ in chunk:
                    failure = {"email": user_email, "error": str(send_exc)}
                    failed_recipients.append(failure)
                    if len(errors) < REPORTED_ERROR_LIMIT:
                        errors.append(failure)

        # A single explicit recipient with no filters is a one-off email from a
        # customer page, recorded apart from segment campaigns.
        mode = (
            "single"
            if len(recipient_emails) == 1 and not (data.get("filters") or {})
            else "campaign"
        )
        _record_email_campaign(
            supabase,
            mode=mode,
            subject=subject,
            heading=payload["heading"],
            filters=filters,
            recipients_count=len(recipients),
            sent=sent,
            failed=failed,
            campaign_id=campaign_id,
        )
        g.admin_action_detail = (
            f"Email campaign {campaign_id} ({mode}): subject {subject!r}, "
            f"{len(recipients)} recipients, {sent} sent, {failed} failed"
        )

        return jsonify(
            {
                "mode": "campaign",
                "campaign_id": campaign_id,
                "recipients_count": len(recipients),
                "batches": batches,
                "sent": sent,
                "failed": failed,
                "errors": errors,
                "sent_emails": sent_emails,
                "failed_recipients": failed_recipients,
                "excluded_count": len(exclude_emails),
            }
        )
    except Exception as e:
        logger.error("Email campaign send error: %s", e)
        return jsonify({"error": "Failed to send campaign"}), 500


@admin_bp.route("/email-campaign/history", methods=["GET"])
@admin_auth_required
def email_campaign_history():
    """
    Past campaign sends, newest first, in the standard admin list envelope.

    The `email_campaigns` table comes from migration 008; on a database without
    it this answers 200 with an empty list and `history_available: false` rather
    than a 500, so the admin UI can tell "not migrated" from "nothing sent yet".
    """
    try:
        supabase = db.require_client()
        page = max(1, _safe_int(request.args.get("page"), 1))
        per_page = max(1, min(MAX_PAGE_SIZE, _safe_int(request.args.get("per_page"), 20)))
        start = (page - 1) * per_page

        try:
            result = (
                supabase.table("email_campaigns")
                .select("*", count="exact")
                .order("created_at", desc=True)
                .range(start, start + per_page - 1)
                .execute()
            )
        except Exception as exc:
            logger.warning(
                "email_campaigns history query failed (has migration 008 been applied?): %s",
                exc,
            )
            return jsonify(
                {
                    "history_available": False,
                    "campaigns": [],
                    "total": 0,
                    "page": page,
                    "per_page": per_page,
                    "total_pages": 0,
                }
            )

        total = _exact_count(result, result.data or [])
        return jsonify(
            {
                "history_available": True,
                "campaigns": list(result.data or []),
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page,
            }
        )

    except Exception as e:
        logger.error("Admin email campaign history error: %s", e)
        return jsonify({"error": "Failed to fetch the campaign history"}), 500


@admin_bp.route("/stats", methods=["GET"])
@admin_auth_required
def get_stats():
    """Get aggregate statistics"""
    try:
        supabase = db.require_client()
        # Total users
        users_result = supabase.table("users").select("id", count="exact").execute()
        total_users = _exact_count(users_result, users_result.data or [])

        # Total credits in circulation
        credits_data = fetch_all(
            lambda offset, limit: (
                supabase.table("users")
                .select("id, credits_balance, temp_credits_balance")
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )
        )
        # Includes temporary credits: reporting only the plan allowance made every
        # granted bonus credit invisible in "credits in circulation".
        total_credits = sum(_total_available_credits(u) for u in credits_data)

        # Active today (last 24 hours)
        day_ago = (sessions.now() - timedelta(days=1)).isoformat()
        active_result = (
            supabase.table("users")
            .select("id", count="exact")
            .gte("last_login", day_ago)
            .execute()
        )
        active_today = _exact_count(active_result, active_result.data or [])

        # Unverified users
        unverified_result = (
            supabase.table("users")
            .select("id", count="exact")
            .eq("email_verified", False)
            .execute()
        )
        unverified = _exact_count(unverified_result, unverified_result.data or [])

        # New users this week
        week_ago = (sessions.now() - timedelta(days=7)).isoformat()
        new_week_result = (
            supabase.table("users")
            .select("id", count="exact")
            .gte("created_at", week_ago)
            .execute()
        )
        new_this_week = _exact_count(new_week_result, new_week_result.data or [])

        # Credits granted, from transactions. Filtering on `type == "purchase"` —
        # the retired one-off pack type — silently reported ~0 for every subscriber.
        # Paginated, because PostgREST caps a response at 1,000 rows and a truncated
        # sum is worse than no sum.
        tx_data = fetch_all(
            lambda offset, limit: (
                supabase.table("transactions")
                .select("amount, type, timestamp")
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )
        )
        total_purchased = sum(
            _safe_int(t.get("amount"), 0) for t in tx_data if is_credit_in(t)
        )

        # Revenue is derived from the plan price of each subscription grant, so it
        # tracks real paid invoices instead of a fixed rate per credit.
        total_revenue = _estimated_revenue(tx_data)

        # The same figures over the last 30 days. Timestamps are written as
        # ISO-8601 UTC strings, so a lexicographic comparison is a date filter.
        month_ago = (sessions.now() - timedelta(days=30)).isoformat()
        tx_30d = [t for t in tx_data if str(t.get("timestamp") or "") >= month_ago]
        revenue_30d = _estimated_revenue(tx_30d)
        credits_spent_30d = sum(
            abs(_safe_int(t.get("amount"), 0)) for t in tx_30d if is_credit_out(t)
        )

        # Users who ever paid.
        paying_result = (
            supabase.table("users")
            .select("id", count="exact")
            .eq("has_purchased", True)
            .execute()
        )
        paying_users = _exact_count(paying_result, paying_result.data or [])

        # Subscriptions currently providing credits, grouped by plan. One
        # paginated read of the bearing rows: the set is bounded by the user
        # count, and PostgREST cannot GROUP BY. MRR sums the *current* plan
        # price from the plans config, so it moves with a price change.
        try:
            sub_rows = fetch_all(
                lambda offset, limit: (
                    supabase.table("subscriptions")
                    .select("plan_id, status, cancel_at_period_end")
                    .in_("status", sorted(PLAN_BEARING_STATUSES))
                    .order("id")
                    .range(offset, offset + limit - 1)
                    .execute()
                    .data
                )
            )
        except Exception as exc:
            # Migration 003 is required, but a missing table should not take
            # down every other figure on the dashboard.
            logger.error("subscriptions stats query failed (has migration 003 been applied?): %s", exc)
            sub_rows = []

        plan_counts = {plan_id: 0 for plan_id in plans.order()}
        past_due = 0
        canceling = 0
        mrr_cents = 0
        for row in sub_rows:
            plan_id = row.get("plan_id")
            if plan_id in plan_counts:
                plan_counts[plan_id] += 1
            spec = plans.get(plan_id) or {}
            mrr_cents += int(spec.get("price_cents", 0))
            if (row.get("status") or "").lower() == "past_due":
                past_due += 1
            if row.get("cancel_at_period_end"):
                canceling += 1
        subscriptions = {
            **plan_counts,
            "total": len(sub_rows),
            "past_due": past_due,
            "canceling": canceling,
        }

        # Open support conversations and the operator's unread count. The chat
        # tables come from migration 007, which may not be applied everywhere —
        # report zero rather than failing the whole dashboard.
        try:
            open_chat_rows = fetch_all(
                lambda offset, limit: (
                    supabase.table("chat_conversations")
                    .select("unread_admin_count")
                    .eq("status", "open")
                    .order("id")
                    .range(offset, offset + limit - 1)
                    .execute()
                    .data
                )
            )
            open_conversations = len(open_chat_rows)
            unread_messages = sum(
                int(row.get("unread_admin_count") or 0) for row in open_chat_rows
            )
        except Exception as exc:
            logger.error("chat stats query failed (has migration 007 been applied?): %s", exc)
            open_conversations = 0
            unread_messages = 0

        return jsonify(
            {
                "total_users": total_users,
                "total_credits": total_credits,
                "active_today": active_today,
                "unverified": unverified,
                "new_this_week": new_this_week,
                "total_hp_purchased": total_purchased,
                "estimated_revenue": round(total_revenue, 2),
                "subscriptions": subscriptions,
                "mrr": round(mrr_cents / 100.0, 2),
                "revenue_30d": round(revenue_30d, 2),
                "credits_spent_30d": credits_spent_30d,
                "open_conversations": open_conversations,
                "unread_messages": unread_messages,
                "paying_users": paying_users,
            }
        )

    except Exception as e:
        logger.error("Admin stats error: %s", e)
        return jsonify({"error": "Failed to fetch stats"}), 500


@admin_bp.route("/users", methods=["GET"])
@admin_auth_required
def get_users():
    """Get users list with pagination and filters"""
    try:
        supabase = db.require_client()
        # Query parameters
        # Clamped: per_page=0 would divide by zero below, and a negative value would
        # slice backwards.
        try:
            page = max(1, int(request.args.get("page", 1)))
            per_page = max(1, int(request.args.get("per_page", 20)))
            min_credits = max(0, int(request.args.get("min_credits", 0)))
        except (TypeError, ValueError):
            return jsonify({"error": "page, per_page and min_credits must be integers"}), 400

        search = request.args.get("search", "").lower()
        status = request.args.get(
            "status", ""
        )  # verified, unverified, active, inactive

        sort_params = _admin_sort_params(USER_SORT_COLUMNS, "created_at")
        if not sort_params:
            return _invalid_sort(USER_SORT_COLUMNS)
        sort_column, sort_desc = sort_params

        try:
            created_from = _date_bound(request.args.get("created_from"), end_of_day=False)
            created_to = _date_bound(request.args.get("created_to"), end_of_day=True)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        week_ago = (sessions.now() - timedelta(days=7)).isoformat()
        month_ago = (sessions.now() - timedelta(days=30)).isoformat()

        # Every page is rebuilt from the same filters. Paginated with `fetch_all`
        # because PostgREST caps one response at 1,000 rows: without it the user
        # list, and the totals computed from it, would silently stop at 1,000.
        # Ordering by a unique column after the visible one keeps paging stable.
        def _page(offset, limit):
            query = supabase.table("users").select(USER_LIST_COLUMNS)
            if status == "verified":
                query = query.eq("email_verified", True)
            elif status == "unverified":
                query = query.eq("email_verified", False)
            elif status == "active":
                query = query.gte("last_login", week_ago)
            elif status == "inactive":
                query = query.lt("last_login", month_ago)

            if created_from:
                query = query.gte("created_at", created_from)
            if created_to:
                query = query.lte("created_at", created_to)

            # NOTE: min_credits is deliberately NOT applied in SQL. It has to count
            # temporary credits as well, which is only possible once the rows are
            # in Python — see the filter below.
            return (
                query.order(sort_column, desc=sort_desc)
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )

        users = fetch_all(_page)

        # Apply search filter (client-side for flexibility)
        if search:
            users = [
                u
                for u in users
                if search in (u.get("username") or "").lower()
                or search in (u.get("email") or "").lower()
            ]

        # `credits_balance` is only the unused plan allowance now, so the
        # server-side filter above would drop users whose usable balance is
        # temporary credits. Filter on the real available total instead.
        if min_credits > 0:
            users = [u for u in users if _total_available_credits(u) >= min_credits]

        user_ids = [u["id"] for u in users]
        bought_totals, spent_totals = _user_totals(supabase, user_ids)
        for user in users:
            uid = user["id"]
            user["credits_bought"] = bought_totals.get(uid, 0)
            user["credits_spent"] = spent_totals.get(uid, 0)

        # Pagination
        total = len(users)
        total_pages = (total + per_page - 1) // per_page
        start = (page - 1) * per_page
        end = start + per_page
        paginated_users = users[start:end]

        return jsonify(
            {
                "users": paginated_users,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": total_pages,
            }
        )

    except Exception as e:
        logger.error("Admin users error: %s", e)
        return jsonify({"error": "Failed to fetch users"}), 500


@admin_bp.route("/users/<user_id>", methods=["GET"])
@admin_auth_required
def get_user_detail(user_id):
    """Get detailed information for a single user"""
    try:
        supabase = db.require_client()
        # Get user info
        # `.limit(1)` rather than `.single()`: `.single()` raises on an empty
        # result, so the "not found" branch below could never run and a missing
        # user surfaced as a 500.
        user_result = (
            supabase.table("users").select("*").eq("id", user_id).limit(1).execute()
        )
        if not user_result.data:
            return jsonify({"error": "User not found"}), 404

        user = user_result.data[0]
        # Never expose password material in an API response.
        user.pop("password_hash", None)

        # Get transaction history. Bounded in SQL rather than by slicing a capped
        # response, so a heavy account cannot silently lose its recent rows.
        tx_result = (
            supabase.table("transactions")
            .select("*")
            .eq("user_id", user_id)
            .order("timestamp", desc=True)
            .limit(50)
            .execute()
        )

        transactions = list(tx_result.data or [])

        # Calculate stats
        total_bought = sum(
            t.get("amount", 0) for t in transactions if is_credit_in(t)
        )
        total_spent = sum(
            abs(t.get("amount", 0))
            for t in transactions
            if is_credit_out(t)
        )
        total_revenue = _estimated_revenue(transactions)

        # Get referred users
        referred = fetch_all(
            lambda offset, limit: (
                supabase.table("users")
                .select("id, username, email")
                .eq("referred_by", user_id)
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )
        )

        return jsonify(
            {
                "user": user,
                "transactions": transactions,
                "stats": {
                    "total_bought": total_bought,
                    "total_spent": total_spent,
                    "total_revenue": round(total_revenue, 2),
                    "transaction_count": len(transactions),
                },
                "referred_users": referred,
            }
        )

    except Exception as e:
        logger.error("Admin user detail error: %s", e)
        return jsonify({"error": "Failed to fetch user details"}), 500


@admin_bp.route("/transactions", methods=["GET"])
@admin_auth_required
def get_recent_transactions():
    """Get recent transactions across all users"""
    try:
        supabase = db.require_client()
        limit = max(1, min(500, _safe_int(request.args.get("limit"), 50)))

        sort_params = _admin_sort_params(TRANSACTION_SORT_COLUMNS, "timestamp")
        if not sort_params:
            return _invalid_sort(TRANSACTION_SORT_COLUMNS)
        sort_column, sort_desc = sort_params

        tx_type = (request.args.get("type") or "").strip()
        tx_status = (request.args.get("status") or "").strip()
        user_id = (request.args.get("user_id") or "").strip()
        try:
            date_from = _date_bound(request.args.get("from"), end_of_day=False)
            date_to = _date_bound(request.args.get("to"), end_of_day=True)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        query = supabase.table("transactions").select("*, users(username, email)")
        if tx_type:
            query = query.eq("type", tx_type)
        if tx_status:
            query = query.eq("status", tx_status)
        if user_id:
            query = query.eq("user_id", user_id)
        if date_from:
            query = query.gte("timestamp", date_from)
        if date_to:
            query = query.lte("timestamp", date_to)

        result = (
            query.order(sort_column, desc=sort_desc)
            .order("id")
            .limit(limit)
            .execute()
        )

        return jsonify({"transactions": list(result.data or [])})

    except Exception as e:
        logger.error("Admin transactions error: %s", e)
        return jsonify({"error": "Failed to fetch transactions"}), 500


@admin_bp.route("/activity", methods=["GET"])
@admin_auth_required
def get_activity_log():
    """Get daily active users for the last 30 days"""
    try:
        supabase = db.require_client()
        days = int(request.args.get("days", 30))

        # Get all users with last_login in the period. Paginated: a capped read
        # would report a flat activity curve the moment the user count passes
        # 1,000.
        start_date = (sessions.now() - timedelta(days=days)).isoformat()

        rows = fetch_all(
            lambda offset, limit: (
                supabase.table("users")
                .select("last_login")
                .gte("last_login", start_date)
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )
        )

        # Aggregate by day
        activity = {}
        for user in rows:
            if user.get("last_login"):
                day = user["last_login"][:10]  # YYYY-MM-DD
                activity[day] = activity.get(day, 0) + 1

        # Fill missing days with 0
        for i in range(days):
            date = (sessions.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            if date not in activity:
                activity[date] = 0

        return jsonify(
            {
                "activity": [
                    {"date": k, "active_users": v} for k, v in sorted(activity.items())
                ]
            }
        )

    except Exception as e:
        logger.error("Admin activity error: %s", e)
        return jsonify({"error": "Failed to fetch activity"}), 500


@admin_bp.route("/revenue", methods=["GET"])
@admin_auth_required
def get_revenue_series():
    """
    Daily estimated revenue for the last `days` days (default 30, clamped to
    1..365), ascending and zero-filled — the same shape as `/activity`.

    A day counts the grants paid that day: `subscription_grant` and legacy
    `purchase` transactions, each valued at the plan price its amount matches
    (`plans.euro_value_of_credits`), exactly like `/stats`' `estimated_revenue`.
    """
    try:
        supabase = db.require_client()
        days = max(1, min(365, _safe_int(request.args.get("days"), 30)))
        start_date = (sessions.now() - timedelta(days=days)).isoformat()

        rows = fetch_all(
            lambda offset, limit: (
                supabase.table("transactions")
                .select("amount, type, timestamp")
                .in_("type", sorted(REVENUE_TX_TYPES))
                .gte("timestamp", start_date)
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )
        )

        daily: dict = {}
        for tx in rows:
            day = str(tx.get("timestamp") or "")[:10]  # YYYY-MM-DD
            if not day:
                continue
            daily[day] = daily.get(day, 0.0) + plans.euro_value_of_credits(
                _safe_int(tx.get("amount"), 0)
            )

        # Fill missing days with 0
        for i in range(days):
            day = (sessions.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            if day not in daily:
                daily[day] = 0.0

        return jsonify(
            {
                "days": days,
                "revenue": [
                    {"date": k, "revenue": round(v, 2)}
                    for k, v in sorted(daily.items())
                ],
            }
        )

    except Exception as e:
        logger.error("Admin revenue error: %s", e)
        return jsonify({"error": "Failed to fetch revenue"}), 500


@admin_bp.route("/streamers", methods=["POST"])
@limiter.limit("20 per minute")
@admin_auth_required
def create_streamer():
    """Create a new streamer and credentials"""
    try:
        supabase = db.require_client()
        data = request.get_json()

        id_code = data.get("id_code")
        password = data.get("password")
        manager_code = data.get("manager_code")

        if not id_code or not password:
            return jsonify({"error": "id_code and password are required"}), 400

        manager_id = None
        is_managed = False

        # Step 1: Find Manager (if provided)
        if manager_code:
            manager_cred = (
                supabase.table("credentials")
                .select("streamer_id")
                .eq("id_code", manager_code)
                .limit(1)
                .execute()
            )
            if not manager_cred.data:
                return jsonify({"error": "Manager not found"}), 404
            manager_id = manager_cred.data[0].get("streamer_id")
            if manager_id:
                is_managed = True

        # Step 2: Create Streamer
        streamer_data = {
            "is_managed": is_managed,
            "manager_id": manager_id,
            "referred_num": 0,
            "balance_available": 0,
            "total_earned": 0,
        }

        new_streamer = supabase.table("streamers").insert(streamer_data).execute()
        if not new_streamer.data:
            return jsonify({"error": "Failed to create streamer"}), 500

        streamer_id = new_streamer.data[0].get("streamer_id")
        if not streamer_id:
            return jsonify({"error": "Streamer created without an id"}), 500

        # Step 3: Create Credentials
        cred_data = {
            "id_code": id_code,
            "streamer_id": streamer_id,
            "password": hash_password(password),
        }

        new_cred = supabase.table("credentials").insert(cred_data).execute()
        if not new_cred.data:
            return jsonify({"error": "Failed to create credentials"}), 500

        g.admin_action_detail = (
            f"Created streamer {streamer_id} (id_code {id_code!r}"
            + (f", manager {manager_code!r}" if manager_code else "")
            + ")"
        )

        return jsonify(
            {
                "message": "Streamer created successfully",
                "streamer_id": streamer_id,
            }
        ), 201

    except Exception as e:
        logger.error("Admin create streamer error: %s", e)
        return jsonify({"error": "Failed to create streamer"}), 500


@admin_bp.route("/streamers", methods=["GET"])
@admin_auth_required
def list_streamers():
    """
    Every streamer, with its live referral count and 30-day AI usage.

    All three lookups that used to run per streamer (credentials, AI usage,
    referral count) are done once for the whole page, so this is a constant number
    of queries instead of three per row.

    A manager also reports its `subordinate_ids` and `network_referred_num` — the
    users referred by the whole branch, not just by the manager.
    """
    try:
        supabase = db.require_client()

        search = request.args.get("search", "").lower()
        only_managers = request.args.get("only_managers", "").lower() in (
            "1",
            "true",
            "yes",
        )
        only_managed = request.args.get("only_managed", "").lower() in (
            "1",
            "true",
            "yes",
        )

        # Sorted in Python, not in SQL: the list is assembled from several
        # sources (live referral counts, AI usage) rather than selected from one
        # table, so the final ordering happens on the output rows. The column is
        # still whitelist-checked — never raw input.
        sort_params = _admin_sort_params(STREAMER_SORT_COLUMNS, "created_at")
        if not sort_params:
            return _invalid_sort(STREAMER_SORT_COLUMNS)
        sort_column, sort_desc = sort_params

        # Paginated, because a capped read would silently hide streamers past
        # 1,000. Ordering on a unique column after the visible one keeps paging
        # stable when several rows share a `created_at`.
        def _page(offset, limit):
            query = supabase.table("streamers").select("*")
            if only_managers:
                query = query.eq("is_managed", False)
            elif only_managed:
                query = query.eq("is_managed", True)
            return (
                query.order("created_at", desc=True)
                .order("streamer_id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )

        rows = fetch_all(_page)
        streamer_ids = [row["streamer_id"] for row in rows]
        codes = streamers.id_codes_for(supabase, streamer_ids)
        referred = streamers.referred_counts(supabase)
        ai = _ai_usage_by_streamer(supabase, days=30)

        output = []
        for row in rows:
            sid = row.get("streamer_id")
            key = str(sid)
            id_code = codes.get(key)

            # Search matches the id_code, which is only known here.
            if search and (not id_code or search not in id_code.lower()):
                continue

            manager_id = row.get("manager_id")
            own_referrals = referred.get(key, 0)

            # A manager's network is the whole branch, so resolving the downline
            # is only worth doing for streamers that have one.
            subordinate_ids = []
            if not row.get("is_managed", False):
                subordinate_ids = [
                    str(i)
                    for i in streamers.downline_ids(
                        supabase, sid, include_self=False
                    )
                ]
            network_referred_num = own_referrals + sum(
                referred.get(child, 0) for child in subordinate_ids
            )
            usage = ai.get(key, {"requests": 0, "cost": 0.0})

            output.append(
                {
                    "streamer_id": sid,
                    "id_code": id_code,
                    "is_managed": row.get("is_managed", False),
                    "manager_id": manager_id,
                    "manager_code": codes.get(str(manager_id)) if manager_id else None,
                    "balance_available": float(row.get("balance_available") or 0),
                    "total_earned": float(row.get("total_earned") or 0),
                    "referred_num": own_referrals,
                    "referred_num_declared": int(row.get("referred_num", 0) or 0),
                    "created_at": row.get("created_at"),
                    "ai_requests_30d": usage["requests"],
                    "ai_cost_30d": usage["cost"],
                    # The branch, so the UI can drill into it.
                    "subordinate_ids": subordinate_ids,
                    "subordinate_count": len(subordinate_ids),
                    "network_referred_num": network_referred_num,
                }
            )

        # None-safe ordering: missing values sort last in descending order (and
        # first ascending), and rows missing the column never compare against
        # rows that have it, so a str column and a numeric one cannot collide.
        output.sort(
            key=lambda row: (
                row.get(sort_column) is not None,
                row.get(sort_column) if row.get(sort_column) is not None else 0,
            ),
            reverse=sort_desc,
        )

        return jsonify({"streamers": output, "total": len(output)})

    except Exception as e:
        logger.error("Admin list streamers error: %s", e)
        return jsonify({"error": "Failed to fetch streamers"}), 500


@admin_bp.route("/streamers/<streamer_id>", methods=["GET"])
@admin_auth_required
def get_streamer_network(streamer_id):
    """
    One streamer and its whole branch: the streamers beneath it, and every user
    they brought in collectively.

    This is the drill-down behind `subordinate_ids` in the list view. Users who
    came in under a subordinate are not attributed to the manager in the database
    — only to the subordinate — so the branch is assembled here.

    `users` and `subordinates` are each one page; `total_*` covers the whole
    branch. Use `?users_page=2&subordinates_page=1` to walk them.
    """
    try:
        supabase = db.require_client()
        row = streamers.get(supabase, streamer_id)
        if not row:
            return jsonify({"error": "Streamer not found"}), 404

        users_page, users_per_page = _admin_page_params("users")
        subs_page, subs_per_page = _admin_page_params("subordinates")

        branch_ids = streamers.downline_ids(supabase, streamer_id)
        codes = streamers.id_codes_for(supabase, branch_ids)

        subordinates = [
            streamers.summary(child, codes.get(str(child["streamer_id"])))
            for child in streamers.rows_by_ids(
                supabase, [i for i in branch_ids if str(i) != str(streamer_id)]
            )
        ]

        referred = streamers.users_of(
            supabase,
            branch_ids,
            columns=(
                "id, username, email, created_at, updated_at, last_login, "
                "credits_balance, referred_by_streamer"
            ),
        )

        totals = bulk_user_totals(
            supabase,
            [u["id"] for u in referred],
            euro_value=plans.euro_value_of_credits,
        )
        users = []
        for user in referred:
            entry = totals.get(str(user["id"]), {})
            owner = user.get("referred_by_streamer")
            users.append(
                {
                    "id": str(user["id"]),
                    "username": user.get("username")
                    or (user.get("email") or "").split("@")[0],
                    "email": user.get("email"),
                    "streamer_id": str(owner) if owner else None,
                    "streamer_code": codes.get(str(owner)),
                    "euros_spent": round(entry.get("euros", 0.0), 2),
                    "credits_bought": entry.get("bought", 0),
                    "credits_spent": entry.get("spent", 0),
                    "credits_balance": user.get("credits_balance", 0),
                    "last_active": entry.get("last_at")
                    or user.get("last_login")
                    or user.get("updated_at")
                    or user.get("created_at"),
                    "joined_at": user.get("created_at") or user.get("updated_at"),
                }
            )
        users.sort(key=lambda u: (u["username"] or "").lower())

        subs_block = _admin_paginate(subordinates, subs_page, subs_per_page)
        users_block = _admin_paginate(users, users_page, users_per_page)

        return jsonify(
            {
                "streamer": streamers.summary(row, codes.get(str(streamer_id))),
                "branch_streamer_ids": [str(i) for i in branch_ids],
                "subordinates": subs_block["items"],
                "subordinates_page": subs_block["meta"],
                "team_stats": streamers.network_totals(subordinates),
                "users": users_block["items"],
                "users_page": users_block["meta"],
                # Branch-wide, not page-wide.
                "total_users": len(users),
                "total_euros_spent": round(
                    sum(u["euros_spent"] for u in users), 2
                ),
                "total_credits_bought": sum(u["credits_bought"] for u in users),
                "total_credits_spent": sum(u["credits_spent"] for u in users),
            }
        )

    except Exception as e:
        logger.error("Admin streamer network error: %s", e)
        return jsonify({"error": "Failed to fetch the streamer network"}), 500


@admin_bp.route("/streamers/<streamer_id>/manager", methods=["PATCH"])
@limiter.limit("30 per minute")
@admin_auth_required
def update_streamer_manager(streamer_id):
    """Assign, change, or remove a streamer manager."""
    try:
        supabase = db.require_client()
        data = request.get_json() or {}
        manager_code = str(data.get("manager_code") or "").strip()

        streamer_result = (
            supabase.table("streamers")
            .select("streamer_id, manager_id, is_managed")
            .eq("streamer_id", streamer_id)
            .limit(1)
            .execute()
        )
        streamer = streamer_result.data[0] if streamer_result.data else None
        if not streamer:
            return jsonify({"error": "Streamer not found"}), 404

        update_payload = {"manager_id": None, "is_managed": False}
        manager_id = None

        if manager_code:
            manager_cred = (
                supabase.table("credentials")
                .select("streamer_id, id_code")
                .eq("id_code", manager_code)
                .limit(1)
                .execute()
            )
            if not manager_cred.data:
                return jsonify({"error": "Manager not found"}), 404

            manager_id = manager_cred.data[0].get("streamer_id")
            if not manager_id:
                return jsonify({"error": "Manager not linked to a streamer"}), 400
            if str(manager_id) == str(streamer_id):
                return jsonify({"error": "A streamer cannot manage itself"}), 400

            visited = {str(streamer_id)}
            current_id = manager_id
            while current_id:
                current_key = str(current_id)
                if current_key in visited:
                    return jsonify({"error": "Manager assignment would create a cycle"}), 400
                visited.add(current_key)

                current_streamer = (
                    supabase.table("streamers")
                    .select("manager_id")
                    .eq("streamer_id", current_id)
                    .limit(1)
                    .execute()
                )
                current_data = current_streamer.data[0] if current_streamer.data else {}
                current_id = current_data.get("manager_id")

            update_payload = {"manager_id": manager_id, "is_managed": True}

        updated = (
            supabase.table("streamers")
            .update(update_payload)
            .eq("streamer_id", streamer_id)
            .execute()
        )
        if not updated.data:
            return jsonify({"error": "Failed to update streamer manager"}), 500

        g.admin_action_detail = (
            f"Assigned manager {manager_code!r} (id {manager_id}) to streamer {streamer_id}"
            if manager_id
            else f"Cleared the manager of streamer {streamer_id}"
        )

        return jsonify(
            {
                "message": "Streamer manager updated successfully",
                "streamer_id": streamer_id,
                "manager_id": manager_id,
                "manager_code": manager_code or None,
                "is_managed": bool(manager_id),
            }
        )

    except Exception as e:
        logger.error("Admin update streamer manager error: %s", e)
        return jsonify({"error": "Failed to update streamer manager"}), 500


@admin_bp.route("/users/<user_id>/credits", methods=["POST"])
@limiter.limit("30 per minute")
@admin_auth_required
def admin_grant_credits(user_id):
    """
    Grant a user bonus credits.

    Always grants **temporary** credits, never plan credits. `credits_balance` is
    the subscription allowance and is owned by Stripe: writing to it here would
    inflate the allowance and drive the usage bar negative. A bonus should also
    lapse, which is exactly what a temp grant does.

    Optional body field `expires_in_days`; omit it for the default TTL.
    """
    try:
        supabase = db.require_client()
        data = request.get_json() or {}

        amount = data.get("amount")
        reason = data.get("reason", "Admin bonus")
        expires_in_days = data.get("expires_in_days")

        if amount is None:
            return jsonify({"error": "amount is required"}), 400
        try:
            amount = int(amount)
        except (TypeError, ValueError):
            return jsonify({"error": "amount must be an integer"}), 400
        if amount <= 0:
            return jsonify({"error": "amount must be greater than 0"}), 400

        if expires_in_days is not None:
            try:
                expires_in_days = int(expires_in_days)
            except (TypeError, ValueError):
                return jsonify({"error": "expires_in_days must be an integer"}), 400

        result = add_temp_credits(
            supabase,
            user_id,
            amount,
            ttl_days=(
                expires_in_days
                if expires_in_days is not None
                else current_app.config["TEMP_GRANT_TTL_DAYS"]
            ),
        )

        record_transaction(supabase, user_id, amount, TX_BONUS, reason)

        g.admin_action_detail = (
            f"Granted {amount} temporary credits to user {user_id} (reason: {reason})"
        )

        return jsonify(
            {
                "user_id": user_id,
                "credits_added": amount,
                "temporary_balance": result["temp_credits"],
                "grant": result["grant"],
                "reason": reason,
            }
        )

    except ValueError as exc:
        return jsonify({"error": str(exc)}), error_status(exc)
    except Exception as e:
        logger.error("Admin add credits error: %s", e)
        return jsonify({"error": "Failed to add credits"}), 500


@admin_bp.route("/ai/summary", methods=["GET"])
@admin_auth_required
def get_ai_summary():
    """Return aggregate AI usage metrics"""
    try:
        supabase = db.require_client()

        now = sessions.now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        seven_days_ago = (now - timedelta(days=7)).isoformat()
        thirty_days_ago = (now - timedelta(days=30)).isoformat()

        def _fetch(since: str):
            # Paginated: a capped read would under-report cost and requests as
            # soon as the log passes 1,000 rows in the window.
            try:
                return fetch_all(
                    lambda offset, limit: (
                        supabase.table("ai_usage_logs")
                        .select("total_tokens, cost_estimate, status")
                        .gte("created_at", since)
                        .order("id")
                        .range(offset, offset + limit - 1)
                        .execute()
                        .data
                    )
                )
            except Exception as exc:
                logger.error("ai_usage_logs query error: %s", exc)
                return []

        rows_today = _fetch(today_start)
        rows_7d = _fetch(seven_days_ago)
        rows_30d = _fetch(thirty_days_ago)

        def _agg(rows):
            requests = len(rows)
            tokens = sum(r.get("total_tokens", 0) for r in rows)
            cost = round(sum(r.get("cost_estimate", 0) for r in rows), 6)
            errors = sum(1 for r in rows if r.get("status") == "error")
            return requests, tokens, cost, errors

        req_today, tok_today, cost_today, err_today = _agg(rows_today)
        req_7d, tok_7d, cost_7d, _ = _agg(rows_7d)
        req_30d, _, cost_30d, _ = _agg(rows_30d)

        return jsonify(
            {
                "cost_today": cost_today,
                "cost_7d": cost_7d,
                "cost_30d": cost_30d,
                "requests_today": req_today,
                "requests_7d": req_7d,
                "tokens_today": tok_today,
                "tokens_7d": tok_7d,
                "errors_today": err_today,
            }
        )

    except Exception as e:
        logger.error("Admin AI summary error: %s", e)
        return jsonify({"error": "Failed to fetch AI summary"}), 500


@admin_bp.route("/ai/timeseries", methods=["GET"])
@admin_auth_required
def get_ai_timeseries():
    """Return per-day AI usage (requests, tokens, cost) for the last N days"""
    try:
        supabase = db.require_client()
        days = int(request.args.get("days", 30))
        since = (sessions.now() - timedelta(days=days)).isoformat()

        try:
            rows = fetch_all(
                lambda offset, limit: (
                    supabase.table("ai_usage_logs")
                    .select("created_at, total_tokens, cost_estimate")
                    .gte("created_at", since)
                    .order("id")
                    .range(offset, offset + limit - 1)
                    .execute()
                    .data
                )
            )
        except Exception as exc:
            logger.error("ai_usage_logs timeseries query error: %s", exc)
            rows = []

        # Aggregate by date (YYYY-MM-DD)
        daily: dict = {}
        for r in rows:
            ts = r.get("created_at", "")
            day = ts[:10]  # YYYY-MM-DD
            if not day:
                continue
            if day not in daily:
                daily[day] = {"date": day, "requests": 0, "tokens": 0, "cost": 0.0}
            daily[day]["requests"] += 1
            daily[day]["tokens"] += r.get("total_tokens", 0)
            daily[day]["cost"] = round(
                daily[day]["cost"] + r.get("cost_estimate", 0), 6
            )

        # Fill missing days with zeros
        for i in range(days):
            day = (sessions.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            if day not in daily:
                daily[day] = {"date": day, "requests": 0, "tokens": 0, "cost": 0.0}

        timeseries = sorted(daily.values(), key=lambda x: x["date"])
        return jsonify({"timeseries": timeseries})

    except Exception as e:
        logger.error("Admin AI timeseries error: %s", e)
        return jsonify({"error": "Failed to fetch AI timeseries"}), 500


@admin_bp.route("/ai/by-streamer", methods=["GET"])
@admin_auth_required
def get_ai_by_streamer():
    """Return AI usage aggregated per streamer"""
    try:
        supabase = db.require_client()

        try:
            rows = fetch_all(
                lambda offset, limit: (
                    supabase.table("ai_usage_logs")
                    .select("streamer_id, total_tokens, cost_estimate, created_at")
                    .not_.is_("streamer_id", "null")
                    .order("id")
                    .range(offset, offset + limit - 1)
                    .execute()
                    .data
                )
            )
        except Exception as exc:
            logger.error("ai_usage_logs by-streamer query error: %s", exc)
            rows = []

        # Aggregate by streamer_id
        agg: dict = {}
        for r in rows:
            sid = r.get("streamer_id")
            if not sid:
                continue
            if sid not in agg:
                agg[sid] = {
                    "streamer_id": sid,
                    "id_code": None,
                    "requests_count": 0,
                    "total_tokens": 0,
                    "total_cost": 0.0,
                    "last_request_at": None,
                }
            agg[sid]["requests_count"] += 1
            agg[sid]["total_tokens"] += r.get("total_tokens", 0)
            agg[sid]["total_cost"] = round(
                agg[sid]["total_cost"] + r.get("cost_estimate", 0), 6
            )
            ts = r.get("created_at")
            if ts and (
                agg[sid]["last_request_at"] is None or ts > agg[sid]["last_request_at"]
            ):
                agg[sid]["last_request_at"] = ts

        # Enrich with id_code
        for sid, entry in agg.items():
            try:
                cred = (
                    supabase.table("credentials")
                    .select("id_code")
                    .eq("streamer_id", sid)
                    .execute()
                )
                entry["id_code"] = cred.data[0]["id_code"] if cred.data else None
            except Exception as exc:
                logger.warning("Could not resolve id_code for %s: %s", sid, exc)
                entry["id_code"] = None

        output = sorted(agg.values(), key=lambda x: x["total_cost"], reverse=True)
        return jsonify({"by_streamer": output})

    except Exception as e:
        logger.error("Admin AI by-streamer error: %s", e)
        return jsonify({"error": "Failed to fetch AI by-streamer"}), 500


@admin_bp.route("/ai/by-user", methods=["GET"])
@admin_auth_required
def get_ai_by_user():
    """Return AI usage aggregated per user"""
    try:
        supabase = db.require_client()

        try:
            rows = fetch_all(
                lambda offset, limit: (
                    supabase.table("ai_usage_logs")
                    .select("user_id, total_tokens, cost_estimate, created_at")
                    .not_.is_("user_id", "null")
                    .order("id")
                    .range(offset, offset + limit - 1)
                    .execute()
                    .data
                )
            )
        except Exception as exc:
            logger.error("ai_usage_logs by-user query error: %s", exc)
            rows = []

        # Aggregate by user_id
        agg: dict = {}
        for r in rows:
            uid = r.get("user_id")
            if not uid:
                continue
            if uid not in agg:
                agg[uid] = {
                    "user_id": uid,
                    "username": None,
                    "email": None,
                    "requests_count": 0,
                    "total_tokens": 0,
                    "total_cost": 0.0,
                    "last_request_at": None,
                }
            agg[uid]["requests_count"] += 1
            agg[uid]["total_tokens"] += r.get("total_tokens", 0)
            agg[uid]["total_cost"] = round(
                agg[uid]["total_cost"] + r.get("cost_estimate", 0), 6
            )
            ts = r.get("created_at")
            if ts and (
                agg[uid]["last_request_at"] is None or ts > agg[uid]["last_request_at"]
            ):
                agg[uid]["last_request_at"] = ts

        # Enrich with username / email
        for uid, entry in agg.items():
            try:
                user_res = (
                    supabase.table("users")
                    .select("username, email")
                    .eq("id", uid)
                    .limit(1)
                    .execute()
                )
                if user_res.data:
                    entry["username"] = user_res.data[0].get("username")
                    entry["email"] = user_res.data[0].get("email")
            except Exception as exc:
                logger.warning("Could not enrich AI usage for user %s: %s", uid, exc)

        output = sorted(agg.values(), key=lambda x: x["total_cost"], reverse=True)
        return jsonify({"by_user": output})

    except Exception as e:
        logger.error("Admin AI by-user error: %s", e)
        return jsonify({"error": "Failed to fetch AI by-user"}), 500


@admin_bp.route("/openai/debug", methods=["GET"])
@admin_auth_required
def openai_debug():
    """Report whether the server sees an OpenAI key, without revealing any part of it."""
    config_key = current_app.config["OPENAI_API_KEY"]
    env_key = os.environ.get("OPENAI_API_KEY")

    # Booleans only. A partial key preview is not useful to the UI and is a
    # genuine disclosure: it narrows the search space for anyone who can read the
    # admin response, and the admin gate is a single shared secret.
    return jsonify(
        {
            "config_key_present": bool(config_key),
            "env_key_present": bool(env_key),
            "configured": bool(config_key or env_key),
            "source": "config" if config_key else ("environment" if env_key else None),
        }
    )


@admin_bp.route("/openai/usage", methods=["GET"])
@limiter.limit("20 per minute")
@admin_auth_required
def get_openai_usage():
    """Query the OpenAI organization usage API directly - no Supabase needed"""
    api_key = current_app.config["OPENAI_API_KEY"] or os.environ.get(
        "OPENAI_API_KEY"
    )
    if not api_key:
        logger.error("OPENAI_API_KEY not found in config or environment")
        return jsonify({"error": "OpenAI API key not configured"}), 500
    logger.info("OpenAI API key loaded: %s", bool(api_key))

    days = int(request.args.get("days", 30))
    now = int(time.time())
    start_time = now - (days * 86400)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        # Fetch completions usage
        usage_resp = requests.get(
            "https://api.openai.com/v1/organization/usage/completions",
            headers=headers,
            params={
                "start_time": start_time,
                "end_time": now,
                "limit": 100,
                "bucket_width": "1d",
            },
            timeout=15,
        )
        usage_data = usage_resp.json() if usage_resp.ok else {}

        # Fetch costs
        costs_resp = requests.get(
            "https://api.openai.com/v1/organization/costs",
            headers=headers,
            params={
                "start_time": start_time,
                "end_time": now,
                "limit": 100,
                "bucket_width": "1d",
            },
            timeout=15,
        )
        costs_data = costs_resp.json() if costs_resp.ok else {}

        # Process usage buckets
        daily = {}
        total_input_tokens = 0
        total_output_tokens = 0
        total_requests = 0
        model_breakdown = {}

        for bucket in usage_data.get("data", []):
            day = datetime.fromtimestamp(bucket["start_time"], tz=timezone.utc).strftime("%Y-%m-%d")
            if day not in daily:
                daily[day] = {
                    "date": day,
                    "requests": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                    "cost": 0.0,
                }

            for result in bucket.get("results", []):
                inp = result.get("input_tokens", 0)
                out = result.get("output_tokens", 0)
                reqs = result.get("num_model_requests", 0)
                model = result.get("model_id", "unknown")

                daily[day]["input_tokens"] += inp
                daily[day]["output_tokens"] += out
                daily[day]["total_tokens"] += inp + out
                daily[day]["requests"] += reqs

                total_input_tokens += inp
                total_output_tokens += out
                total_requests += reqs

                if model not in model_breakdown:
                    model_breakdown[model] = {
                        "model": model,
                        "requests": 0,
                        "input_tokens": 0,
                        "output_tokens": 0,
                    }
                model_breakdown[model]["requests"] += reqs
                model_breakdown[model]["input_tokens"] += inp
                model_breakdown[model]["output_tokens"] += out

        # Process costs
        total_cost = 0.0
        for bucket in costs_data.get("data", []):
            day = datetime.fromtimestamp(bucket["start_time"], tz=timezone.utc).strftime("%Y-%m-%d")
            for result in bucket.get("results", []):
                amount = _safe_float(result.get("amount", {}).get("value", 0.0))
                total_cost += amount
                if day in daily:
                    daily[day]["cost"] = round(daily[day]["cost"] + amount, 6)

        # Fill missing days with zeros
        for i in range(days):
            day = (sessions.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            if day not in daily:
                daily[day] = {
                    "date": day,
                    "requests": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                    "cost": 0.0,
                }

        timeseries = sorted(daily.values(), key=lambda x: x["date"])

        # Summary (today and 7d)
        today_str = sessions.now().strftime("%Y-%m-%d")
        seven_days_ago = (sessions.now() - timedelta(days=7)).strftime("%Y-%m-%d")

        cost_today = sum(d["cost"] for d in timeseries if d["date"] == today_str)
        cost_7d = sum(d["cost"] for d in timeseries if d["date"] >= seven_days_ago)
        req_today = sum(d["requests"] for d in timeseries if d["date"] == today_str)
        tokens_today = sum(
            d["total_tokens"] for d in timeseries if d["date"] == today_str
        )

        return jsonify(
            {
                "summary": {
                    "cost_today": round(cost_today, 6),
                    "cost_7d": round(cost_7d, 6),
                    "cost_30d": round(total_cost, 6),
                    "requests_today": req_today,
                    "requests_total": total_requests,
                    "tokens_today": tokens_today,
                    "total_input_tokens": total_input_tokens,
                    "total_output_tokens": total_output_tokens,
                },
                "timeseries": timeseries,
                "by_model": sorted(
                    model_breakdown.values(), key=lambda x: x["requests"], reverse=True
                ),
                "source": "openai_api",
            }
        )

    except Exception as e:
        logger.error("OpenAI usage API error: %s", e)
        return jsonify({"error": "Failed to fetch OpenAI usage"}), 500


@admin_bp.route("/openai/models", methods=["GET"])
@limiter.limit("20 per minute")
@admin_auth_required
def get_openai_models():
    """List the OpenAI models available to this account."""
    api_key = current_app.config["OPENAI_API_KEY"] or os.environ.get(
        "OPENAI_API_KEY"
    )
    if not api_key:
        return jsonify({"error": "OpenAI API key not configured"}), 500

    try:
        resp = requests.get(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        if resp.ok:
            models = resp.json().get("data", [])
            # Only the GPT models are relevant to this dashboard.
            gpt_models = [m for m in models if "gpt" in m.get("id", "").lower()]
            return jsonify({"models": gpt_models})
        logger.error("OpenAI models request rejected: %s", resp.status_code)
        return jsonify({"error": "Failed to fetch models"}), 502
    except Exception as e:
        logger.error("OpenAI models error: %s", e)
        return jsonify({"error": "Failed to fetch models"}), 500


# ── Chat inbox (operator side of the support chat) ──────────────────────────
#
# The customer side lives in `routes_chat.py` (`/api/chat/*`). These endpoints
# are on this blueprint deliberately: the after_request hook above then records
# every read and write in `admin_audit_log`, and the blueprint-wide rate limit
# below applies, with no second copy of either mechanism.

CHAT_STATUS_FILTERS = ("open", "closed", "all")


def _chat_conversation(supabase, conversation_id):
    """The conversation row, or ``None``."""
    result = (
        supabase.table("chat_conversations")
        .select("*")
        .eq("id", conversation_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def _chat_message_payload(row: dict) -> dict:
    return {
        "id": row["id"],
        "conversation_id": str(row["conversation_id"]),
        "sender": row.get("sender"),
        "body": row.get("body"),
        "created_at": row.get("created_at"),
        "read_at": row.get("read_at"),
    }


def _chat_user_summary(supabase, user_id) -> dict | None:
    result = (
        supabase.table("users")
        .select("id, username, email, created_at, last_login")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


@admin_bp.route("/chat/conversations", methods=["GET"])
@admin_auth_required
def list_chat_conversations():
    """
    The support inbox: conversations newest activity first, with the customer,
    the operator's unread count and a preview of the last message.

    `?status=open|closed|all` (default `open`), `?search=` matches the
    customer's username or email, `?page=&per_page=` page the result.
    """
    try:
        supabase = db.require_client()
        status = (request.args.get("status") or "open").strip().lower()
        if status not in CHAT_STATUS_FILTERS:
            return jsonify({"error": "status must be open, closed or all"}), 400

        search = (request.args.get("search") or "").strip().lower()
        page, per_page = _admin_page_params()

        def _page(offset, limit):
            query = supabase.table("chat_conversations").select(
                "*, users(username, email)"
            )
            if status != "all":
                query = query.eq("status", status)
            return (
                query.order("last_message_at", desc=True, nullsfirst=False)
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )

        rows = fetch_all(_page)

        # Client-side, like the user list's search: PostgREST cannot express
        # "username or email contains" over the embedded resource.
        if search:
            rows = [
                row
                for row in rows
                if search in str((row.get("users") or {}).get("username") or "").lower()
                or search in str((row.get("users") or {}).get("email") or "").lower()
            ]

        page_block = _admin_paginate(rows, page, per_page)
        previews = last_messages_by_conversation(
            supabase, [row["id"] for row in page_block["items"]]
        )

        items = []
        for row in page_block["items"]:
            user = row.get("users") or {}
            last = previews.get(str(row["id"]))
            items.append(
                {
                    "id": str(row["id"]),
                    "status": row.get("status"),
                    "subject": row.get("subject"),
                    "last_message_at": row.get("last_message_at"),
                    "unread_admin_count": int(row.get("unread_admin_count") or 0),
                    "created_at": row.get("created_at"),
                    "user": {
                        "id": str(row.get("user_id")),
                        "username": user.get("username"),
                        "email": user.get("email"),
                    },
                    "last_message": (
                        {
                            "sender": last.get("sender"),
                            "preview": str(last.get("body") or "")[:200],
                            "created_at": last.get("created_at"),
                        }
                        if last
                        else None
                    ),
                }
            )

        return jsonify(
            {
                "conversations": items,
                "total": page_block["meta"]["total"],
                "page": page_block["meta"]["page"],
                "per_page": page_block["meta"]["per_page"],
                "total_pages": page_block["meta"]["total_pages"],
            }
        )

    except Exception as e:
        logger.error("Admin chat list error: %s", e)
        return jsonify({"error": "Failed to fetch conversations"}), 500


@admin_bp.route("/chat/conversations/<conversation_id>/messages", methods=["GET"])
@admin_auth_required
def get_chat_thread(conversation_id):
    """
    The full thread plus a summary of the customer it belongs to.

    Opening the thread is also the operator's acknowledgement: the customer's
    messages are stamped `read_at` and the conversation's operator-unread
    counter is zeroed, which is what keeps `/chat/unread-count` meaningful.
    """
    try:
        supabase = db.require_client()
        conversation = _chat_conversation(supabase, conversation_id)
        if not conversation:
            return jsonify({"error": "Conversation not found"}), 404

        messages = fetch_all(
            lambda offset, limit: (
                supabase.table("chat_messages")
                .select("*")
                .eq("conversation_id", str(conversation["id"]))
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )
        )

        supabase.table("chat_messages").update(
            {"read_at": sessions.now_iso()}
        ).eq("conversation_id", str(conversation["id"])).eq("sender", "user").is_(
            "read_at", "null"
        ).execute()
        supabase.table("chat_conversations").update(
            {"unread_admin_count": 0}
        ).eq("id", str(conversation["id"])).execute()
        conversation["unread_admin_count"] = 0

        return jsonify(
            {
                "conversation": {
                    "id": str(conversation["id"]),
                    "status": conversation.get("status"),
                    "subject": conversation.get("subject"),
                    "last_message_at": conversation.get("last_message_at"),
                    "unread_admin_count": 0,
                    "unread_user_count": int(conversation.get("unread_user_count") or 0),
                    "created_at": conversation.get("created_at"),
                },
                "user": _chat_user_summary(supabase, conversation.get("user_id")),
                "messages": [_chat_message_payload(row) for row in messages],
            }
        )

    except Exception as e:
        logger.error("Admin chat thread error: %s", e)
        return jsonify({"error": "Failed to fetch the conversation"}), 500


@admin_bp.route("/chat/conversations/<conversation_id>/messages", methods=["POST"])
@limiter.limit("30 per minute")
@admin_auth_required
def reply_chat_conversation(conversation_id):
    """Post the operator's reply. The conversation must be open — reopen it first if it was closed."""
    try:
        supabase = db.require_client()
        conversation = _chat_conversation(supabase, conversation_id)
        if not conversation:
            return jsonify({"error": "Conversation not found"}), 404
        if conversation.get("status") != "open":
            return jsonify({"error": "Conversation is closed; reopen it before replying"}), 409

        data = request.get_json(silent=True) or {}
        body = str(data.get("body") or "").strip()
        if not body:
            return jsonify({"error": "body is required"}), 400
        if len(body) > MAX_CHAT_MESSAGE_LENGTH:
            return jsonify({"error": f"body must be at most {MAX_CHAT_MESSAGE_LENGTH} characters"}), 400

        inserted = (
            supabase.table("chat_messages")
            .insert(
                {
                    "conversation_id": str(conversation["id"]),
                    "sender": "admin",
                    "body": body,
                }
            )
            .execute()
        )
        message = inserted.data[0]

        stamp = sessions.now_iso()
        supabase.table("chat_conversations").update(
            {
                "last_message_at": stamp,
                "unread_user_count": int(conversation.get("unread_user_count") or 0) + 1,
            }
        ).eq("id", str(conversation["id"])).execute()

        g.admin_action_detail = (
            f"Replied to chat conversation {conversation_id} ({len(body)} characters)"
        )

        return jsonify({"message": _chat_message_payload(message)}), 201

    except Exception as e:
        logger.error("Admin chat reply error: %s", e)
        return jsonify({"error": "Failed to send the reply"}), 500


def _set_chat_status(conversation_id, status: str):
    """Shared body of the close/reopen endpoints."""
    supabase = db.require_client()
    conversation = _chat_conversation(supabase, conversation_id)
    if not conversation:
        return jsonify({"error": "Conversation not found"}), 404

    if conversation.get("status") == status:
        return jsonify(
            {
                "conversation_id": str(conversation["id"]),
                "status": status,
                "changed": False,
            }
        )

    if status == "open":
        open_threads = (
            supabase.table("chat_conversations")
            .select("id")
            .eq("user_id", conversation["user_id"])
            .eq("status", "open")
            .limit(MAX_OPEN_CONVERSATIONS_PER_USER)
            .execute()
        )
        if len(open_threads.data or []) >= MAX_OPEN_CONVERSATIONS_PER_USER:
            return jsonify(
                {
                    "error": (
                        f"This user already has {MAX_OPEN_CONVERSATIONS_PER_USER} open conversations. "
                        "Close one before reopening another."
                    )
                }
            ), 409

    updated = (
        supabase.table("chat_conversations")
        .update({"status": status})
        .eq("id", str(conversation["id"]))
        .execute()
    )
    if not updated.data:
        return jsonify({"error": "Failed to update the conversation"}), 500

    g.admin_action_detail = (
        f"{'Closed' if status == 'closed' else 'Reopened'} chat conversation {conversation_id}"
    )

    return jsonify(
        {
            "conversation_id": str(conversation["id"]),
            "status": status,
            "changed": True,
        }
    )


@admin_bp.route("/chat/conversations/<conversation_id>/close", methods=["POST"])
@limiter.limit("30 per minute")
@admin_auth_required
def close_chat_conversation(conversation_id):
    """Close a conversation. The customer can no longer post into it."""
    try:
        return _set_chat_status(conversation_id, "closed")
    except Exception as e:
        logger.error("Admin chat close error: %s", e)
        return jsonify({"error": "Failed to close the conversation"}), 500


@admin_bp.route("/chat/conversations/<conversation_id>/reopen", methods=["POST"])
@limiter.limit("30 per minute")
@admin_auth_required
def reopen_chat_conversation(conversation_id):
    """Reopen a closed conversation."""
    try:
        return _set_chat_status(conversation_id, "open")
    except Exception as e:
        logger.error("Admin chat reopen error: %s", e)
        return jsonify({"error": "Failed to reopen the conversation"}), 500


@admin_bp.route("/chat/unread-count", methods=["GET"])
@admin_auth_required
def chat_unread_count():
    """Total unread customer messages across open conversations — the nav badge."""
    try:
        supabase = db.require_client()
        rows = fetch_all(
            lambda offset, limit: (
                supabase.table("chat_conversations")
                .select("unread_admin_count")
                .eq("status", "open")
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )
        )
        return jsonify(
            {
                "unread": sum(int(row.get("unread_admin_count") or 0) for row in rows),
                "open_conversations": len(rows),
            }
        )

    except Exception as e:
        logger.error("Admin chat unread count error: %s", e)
        return jsonify({"error": "Failed to fetch the unread count"}), 500


# ── Blueprint-wide rate limit ───────────────────────────────────────────────
#
# The routes above carry no individual limit unless they are expensive, so this
# is the backstop: the admin surface exposes every user's PII and can move
# credits, and a leaked `ADMIN_CODE` should not also mean unlimited requests.
# Flask-Limiter applies a blueprint limit per route, so the explicit limits above
# stay stricter where it matters.
#
# Applied here rather than on each route so a new admin endpoint is throttled by
# default instead of by remembering.
limiter.limit("120 per minute")(admin_bp)

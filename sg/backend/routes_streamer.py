"""
Streamer dashboard routes.

Streamers are brand partners rather than end users: they authenticate with an
`id_code` plus a password from the `credentials` table, and receive a token
rather than a session cookie. Because their identity lives outside `users`, they
cannot use the revocable `sessions` store — the token's lifetime is the only
control (SG_STREAMER_TOKEN_TTL_DAYS).

A *manager* (a streamer with others beneath them) sees their whole branch: the
users they referred themselves plus the users referred by every streamer under
them. Every read behind that is chunked and paged — see `streamers.py` and
`pagination.py` — because a branch can be arbitrarily wide and PostgREST caps a
single response at 1,000 rows.
"""

from __future__ import annotations

import hmac
import logging
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import Blueprint, current_app, g, jsonify, request

import db
import plans
import streamers
from auth_utils import hash_password, verify_password
from constants import TOKEN_TYPE_STREAMER
from credits import bulk_user_totals
from pagination import DEFAULT_PAGE_SIZE as MAX_PAGE_SIZE

logger = logging.getLogger(__name__)

bp = Blueprint("streamer", __name__)

DEFAULT_PAGE = 1
# The portal shows a partner their own network, so the default page is generous
# while remaining bounded.
DEFAULT_PER_PAGE = 100


# ── Authentication ──────────────────────────────────────────────────────────

def issue_streamer_token(streamer_id, *, is_manager: bool) -> str:
    """Mint a streamer token. The issuer is verified on the way back in."""
    ttl_days = current_app.config["STREAMER_TOKEN_TTL_DAYS"]
    issued = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "iss": current_app.config["ACCESS_TOKEN_ISSUER"],
            "iat": issued,
            "exp": issued + timedelta(days=ttl_days),
            "streamer_id": str(streamer_id),
            "type": TOKEN_TYPE_STREAMER,
            "is_manager": bool(is_manager),
        },
        current_app.config["JWT_SECRET"],
        algorithm="HS256",
    )


def verify_streamer_password(stored: str | None, provided: str) -> tuple:
    """
    Verify a streamer password, transparently upgrading legacy plaintext.

    `credentials.password` has historically held plaintext. Instead of forcing
    every partner to reset, a successful plaintext comparison returns a hash to
    persist, so the row is upgraded on the next login.
    """
    if not stored:
        return False, None

    if stored.startswith(("scrypt:", "pbkdf2:", "argon2")):
        return verify_password(stored, provided)

    if hmac.compare_digest(stored, provided):
        return True, hash_password(provided)

    return False, None


def streamer_auth_required(view):
    """
    Guard for streamer-only routes.

    Populates ``g.streamer_id`` and ``g.is_manager``. `g` rather than
    `request.streamer_id`, matching how the user-facing guard uses `g.user`.
    """

    @wraps(view)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization") or ""
        if not header.lower().startswith("bearer "):
            return jsonify({"error": "Unauthorized"}), 401

        try:
            payload = jwt.decode(
                header[7:].strip(),
                current_app.config["JWT_SECRET"],
                algorithms=["HS256"],
                issuer=current_app.config["ACCESS_TOKEN_ISSUER"],
            )
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401
        except Exception as exc:
            logger.error("Streamer token verification failed: %s", exc)
            return jsonify({"error": "Invalid token"}), 401

        if payload.get("type") != TOKEN_TYPE_STREAMER:
            return jsonify({"error": "Invalid token type"}), 401

        g.streamer_id = payload["streamer_id"]
        g.is_manager = payload.get("is_manager", False)
        return view(*args, **kwargs)

    return wrapper


# ── Paging ──────────────────────────────────────────────────────────────────

def _page_params() -> tuple:
    """
    `(page, per_page)` from the query string, clamped.

    Clamped rather than trusted: `per_page=0` would divide by zero when the page
    count is derived, and an unbounded value would defeat the point of paging.
    """
    try:
        page = max(1, int(request.args.get("page", DEFAULT_PAGE)))
        per_page = max(1, min(MAX_PAGE_SIZE, int(request.args.get("per_page", DEFAULT_PER_PAGE))))
    except (TypeError, ValueError):
        page, per_page = DEFAULT_PAGE, DEFAULT_PER_PAGE
    return page, per_page


def _paginate(rows: list, page: int, per_page: int) -> dict:
    total = len(rows)
    start = (page - 1) * per_page
    return {
        "items": rows[start : start + per_page],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
    }


# ── Network view ────────────────────────────────────────────────────────────

def _network_rows(supabase, streamer_id: str) -> tuple:
    """
    ``(streamer_summaries, referred_users)`` for `streamer_id`'s whole branch.

    The downline is resolved first, then only those streamers (and only their
    referred users) are read — in chunked, paged passes, never one query per
    streamer.
    """
    network_ids = streamers.downline_ids(supabase, streamer_id)
    keys = {str(i) for i in network_ids}

    codes = streamers.id_codes_for(supabase, network_ids)
    summaries = [
        streamers.summary(row, codes.get(str(row["streamer_id"])))
        for row in streamers.rows_by_ids(supabase, network_ids)
        if str(row["streamer_id"]) in keys
    ]

    users = streamers.users_of(
        supabase,
        network_ids,
        columns=(
            "id, username, email, created_at, updated_at, last_login, "
            "credits_balance, referred_by_streamer"
        ),
    )
    return summaries, users


def _decorate_users(supabase, users: list, codes: dict) -> list:
    """
    Attach each user's spend, and which streamer in the network owns them.

    Aggregated in one bulk ledger read rather than a per-user query.
    """
    totals = bulk_user_totals(
        supabase,
        [u["id"] for u in users],
        euro_value=plans.euro_value_of_credits,
    )

    decorated = []
    for user in users:
        uid = str(user["id"])
        entry = totals.get(uid, {})
        owner = user.get("referred_by_streamer")
        decorated.append(
            {
                "id": uid,
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
    return decorated


# ── Routes ──────────────────────────────────────────────────────────────────

@bp.route("/streamer/login", methods=["POST"])
def streamer_login():
    """Authenticate a streamer with an id_code and password."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request data"}), 400

    id_code = (data.get("id_code") or "").strip().upper()
    password = data.get("password") or ""

    if not id_code or not password:
        return jsonify({"error": "ID code and password are required"}), 400

    supabase = db.require_client()

    try:
        credentials = (
            supabase.table("credentials").select("*").eq("id_code", id_code).limit(1).execute()
        )
        if not credentials.data:
            logger.warning("Streamer login rejected: unknown id_code")
            return jsonify({"error": "Invalid credentials"}), 401

        cred = credentials.data[0]
        valid, upgraded = verify_streamer_password(cred.get("password"), password)
        if not valid:
            logger.warning("Streamer login rejected: incorrect password")
            return jsonify({"error": "Invalid credentials"}), 401

        if upgraded:
            try:
                supabase.table("credentials").update({"password": upgraded}).eq(
                    "id_code", id_code
                ).execute()
                logger.info("Upgraded a streamer credential to a password hash")
            except Exception as exc:
                logger.error("Could not upgrade streamer credential: %s", exc)

        streamer_id = cred["streamer_id"]
        row = streamers.get(supabase, streamer_id)
        if not row:
            return jsonify({"error": "Streamer not found"}), 404

        summary = streamers.summary(row, id_code)
        return jsonify(
            {
                "token": issue_streamer_token(
                    streamer_id, is_manager=summary["is_manager"]
                ),
                "streamer": summary,
            }
        )

    except Exception as exc:
        logger.error("Streamer login error: %s", exc)
        return jsonify({"error": "Login failed"}), 500


@bp.route("/streamer/profile", methods=["GET"])
@streamer_auth_required
def get_streamer_profile():
    """The caller's own profile and balance."""
    supabase = db.require_client()

    try:
        row = streamers.get(supabase, g.streamer_id)
        if not row:
            return jsonify({"error": "Streamer not found"}), 404

        return jsonify(
            streamers.summary(row, streamers.id_code_for(supabase, g.streamer_id))
        )

    except Exception as exc:
        logger.error("Get streamer profile error: %s", exc)
        return jsonify({"error": "Failed to get profile"}), 500


@bp.route("/streamer/subordinates", methods=["GET"])
@streamer_auth_required
def get_subordinates():
    """The streamers directly beneath the caller, plus the team totals."""
    if not g.is_manager:
        return jsonify({"error": "Access denied. Manager only."}), 403

    try:
        supabase = db.require_client()
        page, per_page = _page_params()
        subordinates = streamers.subordinates_of(supabase, g.streamer_id)
        page_block = _paginate(subordinates, page, per_page)

        return jsonify(
            {
                "subordinates": page_block["items"],
                "total": page_block["total"],
                "page": page_block["page"],
                "per_page": page_block["per_page"],
                "total_pages": page_block["total_pages"],
                # Totals cover the whole team, not just the page returned.
                **streamers.network_totals(subordinates),
            }
        )

    except Exception as exc:
        logger.error("Get subordinates error: %s", exc)
        return jsonify({"error": "Failed to get subordinates"}), 500


@bp.route("/streamer/dashboard", methods=["GET"])
@streamer_auth_required
def get_dashboard():
    """Profile, plus the team block when the caller is a manager."""
    supabase = db.require_client()

    try:
        row = streamers.get(supabase, g.streamer_id)
        if not row:
            return jsonify({"error": "Streamer not found"}), 404

        profile = streamers.summary(
            row, streamers.id_code_for(supabase, g.streamer_id)
        )
        response = {"profile": profile}

        if not row.get("is_managed", False):
            page, per_page = _page_params()
            subordinates = streamers.subordinates_of(supabase, g.streamer_id)
            page_block = _paginate(subordinates, page, per_page)
            response["subordinates"] = page_block["items"]
            response["subordinates_page"] = {
                "total": page_block["total"],
                "page": page_block["page"],
                "per_page": page_block["per_page"],
                "total_pages": page_block["total_pages"],
            }
            response["team_stats"] = streamers.network_totals(subordinates)

        return jsonify(response)

    except Exception as exc:
        logger.error("Get dashboard error: %s", exc)
        return jsonify({"error": "Failed to get dashboard"}), 500


@bp.route("/streamer/<streamer_id>/subscribed", methods=["GET"])
@streamer_auth_required
def get_subscribed_users(streamer_id):
    """
    Every user acquired through the caller or through any streamer beneath them.

    A manager's branch is the unit of reporting: a user brought in by a
    subordinate is part of the manager's book of business too, and each user says
    which streamer owns them.

    `users` is one page; the totals cover the whole network. `GET /api/streamer/
    <id>/subscribed?page=2&per_page=50` walks the rest.
    """
    # A streamer can only see their own branch.
    if str(g.streamer_id) != str(streamer_id):
        return jsonify({"error": "Unauthorized"}), 403

    supabase = db.require_client()

    try:
        page, per_page = _page_params()
        network, referred = _network_rows(supabase, streamer_id)

        if not referred:
            return jsonify(
                {
                    "users": [],
                    "network_streamers": network,
                    "total_users": 0,
                    "total_euros_spent": 0,
                    "total_credits_bought": 0,
                    "total_credits_spent": 0,
                    "page": page,
                    "per_page": per_page,
                    "total_pages": 0,
                }
            )

        codes = {s["id"]: s["id_code"] for s in network}
        decorated = _decorate_users(supabase, referred, codes)
        decorated.sort(key=lambda u: (u["username"] or "").lower())

        page_block = _paginate(decorated, page, per_page)

        return jsonify(
            {
                "users": page_block["items"],
                # The branch these users came from, so the UI can group or filter.
                "network_streamers": network,
                "total_users": page_block["total"],
                "total_euros_spent": round(
                    sum(u["euros_spent"] for u in decorated), 2
                ),
                "total_credits_bought": sum(u["credits_bought"] for u in decorated),
                "total_credits_spent": sum(u["credits_spent"] for u in decorated),
                "page": page_block["page"],
                "per_page": page_block["per_page"],
                "total_pages": page_block["total_pages"],
            }
        )

    except Exception as exc:
        logger.error("Get subscribed users error: %s", exc)
        return jsonify({"error": "Failed to get subscribed users"}), 500

"""
Streamer (partner) domain helpers.

A streamer is a brand partner, not a `users` row: they authenticate with an
`id_code` from `credentials` and are paid a share of subscription revenue.

The manager relationship (`streamers.manager_id`) forms a tree, but **nothing in
the database enforces that** — a cycle or a very deep chain is one bad admin
write away. Every traversal here is therefore cycle-safe and depth-bounded, the
same way `billing.payout_streamers` guards its payout walk.

Both the streamer portal and the admin API need this, which is why it lives
outside the route modules (they must not import each other).
"""

from __future__ import annotations

import logging

import pagination

logger = logging.getLogger(__name__)

# The chain is walked parent-by-parent, so this is a hard stop on a deep or
# looped chain rather than a real-world limit. A partner tree 20 levels deep is
# already a data-entry problem.
MAX_DEPTH = 20
# Hard stop on the size of one streamer's downline, so a corrupted tree cannot
# turn one request into an unbounded crawl.
MAX_DOWNLINE = 5000


# ── Reads ───────────────────────────────────────────────────────────────────

def get(supabase, streamer_id) -> dict | None:
    if not streamer_id:
        return None
    result = (
        supabase.table("streamers")
        .select("*")
        .eq("streamer_id", streamer_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def all_rows(supabase) -> list:
    """
    Every streamer, paginated.

    `streamers` holds partners rather than end users, so it is small — but an
    unpaginated read still truncates at PostgREST's 1,000-row cap without saying
    so, and the admin list silently losing half its rows is not acceptable.
    """
    return pagination.fetch_all(
        lambda offset, limit: (
            supabase.table("streamers")
            .select("*")
            .order("created_at", desc=True)
            .order("streamer_id")
            .range(offset, offset + limit - 1)
            .execute()
            .data
        )
    )


def rows_by_ids(supabase, streamer_ids) -> list:
    """The `streamers` rows for `streamer_ids`, with no cap."""
    if not streamer_ids:
        return []
    return pagination.fetch_in(
        supabase, "streamers", "*", "streamer_id", streamer_ids,
        order="streamer_id",
    )


def id_codes_for(supabase, streamer_ids) -> dict:
    """
    ``{streamer_id: id_code}`` for many streamers in one pass.

    Replaces the per-streamer lookup that turned a streamer list into N+1
    queries.
    """
    mapping = {}
    rows = pagination.fetch_in(
        supabase, "credentials", "id_code, streamer_id", "streamer_id", streamer_ids
    )
    for row in rows:
        mapping[str(row["streamer_id"])] = row.get("id_code")
    return mapping


def id_code_for(supabase, streamer_id) -> str | None:
    return id_codes_for(supabase, [streamer_id]).get(str(streamer_id))


def summary(row: dict, id_code: str | None) -> dict:
    """The streamer shape shared by the profile, dashboard and list endpoints."""
    return {
        "id": str(row["streamer_id"]),
        "id_code": id_code,
        "is_manager": not row.get("is_managed", False),
        "balance_available": float(row.get("balance_available") or 0),
        "total_earned": float(row.get("total_earned") or 0),
        "referred_num": row.get("referred_num", 0),
        "created_at": row.get("created_at"),
    }


def subordinates_of(supabase, streamer_id) -> list:
    """Every streamer directly managed by `streamer_id`, summarised."""
    subs = pagination.fetch_all(
        lambda offset, limit: (
            supabase.table("streamers")
            .select("*")
            .eq("manager_id", streamer_id)
            .order("streamer_id")
            .range(offset, offset + limit - 1)
            .execute()
            .data
        )
    )
    codes = id_codes_for(supabase, [s["streamer_id"] for s in subs])
    return [summary(sub, codes.get(str(sub["streamer_id"]))) for sub in subs]


def downline_ids(supabase, streamer_id, *, include_self: bool = True) -> list:
    """
    `streamer_id` and every streamer beneath it, breadth-first.

    Direct-only would be wrong for a manager of managers: money and referred users
    belong to the whole branch, so "my network" has to mean the whole subtree.

    Cycle-safe (`visited`) and bounded (`MAX_DEPTH`, `MAX_DOWNLINE`), because the
    manager chain is data, not a guarantee.
    """
    if not streamer_id:
        return []

    ids = [streamer_id] if include_self else []
    visited = {str(streamer_id)}
    frontier = [streamer_id]

    for _ in range(MAX_DEPTH):
        if not frontier:
            break

        children = pagination.fetch_in(
            supabase, "streamers", "streamer_id", "manager_id", frontier,
            order="streamer_id",
        )

        next_frontier = []
        for child in children:
            key = str(child["streamer_id"])
            if key in visited:
                # A cycle, or a duplicate edge. Either way, stop following it.
                logger.warning(
                    "Ignoring a repeat manager edge at streamer %s (cycle guard)", key
                )
                continue
            visited.add(key)
            ids.append(child["streamer_id"])
            next_frontier.append(child["streamer_id"])

            if len(ids) >= MAX_DOWNLINE:
                logger.error(
                    "Downline of %s exceeded %s streamers; truncated.",
                    streamer_id,
                    MAX_DOWNLINE,
                )
                return ids

        frontier = next_frontier

    if frontier:
        logger.warning("Downline of %s exceeded depth %s; truncated.", streamer_id, MAX_DEPTH)

    return ids


def referred_counts(supabase) -> dict:
    """
    ``{streamer_id: referred_user_count}`` for every streamer, in one pass.

    Counting live from `users` (rather than trusting the cached
    `streamers.referred_num`) is the existing behaviour; doing it in one paginated
    read is what keeps it from being one query per streamer.
    """
    counts: dict = {}
    rows = pagination.fetch_all(
        lambda offset, limit: (
            supabase.table("users")
            .select("referred_by_streamer")
            .not_.is_("referred_by_streamer", "null")
            .order("id")
            .range(offset, offset + limit - 1)
            .execute()
            .data
        )
    )
    for row in rows:
        sid = row.get("referred_by_streamer")
        if sid:
            counts[str(sid)] = counts.get(str(sid), 0) + 1
    return counts


def users_of(supabase, streamer_ids, columns: str = "*") -> list:
    """
    Every user referred by any of `streamer_ids`, with no cap.

    The one read that both the portal's "my network" view and the admin
    drill-down are built from.
    """
    if not streamer_ids:
        return []
    return pagination.fetch_in(
        supabase, "users", columns, "referred_by_streamer", streamer_ids
    )


def network_totals(subordinates: list) -> dict:
    return {
        "total_subordinates": len(subordinates),
        "total_team_balance": sum(s["balance_available"] for s in subordinates),
        "total_team_earned": sum(s["total_earned"] for s in subordinates),
    }

"""
PostgREST pagination.

Supabase caps a single PostgREST response at 1,000 rows by default. An
unpaginated bulk read therefore looks perfect in development and silently
truncates in production — which is how a campaign aimed at 3,000 people ends up
emailing 1,000 of them, with nothing in the response to indicate it.

Always order the query. Postgres does not guarantee a stable order across
separate requests, so without an `ORDER BY` two consecutive pages can overlap or
skip rows even though each page is internally consistent.
"""

from __future__ import annotations

# Supabase's default per-response row cap. Paging in exactly this size guarantees
# no page is ever clipped by the server.
DEFAULT_PAGE_SIZE = 1000

# PostgREST puts every value of an `in.(…)` filter into the URL, so a long id list
# has to be split across several requests. This is a *request-size* limit, not a
# or row limit — the two are unrelated, which is why it is separate from
# DEFAULT_PAGE_SIZE.
IN_FILTER_CHUNK = 100


def chunked(values, size: int = IN_FILTER_CHUNK) -> list[list]:
    """Split `values` into consecutive lists of at most `size`."""
    values = list(values or [])
    return [values[i : i + size] for i in range(0, len(values), size)]


def fetch_in(supabase, table: str, columns: str, column: str, values, *, order: str = "id") -> list:
    """
    Every row of `table` whose `column` is one of `values`, with no cap.

    Combines both limits a bulk read has to respect: the `in.(…)` filter is
    chunked so the URL stays sane, and each chunk is paged so a chunk that holds
    more than `DEFAULT_PAGE_SIZE` rows is not silently truncated.
    """
    rows: list = []
    for chunk in chunked(values):
        rows.extend(
            fetch_all(
                lambda offset, limit, chunk=chunk: (
                    supabase.table(table)
                    .select(columns)
                    .in_(column, chunk)
                    .order(order)
                    .range(offset, offset + limit - 1)
                    .execute()
                    .data
                )
            )
        )
    return rows


def fetch_all(build_query, *, page_size: int = DEFAULT_PAGE_SIZE, max_rows: int | None = None) -> list:
    """
    Collect every row a query returns, one page at a time.

    `build_query(offset, limit)` must execute the query for that window and return
    its rows — usually::

        fetch_all(
            lambda offset, limit: (
                supabase.table("users")
                .select(COLUMNS)
                .order("email")
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )
        )

    Note the inclusive `range` end: `range(0, 999)` is 1,000 rows.

    Iteration stops when a page comes back short of `limit`, which is the only
    reliable end-of-data signal PostgREST gives.
    """
    if page_size <= 0:
        raise ValueError("page_size must be positive")

    rows: list = []
    offset = 0

    while True:
        limit = page_size if max_rows is None else min(page_size, max_rows - len(rows))
        if limit <= 0:
            break

        page = list(build_query(offset, limit) or [])
        rows.extend(page)

        # A short page means we have reached the end.
        if len(page) < limit:
            break

        offset += len(page)

        if max_rows is not None and len(rows) >= max_rows:
            break

    if max_rows is not None and len(rows) > max_rows:
        rows = rows[:max_rows]

    return rows

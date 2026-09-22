"""
The single access point for the Supabase client.

`app` builds the client at import time, before configuration is validated, so the
module attribute can legitimately be `None` (missing `SUPABASE_URL`/`SUPABASE_KEY`).
Reading it through a function — rather than `from app import supabase` at module
scope — means the client is looked up per call and a misconfigured deployment
fails with a clear error instead of an `AttributeError: 'NoneType'`.
"""

from __future__ import annotations


class DatabaseNotConfigured(RuntimeError):
    """Raised when a request needs the database but no client could be built."""


def client():
    """The configured Supabase client, or ``None``."""
    from app import supabase

    return supabase


def require_client():
    """The configured Supabase client, or raise. Use on any path that needs it."""
    configured = client()
    if configured is None:
        raise DatabaseNotConfigured("Supabase client is not configured")
    return configured

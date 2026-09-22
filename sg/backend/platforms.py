"""
Platform registry.

A "platform" is a first-party surface of the brand that authenticates users
through SilverGate: the eFootball coaching app, fromzerotohero.io, and so on.

Platforms are configured with the SG_PLATFORMS environment variable as a JSON
object keyed by client_id:

    {
      "efootball": {
        "name": "eFootball Coaching",
        "origins": ["https://efootball.fromzerotohero.io"],
        "redirect_uris": ["https://efootball.fromzerotohero.io/auth/callback"],
        "api_key": "<secret>"
      }
    }

Keeping the registry in configuration (rather than a table) means the SSO
exchange works the moment the application is deployed, with no migration
dependency. architecture/03 proposes a `platforms` table for a later phase, at
which point this module becomes the cache in front of it.
"""

from __future__ import annotations

import hmac
import logging

from flask import current_app

logger = logging.getLogger(__name__)


def _registry() -> dict:
    return current_app.config["PLATFORMS"]


def get(client_id: str) -> dict | None:
    if not client_id:
        return None
    platform = _registry().get(client_id)
    return platform if isinstance(platform, dict) else None


def all_ids() -> list[str]:
    return sorted(_registry().keys())


def redirect_uri_allowed(client_id: str, redirect_uri: str) -> bool:
    """
    Exact-match validation of a redirect URI.

    Never allow prefix or substring matching here: an open redirect is the
    classic OAuth vulnerability, and with a session-less token exchange it would
    hand an attacker a real credential.
    """
    platform = get(client_id)
    if not platform or not redirect_uri:
        return False
    return redirect_uri in (platform.get("redirect_uris") or [])


def authenticate_api_key(provided: str | None) -> str | None:
    """
    Resolve the client_id that owns ``provided`` API key, or ``None``.

    Comparison is constant-time per key so that a caller cannot learn a key
    prefix by timing the endpoint.
    """
    if not provided:
        return None

    for client_id, platform in _registry().items():
        expected = platform.get("api_key")
        if expected and hmac.compare_digest(str(expected), provided):
            return client_id

    logger.warning("Rejected an unknown platform API key.")
    return None

"""
TOTP (RFC 6238) — a real second factor for the admin surface.

The admin API can read every user's data and move credits. Until now it was
gated by a single shared string, which means one value leaked into a log, a
screenshot or a browser autofill is enough to lose everything. A code that
changes every 30 seconds is not stored anywhere and cannot be replayed from a
leak.

Implemented on `hmac`/`hashlib` rather than pulled in as a dependency: TOTP is
HMAC-SHA1 and a truncation, and the RFC publishes test vectors, so correctness
is verifiable rather than trusted (see `sim/security_checks.py`).

Compatible with Google Authenticator, Authy, 1Password, etc.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
import time
from urllib.parse import quote

logger = logging.getLogger(__name__)

DIGITS = 6
PERIOD_SECONDS = 30
# ±1 step tolerates clock drift between the server and the authenticator app.
# It also means a code is acceptable for up to ~90s, which is why the admin
# surface is additionally rate-limited and (recommended) IP-restricted.
DEFAULT_WINDOW = 1


def generate_secret() -> str:
    """A fresh base32 secret, the format every authenticator app accepts."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii")


def _decode(secret: str) -> bytes:
    cleaned = (secret or "").strip().replace(" ", "").replace("-", "").upper()
    if not cleaned:
        raise ValueError("empty TOTP secret")
    cleaned += "=" * (-len(cleaned) % 8)
    return base64.b32decode(cleaned, casefold=True)


def _code_for_counter(key: bytes, counter: int) -> str:
    digest = hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha1).digest()
    # RFC 4226 dynamic truncation: the low nibble of the last byte picks a
    # 4-byte window, whose top bit is masked off.
    offset = digest[-1] & 0x0F
    truncated = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    return f"{truncated % (10 ** DIGITS):0{DIGITS}d}"


def code_at(secret: str, at: float | None = None) -> str:
    """The code valid at `at` (default: now). Used by tests and by the CLI."""
    moment = time.time() if at is None else at
    return _code_for_counter(_decode(secret), int(moment // PERIOD_SECONDS))


def verify(secret: str, code: str, *, at: float | None = None, window: int = DEFAULT_WINDOW) -> bool:
    """Constant-time check of `code` against the current and adjacent steps."""
    if not code or not secret:
        return False

    candidate = str(code).strip().replace(" ", "")
    if not candidate.isdigit() or len(candidate) != DIGITS:
        return False

    try:
        key = _decode(secret)
    except Exception as exc:
        # A malformed secret is a misconfiguration, not a failed login.
        logger.error("TOTP secret is not valid base32: %s", exc)
        return False

    moment = time.time() if at is None else at
    step = int(moment // PERIOD_SECONDS)

    matched = False
    for offset in range(-window, window + 1):
        expected = _code_for_counter(key, step + offset)
        # compare_digest on every step, without short-circuiting, so the timing
        # does not reveal how close a guess was.
        if hmac.compare_digest(expected, candidate):
            matched = True
    return matched


def provisioning_uri(secret: str, account: str, issuer: str = "SilverGate") -> str:
    """
    The `otpauth://` URI to scan or paste into an authenticator app.

    Printed once by `python totp.py` when the secret is generated; it contains the
    secret, so it is as sensitive as the secret itself.
    """
    label = quote(f"{issuer}:{account}", safe="")
    return (
        f"otpauth://totp/{label}"
        f"?secret={secret}&issuer={quote(issuer)}"
        f"&algorithm=SHA1&digits={DIGITS}&period={PERIOD_SECONDS}"
    )


if __name__ == "__main__":  # pragma: no cover - operator utility
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "code":
        # `python totp.py code <secret>` — derive the current code, for verifying
        # a deployment without an app to hand.
        print(code_at(sys.argv[2]))
    else:
        fresh = generate_secret()
        print("SG_ADMIN_TOTP_SECRET=" + fresh)
        print()
        print("Add it to an authenticator app by scanning:")
        print("  " + provisioning_uri(fresh, "admin"))
        print()
        print("Or paste the secret above into the app manually.")

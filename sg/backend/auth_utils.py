"""
Password hashing and verification.

Werkzeug's default (currently scrypt, or pbkdf2 when scrypt is unavailable in
the interpreter) is what new passwords get. Legacy SHA-256 hashes from before
that are still accepted once, and transparently upgraded on a successful login —
so no existing account is forced to reset.
"""

import hashlib
import logging

from werkzeug.security import check_password_hash, generate_password_hash

logger = logging.getLogger(__name__)

# A legacy hash is a bare 64-character hex digest. Werkzeug's own hashes always
# carry a `method:` prefix, which is what tells the two apart.
_LEGACY_SHA256_LENGTH = 64


def hash_password(password: str) -> str:
    """Hash a password with the strongest method this interpreter supports."""
    try:
        return generate_password_hash(password)
    except Exception as exc:
        logger.warning(
            "Default password hash failed (%s); falling back to pbkdf2:sha256", exc
        )
        return generate_password_hash(password, method="pbkdf2:sha256")


def verify_password(stored_hash, password: str) -> tuple:
    """
    Check a password against a stored hash.

    Returns ``(is_valid, new_hash)``. ``new_hash`` is set only when a legacy hash
    matched and should be replaced with a modern one — the caller persists it.
    """
    if not stored_hash:
        logger.warning("Password check attempted with no stored hash")
        return False, None

    if len(stored_hash) == _LEGACY_SHA256_LENGTH and ":" not in stored_hash:
        return _verify_legacy(stored_hash, password)

    try:
        return check_password_hash(stored_hash, password), None
    except Exception as exc:
        # A malformed stored hash must fail the login, not raise out of the view.
        logger.error("Password verification failed: %s", exc)
        return False, None


def _verify_legacy(stored_hash: str, password: str) -> tuple:
    try:
        computed = hashlib.sha256(password.encode()).hexdigest()
    except Exception as exc:
        logger.error("Legacy password check failed: %s", exc)
        return False, None

    # Hex digests are case-insensitive.
    if computed.lower() != stored_hash.lower():
        logger.warning(
            "Legacy password mismatch (computed %s…, stored %s…)",
            computed[:10],
            stored_hash[:10],
        )
        return False, None

    # Valid, but the stored form is weak: return a modern hash for the caller to
    # save. A failure there must not fail the login.
    logger.info("Legacy password hash matched; upgrading to a secure hash")
    try:
        return True, hash_password(password)
    except Exception as exc:
        logger.error("Could not generate an upgraded password hash: %s", exc)
        return True, None

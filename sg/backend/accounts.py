"""
Account serialisation and the one sign-in flow.

Every path that signs a user in — `/api/login`, `/api/sso/login` — and every path
that answers "who is this" — `/api/session`, `/api/me`, the SSO token exchange —
goes through this module. It exists so that "signed in" and "what a user looks
like to a client" have exactly one definition.

It deliberately imports neither `routes` nor `routes_sso`. Those two used to
import each other for `public_user` and `perform_login`, which is a cycle that
only worked because the imports were buried inside functions. Anything both of
them need belongs here instead.
"""

from __future__ import annotations

import logging

from flask import jsonify

import auth
import db
import sessions
from auth_utils import verify_password
from constants import (
    LOGIN_FAILED_EMAIL_NOT_VERIFIED,
    LOGIN_FAILED_INVALID_CREDENTIALS,
)

logger = logging.getLogger(__name__)


def public_user(user: dict) -> dict:
    """The user shape returned by login, register, session and the SSO endpoints."""
    return {
        "id": str(user["id"]),
        "email": user.get("email"),
        "username": user.get("username"),
        "tag": user.get("tag"),
        "credits": user.get("credits_balance", 0),
        "email_verified": bool(user.get("email_verified", False)),
    }


def start_session(user: dict, *, service: str | None) -> tuple:
    """
    Create a session and return ``(session_material, access_token)``.

    Called from every path that signs a user in, so that there is exactly one
    definition of "signed in" in the codebase.
    """
    material = sessions.create(
        db.require_client(),
        user["id"],
        ip=auth.client_ip(),
        user_agent=auth.user_agent(),
        service=service,
    )
    token = auth.issue_access_token(
        user, session_id=material["session"]["id"], client_id=service
    )
    return material, token


def record_service_login(user: dict, service: str | None) -> None:
    """
    Persist login telemetry.

    Best effort: this must never fail a login. It also fills in
    `last_login_by_service`, which the previous backend read but never wrote.
    """
    stamp = sessions.now_iso()
    updates = {"last_login": stamp}
    if service:
        by_service = user.get("last_login_by_service")
        if not isinstance(by_service, dict):
            by_service = {}
        by_service[service] = stamp
        updates["last_login_by_service"] = by_service
    try:
        db.require_client().table("users").update(updates).eq("id", user["id"]).execute()
    except Exception as exc:
        logger.warning("Failed to record login for user %s: %s", user["id"], exc)


def perform_login(email: str, password: str, service: str | None):
    """
    Shared sign-in, used by `/api/login` and `/api/sso/login`.

    On success the returned response already carries the session cookie.
    """
    client = db.require_client()
    found = client.table("users").select("*").eq("email", email).execute()

    if found.data:
        user = found.data[0]
        is_valid, upgraded_hash = verify_password(user.get("password_hash"), password)

        if is_valid:
            if upgraded_hash:
                try:
                    client.table("users").update({"password_hash": upgraded_hash}).eq(
                        "id", user["id"]
                    ).execute()
                    logger.info("Upgraded legacy password hash for user %s", user["id"])
                except Exception as exc:
                    logger.error("Could not upgrade password hash for %s: %s", user["id"], exc)

            if not user.get("email_verified", False):
                return _unverified_response(client, user_id=user["id"], service=service)

            record_service_login(user, service)
            material, token = start_session(user, service=service)
            sessions.record_login_event(
                client,
                user_id=user["id"],
                service=service,
                success=True,
                ip=auth.client_ip(),
                user_agent=auth.user_agent(),
            )

            response = jsonify(
                {
                    "message": "Login successful",
                    "token": token,
                    "user": public_user(user),
                }
            )
            auth.set_session_cookie(response, material["token"])
            logger.info("Login succeeded for user %s (service=%s)", user["id"], service)
            return response

    # A pending registration: tell the user to verify rather than "invalid credentials".
    pending = client.table("tempusers").select("*").eq("email", email).execute()
    if pending.data and verify_password(pending.data[0].get("password_hash"), password)[0]:
        return _unverified_response(client, user_id=None, service=service)

    sessions.record_login_event(
        client,
        user_id=None,
        service=service,
        success=False,
        failure_reason=LOGIN_FAILED_INVALID_CREDENTIALS,
        ip=auth.client_ip(),
        user_agent=auth.user_agent(),
    )
    return jsonify({"error": "Invalid credentials"}), 401


def _unverified_response(client, *, user_id, service):
    sessions.record_login_event(
        client,
        user_id=user_id,
        service=service,
        success=False,
        failure_reason=LOGIN_FAILED_EMAIL_NOT_VERIFIED,
        ip=auth.client_ip(),
        user_agent=auth.user_agent(),
    )
    return (
        jsonify(
            {
                "error": "Email not verified",
                "message": "Please verify your email before logging in",
                "requires_verification": True,
            }
        ),
        403,
    )

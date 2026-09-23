"""
SilverGate customer chat: the user side of the operator↔customer support chat.

A user may have up to three open conversations at a time. Posting to a thread
is limited to three consecutive user messages; an administrator reply resets
that allowance. The operator side lives in `routes_admin.py`
(`/api/admin/chat/*`), which is also where conversations are closed and
reopened.

Auth is the ordinary session cookie (`auth.require_session`) — the chat is a
feature of a signed-in account, not a separate credential. Every query is
scoped to `g.user["id"]`, and anything that is not the caller's conversation
is a 404, never a 403: the existence of another customer's thread is not the
caller's business.

Realtime is polling, deliberately (Vercel serverless does not hold SSE
connections reliably): the widget re-fetches `GET …/messages?after=<id>` and
gets only what is new. If true realtime is ever needed, the tables are already
in Supabase, so Supabase Realtime can be switched on without a schema change.
"""

from __future__ import annotations

import logging

from flask import Blueprint, g, jsonify, request

import auth
import db
import sessions
from extensions import limiter

logger = logging.getLogger(__name__)

chat_bp = Blueprint("chat", __name__, url_prefix="/api/chat")

# A chat body is a support message, not a document: bounded so a hostile or
# buggy client cannot write unbounded rows, and well above anything a person
# would legitimately type.
MAX_MESSAGE_LENGTH = 4000
MAX_SUBJECT_LENGTH = 200
# How many messages one poll returns. Threads grow one message at a time, so
# this only bounds the very first full load.
MESSAGES_PAGE_SIZE = 200
# How far back the conversation list reaches. The cap keeps the preview lookup
# bounded even when a user has a long support history.
CONVERSATIONS_LIMIT = 50
PREVIEW_LENGTH = 200
MAX_OPEN_CONVERSATIONS_PER_USER = 3
MAX_CONSECUTIVE_USER_MESSAGES = 3


def _clean_body(value) -> str:
    return str(value or "").strip()


def _message_payload(row: dict) -> dict:
    return {
        "id": row["id"],
        "conversation_id": str(row["conversation_id"]),
        "sender": row.get("sender"),
        "body": row.get("body"),
        "created_at": row.get("created_at"),
        "read_at": row.get("read_at"),
    }


def last_messages_by_conversation(supabase, conversation_ids) -> dict:
    """``{conversation_id: newest message row}`` for the given conversations.

    Shared with the admin inbox in `routes_admin.py`, which needs the same
    preview per listed conversation.
    """
    if not conversation_ids:
        return {}
    result = (
        supabase.table("chat_messages")
        .select("*")
        .in_("conversation_id", [str(i) for i in conversation_ids])
        .order("id", desc=True)
        .execute()
    )
    latest: dict = {}
    for row in result.data or []:
        key = str(row["conversation_id"])
        if key not in latest:
            latest[key] = row
    return latest


def _conversation_payload(row: dict, last_message: dict | None = None) -> dict:
    payload = {
        "id": str(row["id"]),
        "subject": row.get("subject"),
        "status": row.get("status"),
        "last_message_at": row.get("last_message_at"),
        "unread_user_count": int(row.get("unread_user_count") or 0),
        "created_at": row.get("created_at"),
    }
    if last_message is not None:
        payload["last_message"] = {
            "sender": last_message.get("sender"),
            "preview": str(last_message.get("body") or "")[:PREVIEW_LENGTH],
            "created_at": last_message.get("created_at"),
        }
    else:
        payload["last_message"] = None
    return payload


def _owned_conversation(supabase, conversation_id):
    """The caller's conversation row, or ``None`` (which the routes turn into a 404)."""
    result = (
        supabase.table("chat_conversations")
        .select("*")
        .eq("id", conversation_id)
        .eq("user_id", g.user["id"])
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def _open_conversations(supabase) -> list[dict]:
    """At most the configured cap; enough to enforce the user-side open-thread limit."""
    result = (
        supabase.table("chat_conversations")
        .select("id")
        .eq("user_id", g.user["id"])
        .eq("status", "open")
        .limit(MAX_OPEN_CONVERSATIONS_PER_USER)
        .execute()
    )
    return list(result.data or [])


def _consecutive_user_message_count(supabase, conversation_id) -> int:
    """Count the latest uninterrupted run of user messages in a thread.

    Fetching only the cap newest messages is sufficient: once an admin message
    is found the run has ended, and if all fetched messages are from the user
    the caller is already at (or over) the send limit.
    """
    result = (
        supabase.table("chat_messages")
        .select("sender")
        .eq("conversation_id", str(conversation_id))
        .order("id", desc=True)
        .limit(MAX_CONSECUTIVE_USER_MESSAGES)
        .execute()
    )
    count = 0
    for message in result.data or []:
        if message.get("sender") != "user":
            break
        count += 1
    return count


def _can_send_user_message(supabase, conversation_id) -> bool:
    return _consecutive_user_message_count(supabase, conversation_id) < MAX_CONSECUTIVE_USER_MESSAGES


def _insert_message(supabase, conversation: dict, body: str) -> dict:
    """
    Append a user message and move the conversation's polling metadata.

    The caller must check the consecutive-message limit before invoking this
    helper. The unread counters are read-modify-write, which can theoretically lose an
    increment if both sides post in the same instant; at chat rates that is
    cosmetic (the badge is one off until the next message), and the
    alternative is a stored procedure for a counter the message table can
    always rebuild.
    """
    inserted = (
        supabase.table("chat_messages")
        .insert(
            {
                "conversation_id": str(conversation["id"]),
                "sender": "user",
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
            "unread_admin_count": int(conversation.get("unread_admin_count") or 0) + 1,
        }
    ).eq("id", str(conversation["id"])).execute()

    conversation["last_message_at"] = stamp
    conversation["unread_admin_count"] = int(conversation.get("unread_admin_count") or 0) + 1
    return message


@chat_bp.route("/conversations", methods=["POST"])
@limiter.limit("10 per minute")
@auth.require_session
def create_conversation():
    """
    Open a conversation with its first message.

    A user may keep at most three open support threads. Additional messages in
    an existing thread use the thread-specific endpoint, which separately
    limits the caller to three consecutive messages until an administrator
    responds.
    """
    try:
        supabase = db.require_client()
        data = request.get_json(silent=True) or {}

        body = _clean_body(data.get("body"))
        if not body:
            return jsonify({"error": "body is required"}), 400
        if len(body) > MAX_MESSAGE_LENGTH:
            return jsonify({"error": f"body must be at most {MAX_MESSAGE_LENGTH} characters"}), 400

        subject = _clean_body(data.get("subject"))[:MAX_SUBJECT_LENGTH] or None

        if len(_open_conversations(supabase)) >= MAX_OPEN_CONVERSATIONS_PER_USER:
            return jsonify(
                {
                    "error": (
                        f"You can have at most {MAX_OPEN_CONVERSATIONS_PER_USER} open conversations. "
                        "Wait for an administrator to close one before starting another."
                    )
                }
            ), 429

        inserted = (
            supabase.table("chat_conversations")
            .insert(
                {
                    "user_id": g.user["id"],
                    "subject": subject,
                    "last_message_at": sessions.now_iso(),
                }
            )
            .execute()
        )
        conversation = inserted.data[0]
        message = _insert_message(supabase, conversation, body)
        return jsonify(
            {
                "conversation": _conversation_payload(conversation),
                "message": _message_payload(message),
                "appended": False,
            }
        ), 201

    except Exception as exc:
        logger.error("Chat create conversation error for %s: %s", g.user["id"], exc)
        return jsonify({"error": "Failed to create conversation"}), 500


@chat_bp.route("/conversations", methods=["GET"])
@auth.require_session
def list_conversations():
    """The caller's conversations, newest activity first, with a preview of the last message."""
    try:
        supabase = db.require_client()
        result = (
            supabase.table("chat_conversations")
            .select("*")
            .eq("user_id", g.user["id"])
            .order("last_message_at", desc=True, nullsfirst=False)
            .order("created_at", desc=True)
            .limit(CONVERSATIONS_LIMIT)
            .execute()
        )
        rows = list(result.data or [])
        previews = last_messages_by_conversation(supabase, [row["id"] for row in rows])

        return jsonify(
            {
                "conversations": [
                    _conversation_payload(row, previews.get(str(row["id"])))
                    for row in rows
                ]
            }
        )

    except Exception as exc:
        logger.error("Chat list conversations error for %s: %s", g.user["id"], exc)
        return jsonify({"error": "Failed to fetch conversations"}), 500


@chat_bp.route("/conversations/<conversation_id>/messages", methods=["GET"])
@auth.require_session
def list_messages(conversation_id):
    """
    The thread, oldest first. `?after=<message_id>` returns only newer
    messages, which is what the polling widget passes on every tick after the
    first full load.
    """
    try:
        supabase = db.require_client()
        conversation = _owned_conversation(supabase, conversation_id)
        if not conversation:
            return jsonify({"error": "Conversation not found"}), 404

        after_raw = request.args.get("after")
        after = 0
        if after_raw is not None:
            try:
                after = max(0, int(after_raw))
            except (TypeError, ValueError):
                return jsonify({"error": "after must be an integer message id"}), 400

        query = (
            supabase.table("chat_messages")
            .select("*")
            .eq("conversation_id", str(conversation["id"]))
        )
        if after:
            query = query.gt("id", after)
        result = query.order("id").limit(MESSAGES_PAGE_SIZE).execute()

        return jsonify(
            {
                "conversation": _conversation_payload(conversation),
                "messages": [_message_payload(row) for row in (result.data or [])],
            }
        )

    except Exception as exc:
        logger.error("Chat list messages error for %s: %s", g.user["id"], exc)
        return jsonify({"error": "Failed to fetch messages"}), 500


@chat_bp.route("/conversations/<conversation_id>/messages", methods=["POST"])
@limiter.limit("30 per minute")
@auth.require_session
def post_message(conversation_id):
    """Append a message. Only while the conversation is open — a closed thread is reopened by the operator, not by writing into it."""
    try:
        supabase = db.require_client()
        conversation = _owned_conversation(supabase, conversation_id)
        if not conversation:
            return jsonify({"error": "Conversation not found"}), 404
        if conversation.get("status") != "open":
            return jsonify({"error": "Conversation is closed"}), 409

        data = request.get_json(silent=True) or {}
        body = _clean_body(data.get("body"))
        if not body:
            return jsonify({"error": "body is required"}), 400
        if len(body) > MAX_MESSAGE_LENGTH:
            return jsonify({"error": f"body must be at most {MAX_MESSAGE_LENGTH} characters"}), 400

        if not _can_send_user_message(supabase, conversation["id"]):
            return jsonify(
                {
                    "error": (
                        f"You can send at most {MAX_CONSECUTIVE_USER_MESSAGES} consecutive messages. "
                        "Wait for an administrator to reply before sending another."
                    )
                }
            ), 429

        message = _insert_message(supabase, conversation, body)
        return jsonify(
            {
                "conversation": _conversation_payload(conversation),
                "message": _message_payload(message),
            }
        ), 201

    except Exception as exc:
        logger.error("Chat post message error for %s: %s", g.user["id"], exc)
        return jsonify({"error": "Failed to send message"}), 500


@chat_bp.route("/conversations/<conversation_id>/read", methods=["POST"])
@limiter.limit("60 per minute")
@auth.require_session
def mark_read(conversation_id):
    """
    Acknowledge the operator's messages: stamp `read_at` on every unread admin
    message and zero the caller's unread counter.
    """
    try:
        supabase = db.require_client()
        conversation = _owned_conversation(supabase, conversation_id)
        if not conversation:
            return jsonify({"error": "Conversation not found"}), 404

        marked = (
            supabase.table("chat_messages")
            .update({"read_at": sessions.now_iso()})
            .eq("conversation_id", str(conversation["id"]))
            .eq("sender", "admin")
            .is_("read_at", "null")
            .execute()
        )
        supabase.table("chat_conversations").update(
            {"unread_user_count": 0}
        ).eq("id", str(conversation["id"])).execute()

        return jsonify({"marked_read": len(marked.data or [])})

    except Exception as exc:
        logger.error("Chat mark read error for %s: %s", g.user["id"], exc)
        return jsonify({"error": "Failed to mark messages read"}), 500

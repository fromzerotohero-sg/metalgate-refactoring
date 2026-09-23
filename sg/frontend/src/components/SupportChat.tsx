"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type ChatConversation, type ChatMessage } from "@/src/lib/api";
import { useLocale, useT } from "@/src/lib/i18n";

const POLL_INTERVAL_MS = 10_000;

function newestMessageId(messages: ChatMessage[]) {
  return messages.reduce((latest, message) => Math.max(latest, message.id), 0);
}

export function SupportChat() {
  const t = useT();
  const { locale } = useLocale();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [startingNew, setStartingNew] = useState(false);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const threadEnd = useRef<HTMLDivElement>(null);

  const formatTime = useCallback((value?: string | null) => {
    if (!value) return "";
    return new Date(value).toLocaleString(locale === "en" ? "en-GB" : locale === "es" ? "es-ES" : "it-IT", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
    });
  }, [locale]);

  const loadThread = useCallback(async (selected: ChatConversation, after?: number) => {
    const result = await api.chatMessages(selected.id, after);
    setConversation(result.conversation);
    setMessages((current) => {
      if (!after) return result.messages;
      const known = new Set(current.map((message) => message.id));
      return [...current, ...result.messages.filter((message) => !known.has(message.id))];
    });
    if (!after) void api.markChatRead(selected.id).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.chatConversations();
      const selected = result.conversations.find((item) => item.status === "open") ?? result.conversations[0] ?? null;
      setConversations(result.conversations);
      setStartingNew(false);
      setConversation(selected);
      setMessages([]);
      if (selected) await loadThread(selected);
    } catch (caught) {
      const apiError = caught as ApiError;
      if (apiError.status === 401) {
        window.location.href = "/login?return_to=/account/support";
        return;
      }
      setError(apiError.message || t("support.loadError"));
    } finally {
      setLoading(false);
    }
  }, [loadThread, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!conversation) return;
    const timer = window.setInterval(() => {
      const after = newestMessageId(messages);
      void loadThread(conversation, after || undefined).then(() => {
        void api.markChatRead(conversation.id).catch(() => {});
      }).catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [conversation, loadThread, messages]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length]);

  const openConversationCount = conversations.filter((item) => item.status === "open").length;
  const canStartAnother = openConversationCount < 3;
  const composingNew = startingNew || !conversation || (conversation.status === "closed" && canStartAnother);
  const canReply = !composingNew && conversation?.status === "open";
  const submitLabel = canReply ? t("support.send") : t("support.start");

  async function selectConversation(selected: ChatConversation) {
    setStartingNew(false);
    setConversation(selected);
    setMessages([]);
    setError("");
    try {
      await loadThread(selected);
    } catch (caught) {
      const apiError = caught as ApiError;
      setError(apiError.message || t("support.loadError"));
    }
  }

  function startConversation() {
    setStartingNew(true);
    setConversation(null);
    setMessages([]);
    setError("");
    setSubject("");
    setBody("");
  }
  const statusText = useMemo(() => conversation?.status === "closed" ? t("support.closed") : t("support.open"), [conversation?.status, t]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = body.trim();
    if (!message || sending) return;

    setSending(true);
    setError("");
    try {
      if (canReply && conversation) {
        const result = await api.sendChatMessage(conversation.id, message);
        setConversation(result.conversation);
        setMessages((current) => [...current, result.message]);
      } else {
        const result = await api.createChatConversation(message, subject.trim() || undefined);
        setConversation(result.conversation);
        setConversations((current) => [result.conversation, ...current]);
        setMessages([result.message]);
        setStartingNew(false);
        setSubject("");
      }
      setBody("");
    } catch (caught) {
      const apiError = caught as ApiError;
      setError(apiError.message || t("support.sendError"));
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="support-loading">{t("common.loading")}</div>;

  return (
    <section className="support-chat" aria-label={t("support.title")}>
      <header className="support-chat-header">
        <div>
          <p className="eyebrow dark">{t("support.eyebrow")}</p>
          <h2>{t("support.title")}</h2>
          <p>{t("support.intro")}</p>
        </div>
        {conversation && <span className={`support-status ${conversation.status}`}>{statusText}</span>}
      </header>

      {conversations.length > 0 && (
        <div className="support-conversations" aria-label={t("support.conversations")}>
          {conversations.map((item) => (
            <button
              type="button"
              className={item.id === conversation?.id && !startingNew ? "selected" : ""}
              key={item.id}
              onClick={() => void selectConversation(item)}
            >
              <span>{item.subject || t("support.untitled")}</span>
              <small>{item.status === "open" ? t("support.open") : t("support.closed")}</small>
            </button>
          ))}
          {canStartAnother && <button type="button" className={startingNew ? "selected new" : "new"} onClick={startConversation}>{t("support.newConversation")}</button>}
        </div>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}

      {conversation?.subject && !startingNew && <p className="support-subject"><strong>{t("support.subject")}:</strong> {conversation.subject}</p>}

      <div className="support-thread" aria-live="polite">
        {!conversation && <p className="support-empty">{t("support.empty")}</p>}
        {messages.map((message) => (
          <div className={`support-message ${message.sender}`} key={message.id}>
            <div className="support-message-body">{message.body}</div>
            <time>{message.sender === "admin" ? t("support.admin") : t("support.you")} · {formatTime(message.created_at)}</time>
          </div>
        ))}
        <div ref={threadEnd} />
      </div>

      {conversation?.status === "closed" && <p className="support-closed-note">{canStartAnother ? t("support.closedNote") : t("support.openLimitReached")}</p>}

      {(canReply || composingNew) && (
        <form className="support-composer" onSubmit={send}>
          {composingNew && (
            <label className="field">
              <span className="field-label">{t("support.subject")}</span>
              <div className="field-input"><input value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} placeholder={t("support.subjectPlaceholder")} /></div>
            </label>
          )}
          <label className="field">
            <span className="field-label">{t("support.message")}</span>
            <div className="field-input"><textarea value={body} maxLength={4000} required rows={4} onChange={(event) => setBody(event.target.value)} placeholder={t("support.messagePlaceholder")} /></div>
          </label>
          <div className="support-composer-footer">
            <small>{t("support.replyTime")}</small>
            <button className="btn btn-primary" disabled={sending}>{sending ? t("support.sending") : submitLabel}</button>
          </div>
        </form>
      )}
    </section>
  );
}

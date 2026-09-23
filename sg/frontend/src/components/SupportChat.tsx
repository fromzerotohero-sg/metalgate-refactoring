"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type ChatConversation, type ChatMessage } from "@/src/lib/api";
import { useLocale, useT } from "@/src/lib/i18n";

const POLL_INTERVAL_MS = 10_000;
const MAX_OPEN_CONVERSATIONS = 3;
type SupportView = "list" | "thread" | "new";

function newestMessageId(messages: ChatMessage[]) {
  return messages.reduce((latest, message) => Math.max(latest, message.id), 0);
}

export function SupportChat() {
  const t = useT();
  const { locale } = useLocale();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [view, setView] = useState<SupportView>("list");
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
    setConversations((current) => current.map((item) => item.id === result.conversation.id ? { ...item, ...result.conversation } : item));
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
      setConversations(result.conversations);
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
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (view !== "thread" || !conversation) return;
    const timer = window.setInterval(() => {
      const after = newestMessageId(messages);
      void loadThread(conversation, after || undefined).then(() => {
        void api.markChatRead(conversation.id).catch(() => {});
      }).catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [conversation, loadThread, messages, view]);

  useEffect(() => {
    if (view === "thread") threadEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, view]);

  const openConversationCount = conversations.filter((item) => item.status === "open").length;
  const canStartConversation = openConversationCount < MAX_OPEN_CONVERSATIONS;
  const canReply = view === "thread" && conversation?.status === "open";
  const statusText = useMemo(
    () => conversation?.status === "closed" ? t("support.closed") : t("support.open"),
    [conversation?.status, t]
  );

  async function openConversation(selected: ChatConversation) {
    setLoading(true);
    setError("");
    setConversation(selected);
    setMessages([]);
    try {
      await loadThread(selected);
      setView("thread");
    } catch (caught) {
      const apiError = caught as ApiError;
      setError(apiError.message || t("support.loadError"));
    } finally {
      setLoading(false);
    }
  }

  function startConversation() {
    setConversation(null);
    setMessages([]);
    setSubject("");
    setBody("");
    setError("");
    setView("new");
  }

  function returnToList() {
    setError("");
    setView("list");
    void load();
  }

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
        setConversations((current) => current.map((item) => item.id === result.conversation.id ? { ...item, ...result.conversation } : item));
        setMessages((current) => [...current, result.message]);
      } else {
        const result = await api.createChatConversation(message, subject.trim() || undefined);
        setConversation(result.conversation);
        setConversations((current) => [result.conversation, ...current]);
        setMessages([result.message]);
        setSubject("");
        setView("thread");
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

  if (view === "list") {
    return (
      <section className="support-chat" aria-label={t("support.title")}>
        <header className="support-chat-header">
          <div>
            <p className="eyebrow dark">{t("support.eyebrow")}</p>
            <h2>{t("support.listTitle")}</h2>
            <p>{t("support.listIntro")}</p>
          </div>
          {canStartConversation && <button className="btn btn-primary" onClick={startConversation}>{t("support.newConversation")}</button>}
        </header>
        {error && <div className="form-error" role="alert">{error}</div>}
        {conversations.length ? (
          <div className="support-chat-list">
            {conversations.map((item) => (
              <button type="button" className="support-chat-list-item" key={item.id} onClick={() => void openConversation(item)}>
                <span className={`support-status ${item.status}`}>{item.status === "open" ? t("support.open") : t("support.closed")}</span>
                <strong>{item.subject || t("support.untitled")}</strong>
                <span className="support-chat-list-preview">{item.last_message?.preview || t("support.noMessages")}</span>
                <small>{formatTime(item.last_message_at || item.created_at)}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="support-empty support-empty-card"><p>{t("support.empty")}</p><button className="btn btn-primary" onClick={startConversation}>{t("support.start")}</button></div>
        )}
        {!canStartConversation && <p className="support-closed-note">{t("support.openLimitReached")}</p>}
      </section>
    );
  }

  const isNew = view === "new";
  return (
    <section className="support-chat" aria-label={t("support.title")}>
      <button type="button" className="back-link" onClick={returnToList}>← {t("support.backToChats")}</button>
      <header className="support-chat-header">
        <div>
          <p className="eyebrow dark">{t("support.eyebrow")}</p>
          <h2>{isNew ? t("support.newTitle") : (conversation?.subject || t("support.untitled"))}</h2>
          <p>{isNew ? t("support.newIntro") : t("support.intro")}</p>
        </div>
        {!isNew && conversation && <span className={`support-status ${conversation.status}`}>{statusText}</span>}
      </header>
      {error && <div className="form-error" role="alert">{error}</div>}

      {!isNew && conversation?.subject && <p className="support-subject"><strong>{t("support.subject")}:</strong> {conversation.subject}</p>}
      {!isNew && (
        <div className="support-thread" aria-live="polite">
          {messages.map((message) => (
            <div className={`support-message ${message.sender}`} key={message.id}>
              <div className="support-message-body">{message.body}</div>
              <time>{message.sender === "admin" ? t("support.admin") : t("support.you")} · {formatTime(message.created_at)}</time>
              {message.sender === "user" && <p className="support-wait-note">{t("support.waitForAdmin")}</p>}
            </div>
          ))}
          <div ref={threadEnd} />
        </div>
      )}
      {!isNew && conversation?.status === "closed" && <p className="support-closed-note">{t("support.closedThread")}</p>}

      {(isNew || canReply) && (
        <form className="support-composer" onSubmit={send}>
          {isNew && (
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
            <button className="btn btn-primary" disabled={sending}>{sending ? t("support.sending") : (isNew ? t("support.start") : t("support.send"))}</button>
          </div>
        </form>
      )}
    </section>
  );
}

"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  AdminChatApiError,
  adminChatApi,
  type ChatConversationStatus,
  type ChatConversationSummary,
  type ChatThread
} from "@/src/lib/admin-chat-api";

const POLL_INTERVAL_MS = 12_000;

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  }).format(new Date(value));
}

function displayName(conversation: ChatConversationSummary) {
  return conversation.user.username || conversation.user.email || "Utente";
}

export default function ChatInbox() {
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [selected, setSelected] = useState<ChatConversationSummary | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [reply, setReply] = useState("");
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [error, setError] = useState("");
  const threadEnd = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async () => {
    setLoadingInbox(true);
    try {
      const result = await adminChatApi.conversations({ status, search: search.trim() || undefined, per_page: 50 });
      setConversations(result.conversations);
    } catch (caught) {
      const apiError = caught as AdminChatApiError;
      setError(apiError.message || "Non è stato possibile caricare le chat.");
    } finally {
      setLoadingInbox(false);
    }
  }, [search, status]);

  const loadThread = useCallback(async (conversation: ChatConversationSummary, quiet = false) => {
    if (!quiet) setLoadingThread(true);
    try {
      const result = await adminChatApi.thread(conversation.id);
      setThread(result);
      setSelected(conversation);
    } catch (caught) {
      const apiError = caught as AdminChatApiError;
      setError(apiError.message || "Non è stato possibile caricare la conversazione.");
    } finally {
      if (!quiet) setLoadingThread(false);
    }
  }, []);

  useEffect(() => { void loadInbox(); }, [loadInbox]);

  useEffect(() => {
    if (!selected) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadThread(selected, true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadThread, selected]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [thread?.messages.length]);

  async function selectConversation(conversation: ChatConversationSummary) {
    setError("");
    setReply("");
    setThread(null);
    await loadThread(conversation);
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selected || !reply.trim() || sending) return;

    setSending(true);
    setError("");
    try {
      const result = await adminChatApi.reply(selected.id, reply.trim());
      setThread((current) => current ? { ...current, messages: [...current.messages, result.message] } : current);
      setReply("");
      await loadInbox();
    } catch (caught) {
      const apiError = caught as AdminChatApiError;
      setError(apiError.message || "Non è stato possibile inviare la risposta.");
    } finally {
      setSending(false);
    }
  }

  async function changeConversationStatus(nextStatus: ChatConversationStatus) {
    if (!selected || changingStatus) return;
    setChangingStatus(true);
    setError("");
    try {
      const result = nextStatus === "closed"
        ? await adminChatApi.close(selected.id)
        : await adminChatApi.reopen(selected.id);
      if (result.changed) {
        setSelected((current) => current ? { ...current, status: nextStatus } : current);
        setThread((current) => current ? { ...current, conversation: { ...current.conversation, status: nextStatus } } : current);
      }
      await loadInbox();
    } catch (caught) {
      const apiError = caught as AdminChatApiError;
      setError(apiError.message || "Non è stato possibile aggiornare lo stato della chat.");
    } finally {
      setChangingStatus(false);
    }
  }

  return (
    <section className="admin-page admin-chat-page">
      <header className="admin-chat-hero">
        <div>
          <p className="admin-chat-eyebrow">ASSISTENZA</p>
          <h1 className="admin-title">Chat con gli utenti</h1>
          <p>Leggi le richieste, rispondi al cliente e mantieni ogni conversazione ordinata.</p>
        </div>
        <div className="admin-chat-summary"><strong>{conversations.filter((item) => item.status === "open").length}</strong><span>chat aperte</span></div>
      </header>

      {error && <p className="admin-error" role="alert">{error}</p>}

      <div className={`admin-chat-workspace${selected ? " has-thread" : ""}`}>
        <aside className="admin-chat-inbox" aria-label="Elenco chat">
          <div className="admin-chat-filters">
            <span className="field-input admin-search"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca utente o email…" /></span>
            <select className="admin-select" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Stato chat">
              <option value="open">Aperte</option>
              <option value="closed">Chiuse</option>
              <option value="all">Tutte</option>
            </select>
          </div>

          <div className="admin-chat-list">
            {loadingInbox && <p className="admin-loading">Caricamento chat…</p>}
            {!loadingInbox && !conversations.length && <p className="admin-empty">Nessuna chat trovata con questi filtri.</p>}
            {conversations.map((conversation) => (
              <button
                type="button"
                className={`admin-chat-list-item${selected?.id === conversation.id ? " selected" : ""}`}
                key={conversation.id}
                onClick={() => void selectConversation(conversation)}
              >
                <span className={`admin-chat-status ${conversation.status}`}>{conversation.status === "open" ? "Aperta" : "Chiusa"}</span>
                {conversation.unread_admin_count > 0 && <span className="admin-chat-unread">{conversation.unread_admin_count > 99 ? "99+" : conversation.unread_admin_count}</span>}
                <strong>{displayName(conversation)}</strong>
                <small>{conversation.user.email}</small>
                <span className="admin-chat-preview">{conversation.last_message?.preview || "Nessun messaggio"}</span>
                <time>{formatDate(conversation.last_message_at || conversation.created_at)}</time>
              </button>
            ))}
          </div>
        </aside>

        <section className="admin-chat-thread" aria-live="polite">
          {!selected && (
            <div className="admin-chat-thread-empty">
              <span aria-hidden>✦</span>
              <h2>Seleziona una chat</h2>
              <p>Apri una conversazione dall&apos;elenco per leggere i messaggi e rispondere all&apos;utente.</p>
            </div>
          )}
          {selected && loadingThread && <p className="admin-loading">Caricamento conversazione…</p>}
          {selected && !loadingThread && thread && (
            <>
              <header className="admin-chat-thread-header">
                <div>
                  <p className="admin-chat-eyebrow">{thread.conversation.status === "open" ? "CONVERSAZIONE APERTA" : "CONVERSAZIONE CHIUSA"}</p>
                  <h2>{thread.conversation.subject || "Richiesta di assistenza"}</h2>
                  <p>{thread.user?.username || "Utente"} · {thread.user?.email || "—"}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-outline admin-chat-status-button"
                  onClick={() => void changeConversationStatus(thread.conversation.status === "open" ? "closed" : "open")}
                  disabled={changingStatus}
                >
                  {changingStatus ? "Aggiornamento…" : thread.conversation.status === "open" ? "Chiudi chat" : "Riapri chat"}
                </button>
              </header>

              <div className="admin-chat-messages">
                {thread.messages.map((message) => (
                  <article className={`admin-chat-message ${message.sender}`} key={message.id}>
                    <div className="admin-chat-message-body">{message.body}</div>
                    <time>{message.sender === "admin" ? "Tu" : (thread.user?.username || "Utente")} · {formatDate(message.created_at)}</time>
                  </article>
                ))}
                <div ref={threadEnd} />
              </div>

              {thread.conversation.status === "open" ? (
                <form className="admin-chat-composer" onSubmit={sendReply}>
                  <label className="field">
                    <span className="field-label">Risposta all&apos;utente</span>
                    <span className="field-input"><textarea value={reply} maxLength={4000} rows={4} required placeholder="Scrivi una risposta chiara e utile…" onChange={(event) => setReply(event.target.value)} /></span>
                  </label>
                  <div className="admin-chat-composer-footer"><small>La risposta verrà inviata nella chat dell&apos;utente.</small><button className="btn btn-primary" disabled={sending}>{sending ? "Invio…" : "Invia risposta"}</button></div>
                </form>
              ) : (
                <p className="admin-chat-closed-note">Riapri la chat per inviare una nuova risposta.</p>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}

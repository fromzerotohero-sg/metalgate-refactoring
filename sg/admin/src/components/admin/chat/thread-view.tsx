"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import clsx from "clsx";
import Badge from "@/src/components/admin/badge";
import type { ChatMessage, ChatThread } from "@/src/lib/admin-chat-api";
import { formatTime } from "./time";

export const MAX_MESSAGE_LENGTH = 4000;

export type DisplayMessage = ChatMessage & { pending?: boolean };

export default function ThreadView({
  thread,
  loading,
  error,
  messages,
  draft,
  onDraftChange,
  onSend,
  sending,
  statusUpdating,
  onClose,
  onReopen,
  onBack
}: {
  thread: ChatThread | null;
  loading: boolean;
  error: string | null;
  messages: DisplayMessage[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  statusUpdating: boolean;
  onClose: () => void;
  onReopen: () => void;
  onBack: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastCountRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length > lastCountRef.current;
    lastCountRef.current = messages.length;
    if (grew && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSend();
    }
  };

  if (loading && !thread) return <p className="admin-loading p-6">Caricamento conversazione…</p>;
  if (error && !thread) return <p className="admin-error m-6">{error}</p>;
  if (!thread) return null;

  const closed = thread.conversation.status === "closed";
  const remaining = MAX_MESSAGE_LENGTH - draft.length;
  const canSend = !closed && !sending && draft.trim().length > 0 && draft.length <= MAX_MESSAGE_LENGTH;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Torna alla lista"
          className="rounded-lg px-2 py-1 text-lg font-bold text-muted hover:bg-surface hover:text-ink md:hidden"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/utenti/${thread.user?.id ?? ""}`} className="block truncate text-sm font-bold text-brand hover:underline">
            {thread.user?.username || thread.user?.email || "Utente"}
          </Link>
          {thread.user?.email && <span className="block truncate text-xs text-muted">{thread.user.email}</span>}
        </div>
        <Badge tone={closed ? "neutral" : "ok"}>{closed ? "Chiusa" : "Aperta"}</Badge>
        {closed ? (
          <button type="button" className="btn btn-outline px-4! py-2! text-[13px]!" disabled={statusUpdating} onClick={onReopen}>
            Riapri
          </button>
        ) : (
          <button type="button" className="btn btn-outline px-4! py-2! text-[13px]!" disabled={statusUpdating} onClick={onClose}>
            Chiudi
          </button>
        )}
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && <p className="admin-empty py-6 text-center">Nessun messaggio in questa conversazione.</p>}
        <ul className="flex flex-col gap-3">
          {messages.map((message) => {
            const own = message.sender === "admin";
            return (
              <li key={message.id} className={clsx("flex", own ? "justify-end" : "justify-start")}>
                <div
                  className={clsx(
                    "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    own ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-surface text-ink",
                    message.pending && "opacity-60"
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  <p className={clsx("mt-1 text-right text-[11px]", own ? "text-white/70" : "text-muted")}>
                    {formatTime(message.created_at)}
                    {message.pending && " · invio…"}
                    {own && !message.pending && message.read_at && " · letto"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line p-3">
        {closed ? (
          <p className="rounded-xl bg-surface px-4 py-3 text-center text-sm font-semibold text-muted">
            Conversazione chiusa — riapri per rispondere.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              className="field-input min-h-[84px] w-full resize-y p-3! text-sm outline-none"
              placeholder="Scrivi una risposta… (Ctrl+Invio per inviare)"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onComposerKeyDown}
              maxLength={MAX_MESSAGE_LENGTH + 100}
            />
            <div className="flex items-center justify-between gap-3">
              <span className={clsx("text-xs font-semibold", remaining < 0 ? "text-red-600" : "text-muted")}>
                {draft.length}/{MAX_MESSAGE_LENGTH}
              </span>
              <button type="button" className="btn btn-primary px-5! py-2.5! text-sm!" disabled={!canSend} onClick={onSend}>
                {sending ? "Invio…" : "Invia"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

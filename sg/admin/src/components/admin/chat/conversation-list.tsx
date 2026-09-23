"use client";

import clsx from "clsx";
import Badge from "@/src/components/admin/badge";
import type { ChatConversationSummary } from "@/src/lib/admin-chat-api";
import { formatRelativeTime } from "./time";

const STATUS_OPTIONS = [
  { value: "open", label: "Aperte" },
  { value: "closed", label: "Chiuse" },
  { value: "all", label: "Tutte" }
];

function previewText(conversation: ChatConversationSummary): string {
  if (conversation.subject) return conversation.subject;
  const last = conversation.last_message;
  if (!last) return "Nessun messaggio";
  return `${last.sender === "admin" ? "Tu: " : ""}${last.preview}`;
}

export default function ConversationList({
  status,
  onStatusChange,
  searchInput,
  onSearchChange,
  conversations,
  total,
  loading,
  error,
  selectedId,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore
}: {
  status: string;
  onStatusChange: (value: string) => void;
  searchInput: string;
  onSearchChange: (value: string) => void;
  conversations: ChatConversationSummary[];
  total: number;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <span className="field-input">
          <input
            type="search"
            placeholder="Cerca per username o email…"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </span>
        <div className="flex gap-1 rounded-xl bg-surface p-1">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onStatusChange(option.value)}
              className={clsx(
                "flex-1 rounded-lg px-2 py-1.5 text-[13px] font-bold transition-colors",
                status === option.value ? "bg-white text-brand shadow-sm" : "text-muted hover:text-ink"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <p className="admin-error m-3">{error}</p>}
        {!error && loading && <p className="admin-loading px-4">Caricamento…</p>}
        {!error && !loading && conversations.length === 0 && (
          <p className="admin-empty px-4 py-6 text-center">
            {searchInput ? "Nessuna conversazione corrisponde alla ricerca." : "Nessuna conversazione."}
          </p>
        )}
        <ul>
          {conversations.map((conversation) => {
            const active = conversation.id === selectedId;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={clsx(
                    "flex w-full flex-col gap-1 border-b border-line px-4 py-3 text-left transition-colors",
                    active ? "bg-surface" : "hover:bg-surface/60"
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold text-ink">
                      {conversation.user.username || conversation.user.email || "Utente"}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {conversation.unread_admin_count > 0 && <Badge tone="info">{conversation.unread_admin_count}</Badge>}
                      <span className="text-xs font-semibold text-muted">
                        {formatRelativeTime(conversation.last_message_at)}
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] text-muted">{previewText(conversation)}</span>
                    {conversation.status === "closed" && (
                      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted">Chiusa</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {hasMore && (
          <div className="p-3 text-center">
            <button type="button" className="btn btn-outline px-4! py-2! text-[13px]!" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? "Caricamento…" : `Carica altre (${conversations.length} di ${total})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

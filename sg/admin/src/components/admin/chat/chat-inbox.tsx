"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  AdminChatApiError,
  adminChatApi,
  type ChatConversationSummary,
  type ChatConversationsPage,
  type ChatThread
} from "@/src/lib/admin-chat-api";
import { useToast } from "@/src/components/admin/toast";
import ConversationList from "./conversation-list";
import ThreadView, { MAX_MESSAGE_LENGTH, type DisplayMessage } from "./thread-view";

const PAGE_SIZE = 30;
const LIST_POLL_MS = 15000;
const THREAD_POLL_MS = 5000;

export default function ChatInbox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const status = searchParams.get("status") ?? "open";
  const search = searchParams.get("search") ?? "";
  const selectedId = searchParams.get("c");

  const [searchInput, setSearchInput] = useState(search);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedPages, setLoadedPages] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [thread, setThread] = useState<ChatThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [pending, setPending] = useState<DisplayMessage[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateQuery = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.replace(`/chat${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, searchParams]
  );

  // La lista si accumula pagina per pagina ("Carica altre"): `replace` riparte
  // da zero, `append` aggiunge la pagina successiva, `refresh` (polling) rifà
  // solo la prima pagina — le conversazioni con attività nuova risalgono in
  // cima e il resto resta com'è.
  const loadList = useCallback(
    async (page: number, mode: "replace" | "append" | "refresh"): Promise<ChatConversationsPage | null> => {
      try {
        const statusFilter = status === "closed" || status === "all" ? status : "open";
        const data = await adminChatApi.conversations({ status: statusFilter, search, page, per_page: PAGE_SIZE });
        if (mode === "append") {
          setConversations((current) => {
            const seen = new Set(current.map((c) => c.id));
            return [...current, ...data.conversations.filter((c) => !seen.has(c.id))];
          });
        } else if (mode === "refresh") {
          setConversations((current) => {
            const freshIds = new Set(data.conversations.map((c) => c.id));
            return [...data.conversations, ...current.filter((c) => !freshIds.has(c.id))];
          });
        } else {
          setConversations(data.conversations);
        }
        setTotal(data.total);
        setListError(null);
        return data;
      } catch (err) {
        // I fallimenti del polling non cancellano i dati già a schermo.
        if (mode !== "refresh") setListError(err instanceof Error ? err.message : "Errore nel caricamento delle conversazioni");
        return null;
      }
    },
    [status, search]
  );

  useEffect(() => {
    setListLoading(true);
    setListError(null);
    setLoadedPages(0);
    loadList(1, "replace").then((data) => {
      if (data) setLoadedPages(1);
      setListLoading(false);
    });
  }, [loadList]);

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) loadList(1, "refresh");
    };
    const id = setInterval(tick, LIST_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [loadList]);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    if (!selectedId) {
      setThread(null);
      setThreadError(null);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    setThreadError(null);
    setDraft("");
    setPending([]);
    adminChatApi
      .thread(selectedId)
      .then((data) => {
        if (cancelled) return;
        setThread(data);
        // Aprire il thread segna i messaggi come letti lato server: azzera
        // subito anche il badge in lista, senza aspettare il prossimo poll.
        setConversations((current) => current.map((c) => (c.id === selectedId ? { ...c, unread_admin_count: 0 } : c)));
      })
      .catch((err) => {
        if (!cancelled) setThreadError(err.message ?? "Errore nel caricamento della conversazione");
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const tick = () => {
      if (document.hidden) return;
      adminChatApi
        .thread(selectedId)
        .then(setThread)
        .catch(() => {});
    };
    const id = setInterval(tick, THREAD_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [selectedId]);

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateQuery({ search: value }), 400);
  };

  const loadMore = () => {
    setLoadingMore(true);
    const next = loadedPages + 1;
    loadList(next, "append").then((data) => {
      if (data) setLoadedPages(next);
      setLoadingMore(false);
    });
  };

  const send = async () => {
    if (!selectedId || sending) return;
    const body = draft.trim();
    if (!body || body.length > MAX_MESSAGE_LENGTH) return;
    const optimistic: DisplayMessage = {
      id: `tmp-${Date.now()}`,
      conversation_id: selectedId,
      sender: "admin",
      body,
      created_at: new Date().toISOString(),
      read_at: null,
      pending: true
    };
    setPending((current) => [...current, optimistic]);
    setDraft("");
    setSending(true);
    try {
      const result = await adminChatApi.reply(selectedId, body);
      setPending((current) => current.filter((m) => m.id !== optimistic.id));
      setThread((current) => (current ? { ...current, messages: [...current.messages, result.message] } : current));
      loadList(1, "refresh");
    } catch (err) {
      setPending((current) => current.filter((m) => m.id !== optimistic.id));
      setDraft(body);
      if (err instanceof AdminChatApiError && err.status === 409) {
        toast.error("La conversazione è chiusa: riaprila per rispondere.");
        adminChatApi.thread(selectedId).then(setThread).catch(() => {});
      } else {
        toast.error(`Invio non riuscito: ${err instanceof Error ? err.message : "errore sconosciuto"}`);
      }
    } finally {
      setSending(false);
    }
  };

  const setConversationStatus = async (target: "closed" | "open") => {
    if (!selectedId) return;
    setStatusUpdating(true);
    try {
      if (target === "closed") await adminChatApi.close(selectedId);
      else await adminChatApi.reopen(selectedId);
      toast.success(target === "closed" ? "Conversazione chiusa." : "Conversazione riaperta.");
      const fresh = await adminChatApi.thread(selectedId);
      setThread(fresh);
      if (status !== "all" && status !== target) {
        // Con il filtro attivo la conversazione esce dalla vista corrente.
        setConversations((current) => current.filter((c) => c.id !== selectedId));
        setTotal((current) => Math.max(0, current - 1));
      } else {
        setConversations((current) => current.map((c) => (c.id === selectedId ? { ...c, status: target } : c)));
      }
    } catch (err) {
      toast.error(`Operazione non riuscita: ${err instanceof Error ? err.message : "errore sconosciuto"}`);
    } finally {
      setStatusUpdating(false);
    }
  };

  const messages: DisplayMessage[] = thread ? [...thread.messages, ...pending] : pending;

  return (
    <div className="admin-page">
      <h1 className="admin-title">Chat</h1>
      <div className="flex h-[calc(100vh-190px)] min-h-[480px] gap-4">
        <aside
          className={clsx(
            "w-full flex-col overflow-hidden rounded-2xl bg-white shadow md:flex md:w-[340px] md:shrink-0",
            selectedId ? "hidden" : "flex"
          )}
        >
          <ConversationList
            status={status}
            onStatusChange={(value) => updateQuery({ status: value === "open" ? "" : value })}
            searchInput={searchInput}
            onSearchChange={onSearchChange}
            conversations={conversations}
            total={total}
            loading={listLoading}
            error={listError}
            selectedId={selectedId}
            onSelect={(id) => updateQuery({ c: id })}
            hasMore={conversations.length < total}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
        </aside>
        <section
          className={clsx(
            "min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow",
            selectedId ? "flex" : "hidden md:flex"
          )}
        >
          {selectedId ? (
            <ThreadView
              thread={thread}
              loading={threadLoading}
              error={threadError}
              messages={messages}
              draft={draft}
              onDraftChange={setDraft}
              onSend={send}
              sending={sending}
              statusUpdating={statusUpdating}
              onClose={() => setConversationStatus("closed")}
              onReopen={() => setConversationStatus("open")}
              onBack={() => updateQuery({ c: "" })}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="admin-empty">Seleziona una conversazione dalla lista per leggerla e rispondere.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

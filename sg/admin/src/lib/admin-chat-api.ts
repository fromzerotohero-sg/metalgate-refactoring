// Client per l'API chat admin SilverGate. Stesso contratto di admin-api.ts
// (proxy same-origin /api/* via next.config.mjs, header X-Admin-Code su ogni
// richiesta, codice admin persistito in sessionStorage) ma modulo autonomo:
// l'inbox chat resta compilabile anche mentre admin-api.ts evolve.

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
const API_BASE = `${API_URL}/admin/chat`;
const CODE_STORAGE_KEY = "pannello.admin_code";

export class AdminChatApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function adminCode(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(CODE_STORAGE_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const code = adminCode();
  if (code) headers.set("X-Admin-Code", code);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AdminChatApiError(response.status, payload.error ?? "Richiesta fallita");
  }
  return payload as T;
}

export type ChatConversationStatus = "open" | "closed";

export type ChatConversationSummary = {
  id: string;
  status: ChatConversationStatus;
  subject?: string | null;
  last_message_at?: string | null;
  unread_admin_count: number;
  created_at?: string | null;
  user: { id: string; username?: string | null; email?: string | null };
  last_message?: {
    sender?: "user" | "admin";
    preview: string;
    created_at?: string | null;
  } | null;
};

export type ChatConversationsPage = {
  conversations: ChatConversationSummary[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

export type ChatMessage = {
  id: number | string;
  conversation_id: string;
  sender: "user" | "admin";
  body: string;
  created_at?: string | null;
  read_at?: string | null;
};

export type ChatThread = {
  conversation: {
    id: string;
    status: ChatConversationStatus;
    subject?: string | null;
    last_message_at?: string | null;
    unread_admin_count: number;
    unread_user_count: number;
    created_at?: string | null;
  };
  user: {
    id: string;
    username?: string | null;
    email?: string | null;
    created_at?: string | null;
    last_login?: string | null;
  } | null;
  messages: ChatMessage[];
};

export type ConversationsQuery = {
  status?: "open" | "closed" | "all";
  search?: string;
  page?: number;
  per_page?: number;
};

export const adminChatApi = {
  conversations: (query: ConversationsQuery = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.search) params.set("search", query.search);
    if (query.page) params.set("page", String(query.page));
    if (query.per_page) params.set("per_page", String(query.per_page));
    const qs = params.toString();
    return request<ChatConversationsPage>(`/conversations${qs ? `?${qs}` : ""}`);
  },
  thread: (id: string) => request<ChatThread>(`/conversations/${encodeURIComponent(id)}/messages`),
  reply: (id: string, body: string) =>
    request<{ message: ChatMessage }>(`/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body })
    }),
  close: (id: string) =>
    request<{ conversation_id: string; status: ChatConversationStatus; changed: boolean }>(
      `/conversations/${encodeURIComponent(id)}/close`,
      { method: "POST" }
    ),
  reopen: (id: string) =>
    request<{ conversation_id: string; status: ChatConversationStatus; changed: boolean }>(
      `/conversations/${encodeURIComponent(id)}/reopen`,
      { method: "POST" }
    ),
  unreadCount: () => request<{ unread: number; open_conversations: number }>("/unread-count")
};

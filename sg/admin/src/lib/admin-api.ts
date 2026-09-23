// Client per l'API admin SilverGate. Passa dal proxy same-origin /api/*
// (next.config.mjs), quindi niente CORS. Autenticazione: header X-Admin-Code su
// ogni richiesta. Il codice admin è persistito in sessionStorage (muore chiudendo
// la tab).

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
const API_BASE = `${API_URL}/admin`;
const CODE_STORAGE_KEY = "pannello.admin_code";

export class AdminApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let adminCode: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function storeAdminCode(code: string) {
  adminCode = code;
  if (typeof window !== "undefined") window.sessionStorage.setItem(CODE_STORAGE_KEY, code);
}

export function loadStoredAdminCode(): string | null {
  if (adminCode) return adminCode;
  if (typeof window === "undefined") return null;
  adminCode = window.sessionStorage.getItem(CODE_STORAGE_KEY);
  return adminCode;
}

export function clearAdminCredentials() {
  adminCode = null;
  if (typeof window !== "undefined") window.sessionStorage.removeItem(CODE_STORAGE_KEY);
}

export function onAdminUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (adminCode) headers.set("X-Admin-Code", adminCode);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.();
    throw new AdminApiError(response.status, payload.error ?? "Richiesta fallita");
  }
  return payload as T;
}

export type AdminStats = {
  total_users: number;
  total_credits: number;
  active_today: number;
  unverified: number;
  new_this_week: number;
  total_hp_purchased: number;
  estimated_revenue: number;
};

export type TempGrant = { amount: number; expires_at?: string };

export type AdminUser = {
  id: string;
  username?: string;
  email: string;
  tag?: string;
  credits_balance?: number;
  temp_credits_balance?: TempGrant[] | null;
  email_verified?: boolean;
  created_at?: string;
  last_login?: string;
  last_activity_at?: string;
  referral_code?: string;
  referred_by?: string;
  referred_by_streamer?: string;
  stripe_customer_id?: string;
  credits_bought?: number;
  credits_spent?: number;
};

export type AdminUsersPage = {
  users: AdminUser[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

export type AdminTransaction = {
  id: string;
  user_id?: string;
  amount: number;
  type?: string;
  description?: string;
  status?: string;
  timestamp?: string;
  users?: { username?: string; email?: string } | null;
};

export type AdminUserDetail = {
  user: AdminUser & Record<string, unknown>;
  transactions: AdminTransaction[];
  stats: { total_bought: number; total_spent: number; total_revenue: number; transaction_count: number };
  referred_users: { id: string; username?: string; email?: string }[];
};

export type ActivityPoint = { date: string; active_users: number };

export type AdminPageMeta = {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

export type StreamerListItem = {
  streamer_id: number | string;
  id_code: string | null;
  is_managed: boolean;
  manager_id: number | string | null;
  manager_code: string | null;
  balance_available: number;
  total_earned: number;
  referred_num: number;
  referred_num_declared: number;
  created_at?: string | null;
  ai_requests_30d: number;
  ai_cost_30d: number;
  subordinate_ids: string[];
  subordinate_count: number;
  network_referred_num: number;
};

export type StreamerSummary = {
  id: string;
  id_code: string | null;
  is_manager: boolean;
  balance_available: number;
  total_earned: number;
  referred_num: number;
  created_at?: string | null;
};

export type StreamerNetworkUser = {
  id: string;
  username?: string;
  email?: string;
  streamer_id: string | null;
  streamer_code: string | null;
  euros_spent: number;
  credits_bought: number;
  credits_spent: number;
  credits_balance: number;
  last_active?: string | null;
  joined_at?: string | null;
};

export type StreamerDetail = {
  streamer: StreamerSummary;
  branch_streamer_ids: string[];
  subordinates: StreamerSummary[];
  subordinates_page: AdminPageMeta;
  team_stats: { total_subordinates: number; total_team_balance: number; total_team_earned: number };
  users: StreamerNetworkUser[];
  users_page: AdminPageMeta;
  total_users: number;
  total_euros_spent: number;
  total_credits_bought: number;
  total_credits_spent: number;
};

export type AiStreamerUsage = {
  streamer_id: number | string;
  id_code: string | null;
  requests_count: number;
  total_tokens: number;
  total_cost: number;
  last_request_at?: string | null;
};

export type CreateStreamerBody = {
  id_code: string;
  password: string;
  manager_code?: string;
};

export type CreateStreamerResponse = {
  message: string;
  streamer_id: number | string;
};

export type AssignManagerResponse = {
  message: string;
  streamer_id: number | string;
  manager_id: number | string | null;
  manager_code: string | null;
  is_managed: boolean;
};

export type UsersQuery = {
  page?: number;
  per_page?: number;
  search?: string;
  status?: string;
  sort?: string;
  order?: "asc" | "desc";
  created_from?: string;
  created_to?: string;
};

export type StreamersQuery = {
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  only_managers?: boolean;
  only_managed?: boolean;
};

export type TransactionsQuery = {
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
  type?: string;
  status?: string;
  user_id?: string;
  from?: string;
  to?: string;
};

export const adminApi = {
  login: async (code: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new AdminApiError(response.status, payload.error ?? "Accesso fallito");
  },
  stats: () => request<AdminStats>("/stats"),
  users: (query: UsersQuery = {}) => {
    const params = new URLSearchParams();
    if (query.page) params.set("page", String(query.page));
    if (query.per_page) params.set("per_page", String(query.per_page));
    if (query.search) params.set("search", query.search);
    if (query.status) params.set("status", query.status);
    if (query.sort) params.set("sort", query.sort);
    if (query.order) params.set("order", query.order);
    if (query.created_from) params.set("created_from", query.created_from);
    if (query.created_to) params.set("created_to", query.created_to);
    const qs = params.toString();
    return request<AdminUsersPage>(`/users${qs ? `?${qs}` : ""}`);
  },
  userDetail: (id: string) => request<AdminUserDetail>(`/users/${encodeURIComponent(id)}`),
  transactions: (query: TransactionsQuery = {}) => {
    const params = new URLSearchParams();
    if (query.limit) params.set("limit", String(query.limit));
    if (query.sort) params.set("sort", query.sort);
    if (query.order) params.set("order", query.order);
    if (query.type) params.set("type", query.type);
    if (query.status) params.set("status", query.status);
    if (query.user_id) params.set("user_id", query.user_id);
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    const qs = params.toString();
    return request<{ transactions: AdminTransaction[] }>(`/transactions${qs ? `?${qs}` : ""}`);
  },
  streamers: (query: StreamersQuery = {}) => {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.sort) params.set("sort", query.sort);
    if (query.order) params.set("order", query.order);
    if (query.only_managers) params.set("only_managers", "true");
    if (query.only_managed) params.set("only_managed", "true");
    const qs = params.toString();
    return request<{ streamers: StreamerListItem[]; total: number }>(`/streamers${qs ? `?${qs}` : ""}`);
  },
  streamerDetail: (id: string, query: { users_per_page?: number; subordinates_per_page?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.users_per_page) params.set("users_per_page", String(query.users_per_page));
    if (query.subordinates_per_page) params.set("subordinates_per_page", String(query.subordinates_per_page));
    const qs = params.toString();
    return request<StreamerDetail>(`/streamers/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`);
  },
  createStreamer: (body: CreateStreamerBody) =>
    request<CreateStreamerResponse>("/streamers", { method: "POST", body: JSON.stringify(body) }),
  assignManager: (id: string, managerCode: string) =>
    request<AssignManagerResponse>(`/streamers/${encodeURIComponent(id)}/manager`, {
      method: "PATCH",
      body: JSON.stringify({ manager_code: managerCode })
    }),
  aiByStreamer: () => request<{ by_streamer: AiStreamerUsage[] }>("/ai/by-streamer"),
  activity: (days = 30) => request<{ activity: ActivityPoint[] }>(`/activity?days=${days}`),
  grantCredits: (id: string, body: { amount: number; reason?: string; expires_in_days?: number }) =>
    request<{ credits_added: number; temporary_balance: TempGrant[] }>(`/users/${encodeURIComponent(id)}/credits`, {
      method: "POST",
      body: JSON.stringify(body)
    })
};

export function availableCredits(user: AdminUser): number {
  const plan = user.credits_balance ?? 0;
  const temp = (user.temp_credits_balance ?? []).reduce((sum, grant) => sum + (grant.amount ?? 0), 0);
  return plan + temp;
}

export function formatNumber(value: number | undefined | null): string {
  return (value ?? 0).toLocaleString("it-IT");
}

export function formatEuro(value: number | undefined | null): string {
  return (value ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

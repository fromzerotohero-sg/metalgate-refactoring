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

export type UsersQuery = { page?: number; per_page?: number; search?: string; status?: string };

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
    const qs = params.toString();
    return request<AdminUsersPage>(`/users${qs ? `?${qs}` : ""}`);
  },
  userDetail: (id: string) => request<AdminUserDetail>(`/users/${encodeURIComponent(id)}`),
  transactions: (limit = 10) => request<{ transactions: AdminTransaction[] }>(`/transactions?limit=${limit}`),
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

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
const TOKEN_KEY = "silvergate_streamer_token";

export type StreamerProfile = {
  id: string;
  id_code: string | null;
  is_manager: boolean;
  balance_available: number;
  total_earned: number;
  referred_num: number;
  created_at?: string | null;
};

export type StreamerDashboard = {
  profile: StreamerProfile;
  subordinates?: StreamerProfile[];
  subordinates_page?: Page;
  team_stats?: {
    total_subordinates: number;
    total_team_balance: number;
    total_team_earned: number;
  };
};

export type NetworkUser = {
  id: string;
  username: string;
  email?: string | null;
  streamer_id?: string | null;
  streamer_code?: string | null;
  euros_spent: number;
  credits_bought: number;
  credits_spent: number;
  credits_balance: number;
  last_active?: string | null;
  joined_at?: string | null;
};

export type Page = { total: number; page: number; per_page: number; total_pages: number };

export type NetworkResponse = {
  users: NetworkUser[];
  network_streamers: StreamerProfile[];
  total_users: number;
  total_euros_spent: number;
  total_credits_bought: number;
  total_credits_spent: number;
} & Page;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function requestHeaders(token?: string, init?: HeadersInit) {
  const headers = new Headers(init);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = requestHeaders(token, init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload.error ?? "Request failed");
  return payload as T;
}

export function storedToken() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string) {
  window.sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.sessionStorage.removeItem(TOKEN_KEY);
}

export const streamerApi = {
  login: (id_code: string, password: string) => request<{ token: string; streamer: StreamerProfile }>("/streamer/login", undefined, {
    method: "POST",
    body: JSON.stringify({ id_code, password }),
  }),
  dashboard: (token: string, page = 1) => request<StreamerDashboard>(`/streamer/dashboard?page=${page}`, token),
  subscribed: (token: string, streamerId: string, page = 1) => request<NetworkResponse>(`/streamer/${encodeURIComponent(streamerId)}/subscribed?page=${page}`, token),
};

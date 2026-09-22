const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.fromzerotohero.io/api").replace(/\/$/, "");

export type SessionUser = { id: string; email: string; username?: string; tag?: string; email_verified?: boolean };

export type Plan = {
  id: string; name: string; credits_per_period?: number;
  price_cents?: number; currency?: string; price_display?: string; interval?: string;
  active?: boolean; status?: string;
  current_period_start?: string; current_period_end?: string; cancel_at_period_end?: boolean;
};

export type CreditsPayload = {
  plan: Plan | null;
  usage?: { percent: number; overfilled: boolean; credits_used?: number; credits_allowance?: number };
  credits?: { plan_remaining?: number; temporary_remaining?: number; total_remaining?: number };
  upgrade?: { show: boolean; reason?: string; cta_label?: string; url?: string; next_plan?: Plan } | null;
};

export type Transaction = { id: string; amount: number; description: string; status?: string; timestamp?: string };

export type AuthSession = { id: string; current?: boolean; service?: string; user_agent?: string; last_seen_at?: string; created_at?: string };

export type ApiErrorPayload = { error?: string; message?: string; requires_verification?: boolean };

export class ApiError extends Error {
  constructor(public status: number, message: string, public payload?: ApiErrorPayload) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload.error ?? payload.message ?? "Request failed", payload);
  return payload as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  session: () => request<SessionUser>("/session"),
  me: () => request<Record<string, unknown>>("/me"),
  statsUsers: () => request<{ count: number }>("/stats/users"),
  plans: () => request<{ plans: Plan[] }>("/plans"),
  credits: () => request<CreditsPayload>("/credits"),
  transactions: () => request<{ transactions: Transaction[] }>("/transactions"),
  profile: (body: { username?: string; tag?: string }) => request<{ message: string; user: SessionUser }>("/profile", { method: "PUT", body: JSON.stringify(body) }),
  deleteAccount: () => request<{ message: string }>("/me", { method: "DELETE" }),
  login: (body: { email: string; password: string; service?: string }) => request<{ message: string; user: SessionUser }>("/auth/login", json({ ...body, service: body.service ?? "web" })),
  logout: () => request<{ message: string }>("/auth/logout", json({})),
  logoutAll: () => request<{ message: string; sessions_revoked?: number }>("/auth/logout-all", json({})),
  authSessions: () => request<{ sessions: AuthSession[] }>("/auth/sessions"),
  revokeSession: (sessionId: string) => request<{ message: string }>(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  changePassword: (body: { current_password: string; new_password: string }) => request<{ message: string }>("/auth/change-password", json(body)),
  register: (body: { email: string; password: string; username?: string; tag?: string; referral_code?: string; redirect?: string }) => request<{ message: string; verification_email_sent?: boolean }>("/register", json(body)),
  verifyEmail: (token: string) => request<{ message: string }>("/sso/verify-email", json({ token })),
  sendVerification: (body: { email: string; redirect?: string }) => request<{ message: string }>("/sso/send-verification", json(body)),
  forgotPassword: (email: string) => request<{ message: string }>("/sso/forgot-password", json({ email })),
  verifyResetCode: (body: { email: string; code: string }) => request<{ reset_token?: string }>("/sso/verify-reset-code", json(body)),
  resetPassword: (body: { token: string; password: string }) => request<{ message: string }>("/sso/reset-password", json(body)),
  subscribe: (plan_id: string) => request<{ session_id: string; url: string }>("/stripe/subscribe", json({ plan_id })),
  portal: (return_url?: string) => request<{ url: string }>("/stripe/portal", json(return_url ? { return_url } : {})),
  verifyEmailByApiRedirect: (token: string) => `${API_URL}/auth/verify?token=${encodeURIComponent(token)}`
};

export { API_URL };

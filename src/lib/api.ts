const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.fromzerotohero.io/api").replace(/\/$/, "");

export type SessionUser = { id: string; email: string; username?: string; tag?: string; email_verified?: boolean };
export type ApiErrorPayload = { error?: string; message?: string; requires_verification?: boolean };

export class ApiError extends Error {
  constructor(public status: number, message: string, public payload?: ApiErrorPayload) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload.error ?? payload.message ?? "Richiesta non riuscita", payload);
  return payload as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  session: () => request<SessionUser>("/session"),
  me: () => request<unknown>("/me"),
  statsUsers: () => request<{ count: number }>("/stats/users"),
  plans: () => request<unknown>("/plans"),
  credits: () => request<unknown>("/credits"),
  transactions: () => request<unknown>("/transactions"),
  profile: (body: { username?: string; tag?: string }) => request<unknown>("/profile", { method: "PUT", body: JSON.stringify(body) }),
  deleteAccount: () => request<unknown>("/me", { method: "DELETE" }),
  login: (body: { email: string; password: string; service?: string }) => request<unknown>("/auth/login", json({ ...body, service: body.service ?? "web" })),
  logout: () => request<unknown>("/auth/logout", json(undefined)),
  logoutAll: () => request<unknown>("/auth/logout-all", json(undefined)),
  authSessions: () => request<unknown>("/auth/sessions"),
  revokeSession: (sessionId: string) => request<unknown>(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  changePassword: (body: { current_password: string; new_password: string }) => request<unknown>("/auth/change-password", json(body)),
  register: (body: { email: string; password: string; username?: string; tag?: string; referral_code?: string; redirect?: string }) => request<unknown>("/register", json(body)),
  verifyEmail: (token: string) => request<unknown>("/sso/verify-email", json({ token })),
  sendVerification: (body: { email: string; redirect?: string }) => request<unknown>("/sso/send-verification", json(body)),
  forgotPassword: (email: string) => request<unknown>("/sso/forgot-password", json({ email })),
  verifyResetCode: (body: { email: string; code: string }) => request<unknown>("/sso/verify-reset-code", json(body)),
  resetPassword: (body: { token: string; password: string }) => request<unknown>("/sso/reset-password", json(body)),
  subscribe: (plan_id: string) => request<{ url: string }>("/stripe/subscribe", json({ plan_id })),
  portal: (return_url?: string) => request<{ url: string }>("/stripe/portal", json(return_url ? { return_url } : {})),
  verifyEmailByApiRedirect: (token: string) => `${API_URL}/auth/verify?token=${encodeURIComponent(token)}`
};

export { API_URL };

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://v2.fromzerotohero.io/api").replace(/\/$/, "");

export type SessionUser = { id: string; email: string; username?: string; tag?: string; email_verified?: boolean };

/**
 * What `/api/me` returns: the session identity plus the allowance summary.
 * `plan`, `usage` and `upgrade` are the same objects `/api/credits` returns, and
 * `plan`/`upgrade` may be null.
 */
export type Profile = SessionUser & {
  credits?: number;
  temp_credits?: number;
  temp_credits_grants?: { amount: number; expires_at: string }[];
  temp_credits_next_expiry?: string | null;
  plan?: Plan | null;
  usage?: Usage;
  upgrade?: Upgrade | null;
  referral_code?: string | null;
  referral_count?: number;
  referral_bonus_credits?: number;
  referral_earnings?: number;
  created_at?: string;
};

export type Plan = {
  id: string; name: string; credits_per_period?: number;
  price_cents?: number; currency?: string; price_display?: string; interval?: string;
  active?: boolean; status?: string;
  current_period_start?: string; current_period_end?: string; cancel_at_period_end?: boolean;
};

export type Usage = {
  /** The headline figure: what the progress bar draws. May exceed 100. */
  percent: number;
  /** True once temporary credits have been spent through the plan allowance. */
  overfilled: boolean;
  credits_used?: number;
  credits_allowance?: number;
};

/**
 * The upgrade call to action. The API decides when to show it — at or within the
 * threshold of the allowance, or when the user has no plan at all (in which case
 * `reason` is `"no_plan"` and `next_plan` is the entry plan). `url` is owned by the
 * backend; always link to it.
 *
 * `cta_label` is **English only** — the API has no locale, and the server uses the
 * same sentence for both `reason` values, varying just the plan name. A translated
 * app should therefore build the wording from `next_plan.name` (see `upgradeLabel`
 * in the account page) and keep `cta_label` only as a fallback.
 */
export type Upgrade = {
  show: boolean;
  reason?: "no_plan" | "within_threshold";
  threshold_percent?: number;
  cta_label?: string;
  url?: string;
  next_plan?: Plan;
};

export type CreditsPayload = {
  plan: Plan | null;
  usage?: Usage;
  credits?: { plan_remaining?: number; temporary_remaining?: number; total_remaining?: number };
  upgrade?: Upgrade | null;
};

/**
 * `type` is worth reading: `subscription_grant` and `purchase` are money-backed,
 * `bonus` is free (referral, signup, admin), and `deduction` is spend. Use `amount`
 * for the sign, `type` for the reason — a bonus is not revenue.
 */
export type Transaction = {
  id: string;
  amount: number;
  type?: "subscription_grant" | "purchase" | "bonus" | "deduction" | "usage" | string;
  description: string;
  status?: string;
  timestamp?: string;
};

export type AuthSession = { id: string; current?: boolean; service?: string; user_agent?: string; last_seen_at?: string; created_at?: string };

export type ChatConversationStatus = "open" | "closed";

export type ChatConversation = {
  id: string;
  subject?: string | null;
  status: ChatConversationStatus;
  last_message_at?: string | null;
  unread_user_count: number;
  created_at?: string | null;
  last_message?: { sender?: "user" | "admin"; preview: string; created_at?: string | null } | null;
};

export type ChatMessage = {
  id: number;
  conversation_id: string;
  sender: "user" | "admin";
  body: string;
  created_at?: string | null;
  read_at?: string | null;
};

/**
 * A Stripe invoice.
 *
 * `hosted_url` and `pdf_url` are signed Stripe URLs with their own lifetime, issued
 * per request — never cache them, and treat a missing one as "no document yet".
 */
export type Invoice = {
  id: string;
  number?: string | null;
  created?: string | null;
  status?: string | null;
  paid?: boolean;
  amount_due?: number;
  amount_paid?: number;
  currency?: string;
  description?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  hosted_url?: string | null;
  pdf_url?: string | null;
};

export type ApiErrorPayload = { error?: string; message?: string; requires_verification?: boolean; reason?: string };

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
  /** Where a `?return_to=` may actually send the user. Server-validated. */
  redirectTarget: (returnTo: string) => request<{ url: string | null }>(`/redirect-target?return_to=${encodeURIComponent(returnTo)}`),
  me: () => request<Profile>("/me"),
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
  // Cancels at the end of the paid period, not immediately: see the route.
  cancelSubscription: () => request<{ message: string }>("/stripe/cancel", json({ cancel: true })),
  invoices: () => request<{ invoices: Invoice[] }>("/stripe/invoices"),
  chatConversations: () => request<{ conversations: ChatConversation[] }>("/chat/conversations"),
  chatMessages: (conversationId: string, after?: number) =>
    request<{ conversation: ChatConversation; messages: ChatMessage[] }>(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages${after ? `?after=${after}` : ""}`
    ),
  createChatConversation: (body: string, subject?: string) =>
    request<{ conversation: ChatConversation; message: ChatMessage; appended: boolean }>("/chat/conversations", json({ body, subject })),
  sendChatMessage: (conversationId: string, body: string) =>
    request<{ conversation: ChatConversation; message: ChatMessage }>(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
      json({ body })
    ),
  markChatRead: (conversationId: string) =>
    request<{ marked_read: number }>(`/chat/conversations/${encodeURIComponent(conversationId)}/read`, json({}))
};

/**
 * Deliberately absent: a helper that builds a link straight at the API's
 * `GET /api/auth/verify`.
 *
 * The verification email links to this frontend's `/verify-email` page, which
 * posts the token to `/api/sso/verify-email` — the chosen flow, with
 * `SG_EMAIL_VERIFY_VIA_API=false`. That API route still exists server-side as an
 * escape hatch if the frontend is ever unavailable, but nothing here should build
 * a link to it.
 */

/**
 * Where to send the browser to begin Google sign-in.
 *
 * A full-page navigation, not a fetch: the flow leaves this origin for Google's
 * consent screen and returns with a session cookie, so it cannot be an XHR (and
 * the API returns redirects, not JSON). `redirect` is a path on this app that the
 * API sends the user back to once the handshake finishes.
 *
 * It goes through the API rather than to Google directly because the client
 * secret and the account linking both live server-side.
 *
 * `referral` is the code the user arrived through. It travels in the URL because
 * the callback is a cross-origin navigation with no header of its own to carry it;
 * the API folds it into the signed OAuth `state` so a forged one cannot attribute
 * a sign-up, and applies it only when it actually creates the account.
 */
export function googleSignInUrl(redirect?: string, referral?: string): string {
  const parameters = new URLSearchParams();
  if (redirect) parameters.set("redirect", redirect);
  if (referral) parameters.set("ref", referral);
  const query = parameters.toString();
  return `${API_URL}/auth/google/start${query ? `?${query}` : ""}`;
}

/**
 * Where to send the user after they authenticate.
 *
 * The set of valid destinations lives on the server — a site-relative path and a
 * **registered platform origin** are legitimate, an arbitrary URL is not — so this
 * asks rather than deciding locally. That is what lets a platform send a user here
 * to sign in (or register) and get them back on its own domain, without the sign-in
 * flow becoming an open redirect.
 *
 * A relative path is returned as-is (no round trip); anything else is offered to the
 * server, and a rejected value falls back to the account page.
 */
export async function resolveReturnTarget(returnTo?: string | null): Promise<string> {
  const fallback = "/account";
  if (!returnTo) return fallback;
  if (returnTo.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  try {
    const { url } = await api.redirectTarget(returnTo);
    return url ?? fallback;
  } catch {
    return fallback;
  }
}

export { API_URL };

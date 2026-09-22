import type { AuthSession, CreditsPayload, Plan, SessionUser, Transaction } from "./api";

export const previewUser: SessionUser = { id: "preview-user", email: "marco.rossi@preview.local", username: "marco", tag: "0427", email_verified: true };

export const previewCredits: CreditsPayload = {
  plan: { id: "pro", name: "Pro", credits_per_period: 300, price_cents: 1499, currency: "EUR", price_display: "€14.99", interval: "month", active: true, status: "active", current_period_start: "2026-09-17T09:00:00+00:00", current_period_end: "2026-10-17T09:00:00+00:00", cancel_at_period_end: false },
  usage: { percent: 38, overfilled: false, credits_used: 114, credits_allowance: 300 },
  credits: { plan_remaining: 186, temporary_remaining: 0, total_remaining: 186 },
  upgrade: { show: true, reason: "within_threshold", cta_label: "Passa a Ultra per limiti più alti", url: "/pricing?preview=1", next_plan: { id: "ultra", name: "Ultra", credits_per_period: 750, price_display: "€29.99", interval: "month" } }
};

export const previewPlans: Plan[] = [
  { id: "lite", name: "Lite", credits_per_period: 150, price_cents: 799, currency: "EUR", price_display: "€7.99", interval: "month" },
  { id: "pro", name: "Pro", credits_per_period: 300, price_cents: 1499, currency: "EUR", price_display: "€14.99", interval: "month" },
  { id: "ultra", name: "Ultra", credits_per_period: 750, price_cents: 2999, currency: "EUR", price_display: "€29.99", interval: "month" }
];

export const previewTransactions: Transaction[] = [
  { id: "tx-1", description: "Analisi partita completata", amount: -12, status: "completed", timestamp: "2026-09-19T18:42:00Z" },
  { id: "tx-2", description: "Piano Pro attivato", amount: 300, status: "completed", timestamp: "2026-09-17T09:12:00Z" },
  { id: "tx-3", description: "Analisi rosa completata", amount: -8, status: "completed", timestamp: "2026-09-12T20:05:00Z" }
];

export const previewSessions: AuthSession[] = [
  { id: "session-current", current: true, service: "web", user_agent: "Chrome · Windows", last_seen_at: "2026-09-21T09:14:00+00:00" },
  { id: "session-mobile", current: false, service: "mobile", user_agent: "Safari · iPhone", last_seen_at: "2026-09-20T21:40:00+00:00" }
];

export function isLocalPreview() {
  if (typeof window === "undefined") return false;
  return /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get("preview") === "1";
}

export function previewHref(path: string) {
  return `${path}${path.includes("?") ? "&" : "?"}preview=1`;
}

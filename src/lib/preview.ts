export const previewAccount = {
  session: { id: "preview-user", email: "player@preview.local", username: "playerone", tag: "0427", email_verified: true },
  me: { id: "preview-user", email: "player@preview.local", username: "playerone", tag: "0427", email_verified: true },
  credits: {
    plan: { id: "pro", name: "Pro", credits_per_period: 300, price_display: "€14,99", interval: "month", active: true, status: "active", current_period_start: "2026-09-17T09:00:00+00:00", current_period_end: "2026-10-17T09:00:00+00:00", cancel_at_period_end: false },
    usage: { percent: 38, overfilled: false, credits_used: 114, credits_allowance: 300 },
    credits: { plan_remaining: 186, temporary_remaining: 0, total_remaining: 186, temporary_grants: [], temporary_next_expiry: null },
    upgrade: { show: true, reason: "within_threshold", threshold_percent: 90, next_plan: { id: "ultra", name: "Ultra", credits_per_period: 750, price_display: "€29,99", interval: "month" }, url: "/pricing?preview=1", cta_label: "Passa a Ultra · Upgrade a Ultra" }
  },
  transactions: [
    { id: "tx-1", description: "Analisi rosa completata", amount: -1, timestamp: "2026-09-19T18:42:00Z" },
    { id: "tx-2", description: "Periodo Pro attivato", amount: 0, timestamp: "2026-09-14T09:12:00Z" },
    { id: "tx-3", description: "Consiglio mercato salvato", amount: -1, timestamp: "2026-09-12T20:05:00Z" }
  ],
  sessions: [
    { id: "session-current", current: true, service: "Browser corrente", user_agent: "Chrome · Windows" },
    { id: "session-mobile", current: false, service: "Mobile", user_agent: "Safari · iPhone" }
  ]
};

export function isLocalPreview() {
  if (typeof window === "undefined") return false;
  return /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get("preview") === "1";
}

export function previewHref(path: string) {
  return `${path}${path.includes("?") ? "&" : "?"}preview=1`;
}

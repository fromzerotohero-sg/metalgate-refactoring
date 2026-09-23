// Etichette leggibili per i valori tecnici esposti dal backend (tipi di
// transazione, servizi/piattaforme, tipi di evento). Ogni helper restituisce
// il valore grezzo quando non ha una traduzione, così un valore nuovo lato
// backend non rompe la UI.

export const SERVICE_LABELS: Record<string, string> = {
  "assistant-chat": "Chat IA",
  internal: "SilverGate"
};

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  purchase: "Acquisto",
  subscription_grant: "Abbonamento",
  bonus: "Bonus",
  deduction: "Addebito crediti",
  usage: "Uso"
};

export const PLATFORM_LABELS: Record<string, string> = {
  efootball: "eFootball",
  tornei: "Arena Tornei",
  fzth: "From Zero To Hero",
  silver: "Silver"
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  login: "Accesso",
  roster_updated: "Rosa aggiornata",
  build_saved: "Build salvata",
  match_played: "Partita giocata",
  match_won: "Partita vinta",
  tournament_joined: "Iscrizione a torneo",
  tournament_won: "Torneo vinto",
  achievement_unlocked: "Obiettivo sbloccato",
  credits_spent: "Crediti spesi"
};

// Colore del pallino nella timeline, per piattaforma. Le piattaforme senza
// colore assegnato usano il grigio di fallback.
export const PLATFORM_COLORS: Record<string, string> = {
  efootball: "#15803d",
  tornei: "#b45309",
  fzth: "#7c3aed",
  silver: "#2563eb"
};

export const PLATFORM_COLOR_FALLBACK = "#64748b";

export function serviceLabel(service?: string | null): string {
  if (!service) return "—";
  return SERVICE_LABELS[service] ?? service;
}

export function typeLabel(type?: string | null): string {
  if (!type) return "—";
  return TRANSACTION_TYPE_LABELS[type] ?? type;
}

export function platformLabel(platform?: string | null): string {
  if (!platform) return "—";
  return PLATFORM_LABELS[platform] ?? platform;
}

export function platformColor(platform?: string | null): string {
  return PLATFORM_COLORS[platform ?? ""] ?? PLATFORM_COLOR_FALLBACK;
}

// snake_case sconosciuto → "Title Case" con spazi ("custom_event" → "Custom Event").
function humanizeSnakeCase(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function eventLabel(eventType?: string | null): string {
  if (!eventType) return "—";
  return EVENT_TYPE_LABELS[eventType] ?? humanizeSnakeCase(eventType);
}

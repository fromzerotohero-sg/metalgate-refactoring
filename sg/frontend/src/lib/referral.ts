/**
 * Referral capture.
 *
 * A referral link is `/register?ref=CODE`, and the code has to survive two things
 * that would otherwise lose it: the user wandering the site before they sign up,
 * and the trip out to Google's consent screen and back.
 *
 * It is kept in `localStorage` rather than a cookie on purpose. Nothing
 * server-side needs to read it: the code is attached to the sign-up request body
 * and to the Google button's URL, both of which are built in JavaScript. A cookie
 * would add a domain, path and TTL surface — and would be attached to every
 * request — in exchange for nothing.
 *
 * The value is a hint about who to credit, never a credential, so a user who clears
 * it simply arrives unattributed.
 */

const STORAGE_KEY = "sg_referral";

/** Long enough to cover a research-then-sign-up gap, short enough to lapse. */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * `ref` is the documented parameter. The others are accepted because referral
 * links get built by hand, and a code that is silently dropped is invisible until
 * a streamer is not paid.
 */
const PARAMETERS = ["ref", "referral", "code"] as const;

function normalize(value: string | null | undefined): string {
  const candidate = (value ?? "").trim();
  if (!candidate || candidate.length > 64) return "";
  return /^[A-Za-z0-9_-]+$/.test(candidate) ? candidate : "";
}

/** The code on the current URL, if there is one. */
export function referralFromUrl(): string {
  if (typeof window === "undefined") return "";
  const parameters = new URLSearchParams(window.location.search);
  for (const key of PARAMETERS) {
    const value = normalize(parameters.get(key));
    if (value) return value;
  }
  return "";
}

/**
 * Persist the code from the URL so it survives navigation.
 *
 * Storage can be unavailable (Safari private mode, a full quota), which is why
 * this never throws: losing attribution is a missed payout, but breaking the page
 * the user is trying to sign up on is worse.
 */
export function rememberReferral(): void {
  const code = referralFromUrl();
  if (!code) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    /* attribution is best effort */
  }
}

/** The stored code, evicting it once it is older than `MAX_AGE_MS`. */
export function storedReferral(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown };
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return "";
    }
    return normalize(typeof parsed.code === "string" ? parsed.code : "");
  } catch {
    return "";
  }
}

/**
 * The code to attribute with.
 *
 * The URL wins over storage: following a link is the more recent and more
 * deliberate act than whatever was saved on an earlier visit.
 */
export function getReferralCode(): string {
  return referralFromUrl() || storedReferral();
}

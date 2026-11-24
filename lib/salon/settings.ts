/**
 * The shop's switches ("What your receptionist does by itself"), the Google review link and the
 * VAT rate (spec 2.4, 9.7). Pure, no server imports: the browser bundle uses it too.
 */

export const OUTBOX_KINDS = ["reminder", "review", "gap", "winback", "birthday"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];
/** The kinds that are promotions: only for clients with consent, and they end with the opt-out line. */
export const PROMO_KINDS: readonly OutboxKind[] = ["gap", "winback", "birthday"];

export type Automations = Record<OutboxKind, boolean>;

export interface SalonSettings {
  automations: Automations;
  googleReviewUrl: string | null;
  vatRatePct: number;
}

export const DEFAULT_VAT_RATE_PCT = 21;
export const NO_AUTOMATIONS: Automations = { reminder: false, review: false, gap: false, winback: false, birthday: false };

export function defaultSettings(): SalonSettings {
  return { automations: { ...NO_AUTOMATIONS }, googleReviewUrl: null, vatRatePct: DEFAULT_VAT_RATE_PCT };
}

/** A stored `automations` object read back: unknown keys are dropped, a missing one is off. */
export function readAutomations(raw: unknown): Automations {
  const out = { ...NO_AUTOMATIONS };
  if (raw && typeof raw === "object") {
    for (const k of OUTBOX_KINDS) out[k] = (raw as Record<string, unknown>)[k] === true;
  }
  return out;
}

export const REVIEW_URL_MAX = 300;
const REVIEW_PREFIXES = ["https://g.page/", "https://search.google.com/", "https://www.google.com/"] as const;
const REVIEW_HOSTS = new Set(["g.page", "search.google.com", "www.google.com"]);

/** Only a Google link may reach a client's phone: https, one of three hosts, no spaces, no login part. */
export function isReviewUrl(s: string): boolean {
  if (s.length > REVIEW_URL_MAX || /[\s\u0000-\u001f\u007f]/.test(s)) return false;
  if (!REVIEW_PREFIXES.some((p) => s.startsWith(p))) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && REVIEW_HOSTS.has(u.hostname) && u.username === "" && u.password === "" && u.port === "";
  } catch {
    return false;
  }
}

/**
 * What the outbox should hold (spec 2.4, 9.7, 9.8): the WhatsApp messages the Owner sends by hand.
 * Pure and deterministic: the clock, the shop's zone and the data come in, drafts come out. Every
 * draft has a dedupe key, so running it again (the app opens twice) writes nothing new.
 *
 * - reminder: confirmed bookings starting tomorrow (shop time), to any E.164 phone;
 * - review: bookings paid in the last 48 h, to any E.164 phone (needs the link);
 * - gap: a booking cancelled in the last 24 h that was to start within 72 h frees a slot; offered
 *   to up to 3 consenting clients, lapsed first, then most visits, never the one who cancelled and
 *   never one with a booking coming;
 * - winback: lapsed clients with consent; birthday: consenting clients whose day is today.
 */
import { Temporal } from "temporal-polyfill";
import { localDateOf, toInstant } from "@/lib/booking";
import { lapsedClients } from "@/lib/clients/lapsed";
import type { ClientSummary } from "@/lib/clients/summary";
import type { Lang } from "@/lib/sectors";
import { outboxBody } from "./outboxCopy";
import type { Automations, OutboxKind } from "./settings";

/** The most drafts one run makes: a cap on the work of opening the app. */
export const MAX_DRAFTS = 200;
export const GAP_MAX_CLIENTS = 3;
const REVIEW_WINDOW = { hours: 48 };
const GAP_CANCEL_WINDOW = { hours: 24 };
const GAP_AHEAD = { hours: 72 };
const E164 = /^\+[0-9]{6,15}$/;
const MIDNIGHT = Temporal.PlainTime.from("00:00");

export interface OutboxBooking {
  id: string;
  clientId: string | null;
  name: string;
  /** E.164, or '' for a walk-in. */
  phone: string;
  language: Lang;
  start: Temporal.Instant;
  status: "confirmed" | "cancelled";
  cancelledAt: Temporal.Instant | null;
  /** When the cash desk took the payment of this booking; null when unpaid. */
  paidAt: Temporal.Instant | null;
}

export interface OutboxClient {
  id: string;
  name: string;
  phone: string;
  language: Lang;
  /** "MM-DD" or null. */
  birthday: string | null;
  promoConsentAt: Temporal.Instant | null;
  summary: Pick<ClientSummary, "lastVisit" | "upcoming" | "intervalDays" | "totalVisits">;
}

export interface OutboxDraft {
  kind: OutboxKind;
  dedupeKey: string;
  clientId: string | null;
  bookingId: string | null;
  phone: string;
  language: Lang;
  body: string;
}

export interface PlanInput {
  now: Temporal.Instant;
  tz: string;
  shop: { name: string };
  settings: { automations: Automations; googleReviewUrl: string | null };
  /** Bookings for reminders and reviews (any status: the rules filter). */
  bookings: readonly OutboxBooking[];
  clients: readonly OutboxClient[];
  /** Cancelled bookings, for the gap offers. */
  cancellations: readonly OutboxBooking[];
  /** Every dedupe key the shop already has, whatever became of its message. */
  existingKeys: ReadonlySet<string>;
}

const cmp = Temporal.Instant.compare;

/** "MM-DD" of a local date; 29 February is celebrated on 28 February in a year without one. */
function birthdayOn(date: Temporal.PlainDate, birthday: string): boolean {
  if (birthday === "02-29" && !date.inLeapYear) return date.month === 2 && date.day === 28;
  return birthday === `${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function planOutbox(i: PlanInput): OutboxDraft[] {
  const { now, tz, settings, existingKeys } = i;
  const on = settings.automations;
  const out: OutboxDraft[] = [];
  const seen = new Set<string>();
  const push = (d: OutboxDraft) => {
    if (existingKeys.has(d.dedupeKey) || seen.has(d.dedupeKey) || out.length >= MAX_DRAFTS) return;
    if (!E164.test(d.phone)) return;
    seen.add(d.dedupeKey);
    out.push(d);
  };
  const copy = (kind: OutboxKind, lang: Lang, name: string, extra: { start?: Temporal.Instant; url?: string } = {}) =>
    outboxBody({ kind, lang, shopName: i.shop.name, name, tz, ...extra });

  const today = localDateOf(now, tz);

  if (on.reminder) {
    const from = toInstant(today.add({ days: 1 }), MIDNIGHT, tz);
    const to = toInstant(today.add({ days: 2 }), MIDNIGHT, tz);
    for (const b of [...i.bookings].sort(byStart)) {
      if (b.status !== "confirmed" || b.cancelledAt !== null) continue;
      if (cmp(b.start, from) < 0 || cmp(b.start, to) >= 0) continue;
      push({
        kind: "reminder",
        dedupeKey: `reminder:${b.id}`,
        clientId: b.clientId,
        bookingId: b.id,
        phone: b.phone,
        language: b.language,
        body: copy("reminder", b.language, b.name, { start: b.start }),
      });
    }
  }

  if (on.gap) {
    const since = now.subtract(GAP_CANCEL_WINDOW);
    const horizon = now.add(GAP_AHEAD);
    const gone = [...i.cancellations]
      .filter((b) => b.cancelledAt !== null && cmp(b.cancelledAt, since) >= 0 && cmp(b.cancelledAt, now) <= 0)
      .filter((b) => cmp(b.start, now) > 0 && cmp(b.start, horizon) <= 0)
      .sort(byStart);
    if (gone.length > 0) {
      const lapsed = lapsedClients(
        i.clients.map((c) => ({ id: c.id, name: c.name, summary: c.summary })),
        now,
      );
      const rank = new Map(lapsed.map((l, n) => [l.id, n]));
      const candidates = i.clients
        .filter((c) => c.promoConsentAt !== null && E164.test(c.phone) && c.summary.upcoming === null)
        .sort((a, b) => {
          const ra = rank.get(a.id);
          const rb = rank.get(b.id);
          if (ra !== undefined || rb !== undefined) return (ra ?? Infinity) - (rb ?? Infinity);
          return b.summary.totalVisits - a.summary.totalVisits || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
        });
      for (const b of gone) {
        // Keys that already exist count toward the three, so a second run never offers the slot to a fourth client.
        const prefix = `gap:${b.id}:`;
        let room = GAP_MAX_CLIENTS - [...existingKeys].filter((k) => k.startsWith(prefix)).length;
        for (const c of candidates) {
          if (room <= 0) break;
          if (c.id === b.clientId || (b.phone !== "" && c.phone === b.phone)) continue;
          const key = `${prefix}${c.id}`;
          if (existingKeys.has(key)) continue;
          room--;
          push({
            kind: "gap",
            dedupeKey: key,
            clientId: c.id,
            bookingId: b.id,
            phone: c.phone,
            language: c.language,
            body: copy("gap", c.language, c.name, { start: b.start }),
          });
        }
      }
    }
  }

  if (on.review && settings.googleReviewUrl) {
    const since = now.subtract(REVIEW_WINDOW);
    for (const b of [...i.bookings].sort(byStart)) {
      if (b.paidAt === null || cmp(b.paidAt, since) < 0 || cmp(b.paidAt, now) > 0) continue;
      push({
        kind: "review",
        dedupeKey: `review:${b.id}`,
        clientId: b.clientId,
        bookingId: b.id,
        phone: b.phone,
        language: b.language,
        body: copy("review", b.language, b.name, { url: settings.googleReviewUrl }),
      });
    }
  }

  if (on.birthday) {
    for (const c of i.clients) {
      if (c.promoConsentAt === null || c.birthday === null || !birthdayOn(today, c.birthday)) continue;
      push({
        kind: "birthday",
        dedupeKey: `birthday:${c.id}:${today.year}`,
        clientId: c.id,
        bookingId: null,
        phone: c.phone,
        language: c.language,
        body: copy("birthday", c.language, c.name),
      });
    }
  }

  if (on.winback) {
    const byId = new Map(i.clients.map((c) => [c.id, c]));
    for (const l of lapsedClients(i.clients.map((c) => ({ id: c.id, name: c.name, summary: c.summary })), now)) {
      const c = byId.get(l.id)!;
      if (c.promoConsentAt === null || c.summary.lastVisit === null) continue;
      push({
        kind: "winback",
        dedupeKey: `winback:${c.id}:${localDateOf(c.summary.lastVisit, tz).toString()}`,
        clientId: c.id,
        bookingId: null,
        phone: c.phone,
        language: c.language,
        body: copy("winback", c.language, c.name),
      });
    }
  }

  return out;
}

function byStart(a: OutboxBooking, b: OutboxBooking): number {
  return cmp(a.start, b.start) || a.id.localeCompare(b.id);
}

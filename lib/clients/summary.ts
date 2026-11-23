/**
 * What the customer book knows about one Client, derived from their Bookings (BACKLOG 14).
 * Nothing here is stored: visits, usual services, the visit interval and no-shows are read from
 * the bookings of the same shop and phone every time. Pure, no I/O, no server imports.
 */
import { Temporal } from "temporal-polyfill";

/** A Booking as the customer book needs it. */
export interface ClientBooking {
  id: string;
  serviceId: string;
  start: Temporal.Instant;
  end: Temporal.Instant;
  status: "confirmed" | "cancelled";
  /** The Owner marked "No vino". */
  noShow: boolean;
  /** What the cash desk took for this booking, in cents; null when it is not paid. */
  paidCents: number | null;
  /** The Owner's visit note ('' when none). */
  visitNote: string;
}

/** `visit`: confirmed, finished, came. `upcoming`: confirmed and not finished yet. */
export type HistoryState = "visit" | "no_show" | "cancelled" | "upcoming";

export function historyState(b: ClientBooking, now: Temporal.Instant): HistoryState {
  if (b.status === "cancelled") return "cancelled";
  if (Temporal.Instant.compare(b.end, now) > 0) return "upcoming";
  return b.noShow ? "no_show" : "visit";
}

/** A usual service needs at least this many visits to be called "lo de siempre". */
export const USUAL_MIN_VISITS = 2;
/** Visits needed before a personal interval means anything. */
export const INTERVAL_MIN_VISITS = 2;
/** The days after which a client with no personal interval counts as gone. */
export const DEFAULT_LAPSE_DAYS = 60;

const MS_DAY = 86_400_000;

export interface ClientSummary {
  totalVisits: number;
  noShows: number;
  lastVisit: Temporal.Instant | null;
  /** The next confirmed booking that has not finished, if any. */
  upcoming: Temporal.Instant | null;
  /** Median gap between visits, in whole days (rounded up, at least 1); null with fewer than 2 visits. */
  intervalDays: number | null;
  /** Service ids by number of visits, most visited first (ties: the most recent first). */
  usualServices: { serviceId: string; count: number }[];
}

/** The median of a non-empty list of numbers. */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function summarize(bookings: readonly ClientBooking[], now: Temporal.Instant): ClientSummary {
  const cmp = Temporal.Instant.compare;
  const visits = bookings.filter((b) => historyState(b, now) === "visit").sort((a, b) => cmp(a.start, b.start));
  const upcoming = bookings
    .filter((b) => historyState(b, now) === "upcoming")
    .sort((a, b) => cmp(a.start, b.start))[0];

  let intervalDays: number | null = null;
  if (visits.length >= INTERVAL_MIN_VISITS) {
    const gaps: number[] = [];
    for (let i = 1; i < visits.length; i++) {
      gaps.push((visits[i].start.epochMilliseconds - visits[i - 1].start.epochMilliseconds) / MS_DAY);
    }
    intervalDays = Math.max(1, Math.ceil(median(gaps)));
  }

  const counts = new Map<string, { count: number; last: Temporal.Instant }>();
  for (const v of visits) {
    const c = counts.get(v.serviceId);
    counts.set(v.serviceId, { count: (c?.count ?? 0) + 1, last: v.start });
  }
  const usualServices = [...counts.entries()]
    .map(([serviceId, c]) => ({ serviceId, count: c.count, last: c.last }))
    .sort((a, b) => b.count - a.count || cmp(b.last, a.last) || a.serviceId.localeCompare(b.serviceId))
    .map(({ serviceId, count }) => ({ serviceId, count }));

  return {
    totalVisits: visits.length,
    noShows: bookings.filter((b) => historyState(b, now) === "no_show").length,
    lastVisit: visits.at(-1)?.start ?? null,
    upcoming: upcoming?.start ?? null,
    intervalDays,
    usualServices,
  };
}

/** The service worth offering as "lo de siempre": the most visited one, seen at least twice. */
export function usualService(s: Pick<ClientSummary, "usualServices">): string | null {
  const top = s.usualServices[0];
  return top && top.count >= USUAL_MIN_VISITS ? top.serviceId : null;
}

/**
 * "Esta semana" on the machine (BACKLOG 17): the week's numbers from the shop's own rows.
 * Pure: the rows, the profile and the clock come in, and no number is ever estimated.
 *
 * Definitions (the screen states the time formula; these are the exact rules):
 * - Week: Monday 00:00 to the next Monday 00:00 in the shop's time zone (so a DST week is 167 or
 *   169 hours long, never shifted).
 * - Calls answered: Calls that started in the week and did not fail.
 * - Bookings: Bookings the receptionist made in the week (created in the week, linked to a Call,
 *   still confirmed, and not a reschedule of an earlier one), each counted once.
 * - Revenue booked: the sum of the catalogue price of each of those Bookings (a Service_Combo is the
 *   sum of its parts). Null when any of them is not in the catalogue any more. `revenueFrom` is true
 *   when a price is a starting price ("desde"), so the figure is a minimum.
 * - Calls that would have been lost: answered Calls that started outside the opening hours, or
 *   while another Call was in progress (it started inside another Call's span).
 * - Time saved: the sum of (ended − started) of the completed Calls with both timestamps. Null when
 *   there is none.
 */
import { Temporal } from "temporal-polyfill";
import { localDateOf, sessionsOn, type WeeklyHours } from "@/lib/booking";
import { serviceView } from "@/lib/conversation/catalog";
import type { ShopService } from "@/lib/conversation/shopProfile";

export interface WeekCall {
  id: string;
  status: string;
  startedAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
  endedAt: Temporal.Instant | null;
}

export interface WeekBooking {
  id: string;
  serviceId: string;
  callId: string | null;
  rescheduledFrom: string | null;
  status: string;
  createdAt: Temporal.Instant;
}

/** Where the rows come from (lib/db/weekRepository.ts); both are scoped to one shop. */
export interface WeekSource {
  /** Calls with `startedAt` in [from, to). */
  listWeekCalls(shopId: string, from: Temporal.Instant, to: Temporal.Instant): Promise<WeekCall[]>;
  /** Bookings with `createdAt` in [from, to), any status. */
  listWeekBookings(shopId: string, from: Temporal.Instant, to: Temporal.Instant): Promise<WeekBooking[]>;
}

export interface WeekShop {
  timeZone: string;
  hours: WeeklyHours;
  services: ShopService[];
}

export interface WeekStats {
  /** Local dates (YYYY-MM-DD) of the Monday and the Sunday of the week. */
  weekStart: string;
  weekEnd: string;
  callsAnswered: number;
  bookings: number;
  /** In cents; null when a booked service is not in the catalogue. */
  revenueCents: number | null;
  revenueFrom: boolean;
  lostCalls: number;
  /** Total of (ended − started) of the completed Calls, in seconds; null with no such Call. */
  timeSavedSeconds: number | null;
  /** How many Calls the time saved adds up. */
  timedCalls: number;
}

export interface WeekBounds {
  start: Temporal.Instant;
  end: Temporal.Instant;
  monday: Temporal.PlainDate;
}

/** The Monday-to-Sunday week that contains `now`, in the shop's zone. `end` is exclusive. */
export function weekBounds(now: Temporal.Instant, timeZone: string): WeekBounds {
  const today = localDateOf(now, timeZone);
  const monday = today.subtract({ days: today.dayOfWeek - 1 });
  return {
    monday,
    start: monday.toZonedDateTime(timeZone).toInstant(),
    end: monday.add({ days: 7 }).toZonedDateTime(timeZone).toInstant(),
  };
}

const inWeek = (t: Temporal.Instant, b: WeekBounds) =>
  Temporal.Instant.compare(t, b.start) >= 0 && Temporal.Instant.compare(t, b.end) < 0;

const lt = (a: Temporal.Instant, b: Temporal.Instant) => Temporal.Instant.compare(a, b) < 0;

function insideHours(at: Temporal.Instant, shop: WeekShop): boolean {
  const date = localDateOf(at, shop.timeZone);
  return sessionsOn(date, { timeZone: shop.timeZone, hours: shop.hours, services: [], resources: [] }).some(
    (s) => !lt(at, s.open) && lt(at, s.close),
  );
}

/** The span a Call occupied the line: to `endedAt`, else to its last activity; never negative. */
const spanEnd = (c: WeekCall) => {
  const end = c.endedAt ?? c.updatedAt;
  return lt(end, c.startedAt) ? c.startedAt : end;
};

export function computeWeekStats(input: {
  now: Temporal.Instant;
  shop: WeekShop;
  calls: readonly WeekCall[];
  bookings: readonly WeekBooking[];
}): WeekStats {
  const { shop } = input;
  const bounds = weekBounds(input.now, shop.timeZone);

  // A row listed twice counts once.
  const calls = [...new Map(input.calls.filter((c) => inWeek(c.startedAt, bounds)).map((c) => [c.id, c])).values()];
  const answered = calls.filter((c) => c.status !== "failed");

  const lost = answered.filter(
    (c) =>
      !insideHours(c.startedAt, shop) ||
      calls.some((o) => {
        if (o.id === c.id) return false;
        const first = Temporal.Instant.compare(o.startedAt, c.startedAt);
        if (first > 0) return false;
        // Same start: the later id is the one that found the line busy, so the pair counts once.
        return lt(c.startedAt, spanEnd(o)) && (first < 0 || o.id < c.id);
      }),
  );

  const timed = answered.filter((c) => c.status === "completed" && c.endedAt !== null && !lt(c.endedAt, c.startedAt));
  const seconds = timed.reduce((sum, c) => sum + Math.floor(c.endedAt!.since(c.startedAt).total("seconds")), 0);

  const seenCalls = new Set<string>();
  const made = [...new Map(input.bookings.map((b) => [b.id, b])).values()].filter((b) => {
    if (b.callId === null || b.rescheduledFrom !== null || b.status !== "confirmed" || !inWeek(b.createdAt, bounds)) return false;
    if (seenCalls.has(b.callId)) return false;
    seenCalls.add(b.callId);
    return true;
  });
  const views = made.map((b) => serviceView(b.serviceId, shop));
  const known = views.every((v) => v.known);

  return {
    weekStart: bounds.monday.toString(),
    weekEnd: bounds.monday.add({ days: 6 }).toString(),
    callsAnswered: answered.length,
    bookings: made.length,
    revenueCents: known ? views.reduce((sum, v) => sum + (v.known ? v.priceCents : 0), 0) : null,
    revenueFrom: views.some((v) => v.known && v.priceFrom),
    lostCalls: lost.length,
    timeSavedSeconds: timed.length > 0 ? seconds : null,
    timedCalls: timed.length,
  };
}

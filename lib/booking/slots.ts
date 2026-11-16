import { Temporal } from "temporal-polyfill";
import { localDateOf, sessionsOn } from "./time";
import { evaluateWith } from "./rules";
import { resolveService } from "./services";
import type {
  BookingRequest,
  RuleContext,
  Service,
  SessionInstants,
  Slot,
  SlotSearchOptions,
} from "./types";

const DEFAULT_LIMIT = 3;
const DEFAULT_WINDOW_DAYS = 14;

function cachedSessions(ctx: RuleContext): (date: Temporal.PlainDate) => SessionInstants[] {
  const cache = new Map<string, SessionInstants[]>();
  return (date) => {
    const key = date.toString();
    let sessions = cache.get(key);
    if (!sessions) {
      sessions = sessionsOn(date, ctx.shop);
      cache.set(key, sessions);
    }
    return sessions;
  };
}

function candidatesWith(
  service: Service,
  ctx: RuleContext,
  from: Temporal.Instant,
  to: Temporal.Instant,
  sessionsOf: (date: Temporal.PlainDate) => readonly SessionInstants[],
): Temporal.Instant[] {
  const cmp = Temporal.Instant.compare;
  const step = ctx.pack.slotStepMin;
  const out: Temporal.Instant[] = [];
  if (cmp(from, to) > 0 || step <= 0) return out;
  const last = localDateOf(to, ctx.shop.timeZone);
  for (
    let date = localDateOf(from, ctx.shop.timeZone);
    Temporal.PlainDate.compare(date, last) <= 0;
    date = date.add({ days: 1 })
  ) {
    for (const session of sessionsOf(date)) {
      for (let k = 0; ; k++) {
        const start = session.open.add({ minutes: k * step });
        if (cmp(start.add({ minutes: service.durationMin }), session.close) > 0) break;
        if (cmp(start, to) > 0) break;
        if (cmp(start, from) >= 0) out.push(start);
      }
    }
  }
  return out;
}

/**
 * Grid start times for a service inside [from, to], in chronological order:
 * `open + k · slotStepMin` real minutes for each session, as long as the
 * service still ends by the session's close.
 */
export function slotCandidates(
  service: Service,
  ctx: RuleContext,
  from: Temporal.Instant,
  to: Temporal.Instant,
): Temporal.Instant[] {
  return candidatesWith(service, ctx, from, to, cachedSessions(ctx));
}

/**
 * Every grid start of `date`'s sessions (`open + k · slotStepMin` real minutes, the
 * service ending by the close) that `evaluateBooking` accepts for the request, in time
 * order, each once. The owner's Move_Slots (owner-machine 10.3). Two sessions can map to
 * overlapping instants on a DST day, so the starts are sorted and de-duplicated.
 */
export function daySlots(
  req: { serviceId: string; ignoreBookingId?: string },
  date: Temporal.PlainDate,
  ctx: RuleContext,
): Slot[] {
  const service = resolveService(req.serviceId, ctx.shop.services);
  const step = ctx.pack.slotStepMin;
  if (!service || step <= 0) return [];
  const cmp = Temporal.Instant.compare;
  const sessionsOf = cachedSessions(ctx);
  const starts: Temporal.Instant[] = [];
  for (const session of sessionsOf(date)) {
    for (let k = 0; ; k++) {
      const start = session.open.add({ minutes: k * step });
      if (cmp(start.add({ minutes: service.durationMin }), session.close) > 0) break;
      starts.push(start);
    }
  }
  starts.sort(cmp);
  const slots: Slot[] = [];
  let last: number | null = null;
  for (const start of starts) {
    if (start.epochMilliseconds === last) continue;
    last = start.epochMilliseconds;
    const e = evaluateWith({ ...req, start }, ctx, sessionsOf);
    if (e.ok) slots.push({ start: e.start, end: e.end, resourceId: e.resourceId });
  }
  return slots;
}

/** A part of the day as local start minutes, `[fromMin, toMin)`. Morning is `[0, 840)`, afternoon `[840, 1440)`. */
export interface MinuteRange {
  fromMin: number;
  toMin: number;
}

export interface FirstSlotsOptions {
  /** Default 3. */
  limit?: number;
  /** How far the walk goes from `from`, in days of 24 real hours. Default 14. */
  windowDays?: number;
  /** Keep only slots whose local start minute is in `[fromMin, toMin)`. */
  within?: MinuteRange;
}

/**
 * Accepted slots at or after `from`, earliest first, inside `within` (local start minutes
 * in the shop's zone) when given (front-desk-brain 8.1–8.3, the First_Offer). It walks the
 * same grid as `findNearestSlots` (each session's opening plus multiples of `slotStepMin`,
 * the service ending by the close) forward over [from, from + windowDays], and returns the
 * first `limit` starts `evaluateBooking` accepts. A day's starts are sorted and de-duplicated
 * first, because on a spring-forward day two sessions can map to overlapping instants.
 * Pure: `now`, the bookings and the rules all come from `ctx`.
 */
export function firstSlotsFrom(
  req: { serviceId: string; from: Temporal.Instant; ignoreBookingId?: string },
  ctx: RuleContext,
  opts: FirstSlotsOptions = {},
): Slot[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const windowHours = (opts.windowDays ?? DEFAULT_WINDOW_DAYS) * 24;
  const service = resolveService(req.serviceId, ctx.shop.services);
  const step = ctx.pack.slotStepMin;
  if (!service || limit <= 0 || step <= 0) return [];

  const cmp = Temporal.Instant.compare;
  const tz = ctx.shop.timeZone;
  const from = req.from;
  const to = from.add({ hours: windowHours });
  const within = opts.within;
  const inside = (start: Temporal.Instant) => {
    if (!within) return true;
    const z = start.toZonedDateTimeISO(tz);
    const m = z.hour * 60 + z.minute;
    return m >= within.fromMin && m < within.toMin;
  };
  const sessionsOf = cachedSessions(ctx);
  const evalReq = { serviceId: req.serviceId, ignoreBookingId: req.ignoreBookingId };
  const slots: Slot[] = [];
  const last = localDateOf(to, tz);
  let lastMs: number | null = null;

  for (let date = localDateOf(from, tz); Temporal.PlainDate.compare(date, last) <= 0; date = date.add({ days: 1 })) {
    const starts: Temporal.Instant[] = [];
    for (const session of sessionsOf(date)) {
      for (let k = 0; ; k++) {
        const start = session.open.add({ minutes: k * step });
        if (cmp(start.add({ minutes: service.durationMin }), session.close) > 0) break;
        if (cmp(start, to) > 0) break;
        if (cmp(start, from) >= 0) starts.push(start);
      }
    }
    starts.sort(cmp);
    for (const start of starts) {
      // Strictly after the last start looked at: de-duplicates within a day and keeps the
      // whole list increasing across days.
      if (lastMs !== null && start.epochMilliseconds <= lastMs) continue;
      lastMs = start.epochMilliseconds;
      if (!inside(start)) continue;
      const e = evaluateWith({ ...evalReq, start }, ctx, sessionsOf);
      if (e.ok) {
        slots.push({ start: e.start, end: e.end, resourceId: e.resourceId });
        if (slots.length >= limit) return slots;
      }
    }
  }
  return slots;
}

/**
 * Up to `limit` grid slots that `evaluateBooking` accepts, nearest to the
 * requested start in real time (ties: earlier first), inside
 * [max(now, R − windowDays), R + windowDays].
 */
export function findNearestSlots(
  req: BookingRequest,
  ctx: RuleContext,
  opts: SlotSearchOptions = {},
): Slot[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const windowHours = (opts.windowDays ?? DEFAULT_WINDOW_DAYS) * 24;
  const service = resolveService(req.serviceId, ctx.shop.services);
  if (!service || limit <= 0) return [];

  const r = req.start;
  const earliest = r.subtract({ hours: windowHours });
  const from = Temporal.Instant.compare(earliest, ctx.now) < 0 ? ctx.now : earliest;
  const to = r.add({ hours: windowHours });

  const sessionsOf = cachedSessions(ctx);
  const rMs = r.epochMilliseconds;
  const candidates = candidatesWith(service, ctx, from, to, sessionsOf)
    .map((start) => ({ start, distance: Math.abs(start.epochMilliseconds - rMs) }))
    .sort(
      (a, b) => a.distance - b.distance || a.start.epochMilliseconds - b.start.epochMilliseconds,
    );

  const slots: Slot[] = [];
  const seen = new Set<number>();
  for (const { start } of candidates) {
    if (seen.has(start.epochMilliseconds)) continue;
    seen.add(start.epochMilliseconds);
    const e = evaluateWith({ ...req, start }, ctx, sessionsOf);
    if (e.ok) {
      slots.push({ start: e.start, end: e.end, resourceId: e.resourceId });
      if (slots.length >= limit) break;
    }
  }
  return slots;
}

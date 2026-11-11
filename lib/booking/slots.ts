import { Temporal } from "temporal-polyfill";
import { localDateOf, sessionsOn } from "./time";
import { evaluateWith } from "./rules";
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
  const service = ctx.shop.services.find((s) => s.id === req.serviceId);
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

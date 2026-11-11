import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import {
  evaluateBooking,
  type BookingRequest,
  type ExistingBooking,
  type RuleContext,
  type Session,
  type ShopRules,
  type Weekday,
} from "@/lib/booking";
import { allSectorPacks } from "@/lib/sectors";
import { lolaPack, lolaRules } from "../fixtures/lola";

/** Runs per property (design: 200; Requirement 9.8: at least 100). */
export const NUM_RUNS = 200;
/** Request offsets from `now`, in days (design: −3 to +21). */
export const REQUEST_DAYS = { min: -3, max: 21 } as const;
export const TIME_ZONES = [
  "Europe/Madrid",
  "America/New_York",
  "Australia/Lord_Howe", // 30-minute DST shift
  "Asia/Kolkata",
  "UTC",
] as const;
/** Both 2026 Madrid DST weekends. */
export const DST_DATES = ["2026-03-28", "2026-03-29", "2026-10-24", "2026-10-25"] as const;

const MINUTE = 60_000;
const DAY_MIN = 1440;

export interface PackCase {
  id: string;
  pack: RuleContext["pack"];
}
/** The packs the properties run over: every pack in the registry. */
export const PACKS: readonly PackCase[] = allSectorPacks().map((p) => ({
  id: p.id,
  pack: { slotStepMin: p.slotStepMin, rules: p.rules },
}));

export interface ShopCase {
  label: string;
  shop: ShopRules;
  packId: string;
  pack: RuleContext["pack"];
}

export interface Case extends ShopCase {
  now: Temporal.Instant;
  existing: ExistingBooking[];
  req: BookingRequest;
}

export const ctxOf = (c: {
  now: Temporal.Instant;
  shop: ShopRules;
  pack: RuleContext["pack"];
  existing: readonly ExistingBooking[];
}): RuleContext => ({ now: c.now, shop: c.shop, pack: c.pack, existing: c.existing });

// ---------------------------------------------------------------------------
// Shops

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** 1–3 sorted, non-overlapping sessions on 5-minute boundaries, within one local day. */
const arbDaySessions: fc.Arbitrary<Session[]> = fc
  .integer({ min: 1, max: 3 })
  .chain((n) =>
    fc.uniqueArray(fc.integer({ min: 0, max: 287 }), { minLength: 2 * n, maxLength: 2 * n }),
  )
  .map((points) => {
    const sorted = [...points].sort((a, b) => a - b);
    const sessions: Session[] = [];
    for (let k = 0; k < sorted.length; k += 2) {
      sessions.push({ open: hhmm(sorted[k] * 5), close: hhmm(sorted[k + 1] * 5) });
    }
    return sessions;
  });

const arbRandomShop: fc.Arbitrary<ShopRules> = fc
  .record({
    timeZone: fc.constantFrom(...TIME_ZONES),
    openDays: fc.subarray([1, 2, 3, 4, 5, 6, 7] as Weekday[]),
    week: fc.array(arbDaySessions, { minLength: 7, maxLength: 7 }),
    durations: fc.array(fc.integer({ min: 10, max: 180 }), { minLength: 1, maxLength: 4 }),
    resources: fc.integer({ min: 1, max: 3 }),
  })
  .map(({ timeZone, openDays, week, durations, resources }) => {
    const hours: Partial<Record<Weekday, Session[]>> = {};
    for (const d of openDays) hours[d] = week[d - 1];
    return {
      timeZone,
      hours,
      services: durations.map((durationMin, k) => ({ id: `s${k}`, durationMin })),
      resources: Array.from({ length: resources }, (_, k) => ({ id: `r${k}` })),
    };
  });

/** Random shops over every pack, with Peluquería Lola always one of the cases. */
export const arbShop: fc.Arbitrary<ShopCase> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<ShopCase>({ label: "lola", shop: lolaRules, packId: "hair-salon", pack: lolaPack }) },
  {
    weight: 3,
    arbitrary: fc
      .record({ shop: arbRandomShop, p: fc.constantFrom(...PACKS) })
      .map(({ shop, p }) => ({ label: "random", shop, packId: p.id, pack: p.pack })),
  },
);

// ---------------------------------------------------------------------------
// Time

const epochMin = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds / MINUTE;
const instantAtMinute = (m: number) => Temporal.Instant.fromEpochMilliseconds(m * MINUTE);
const minuteRange = (from: string, to: string) =>
  fc.integer({ min: epochMin(from), max: epochMin(to) }).map(instantAtMinute);

/**
 * `now` between 2026-03-20 and 2026-11-05 at minute granularity, with extra
 * weight on the weeks before each Madrid DST weekend so requests land on them.
 */
export const arbNow: fc.Arbitrary<Temporal.Instant> = fc.oneof(
  { weight: 2, arbitrary: minuteRange("2026-03-20T00:00:00Z", "2026-11-05T00:00:00Z") },
  { weight: 1, arbitrary: minuteRange("2026-03-20T00:00:00Z", "2026-03-31T00:00:00Z") },
  { weight: 1, arbitrary: minuteRange("2026-10-04T00:00:00Z", "2026-10-27T00:00:00Z") },
);

/** Wall-clock to instant with Temporal's own field constructor ("compatible"). */
export function wallInstant(date: Temporal.PlainDate, minutes: number, timeZone: string): Temporal.Instant {
  return Temporal.ZonedDateTime.from({
    timeZone,
    year: date.year,
    month: date.month,
    day: date.day,
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
  }).toInstant();
}
const toMinutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const localDate = (i: Temporal.Instant, tz: string) => i.toZonedDateTimeISO(tz).toPlainDate();

/** Oracle: a local date's sessions as epoch milliseconds, built independently of lib/booking/time. */
export function oracleSessions(date: Temporal.PlainDate, shop: ShopRules): { open: number; close: number }[] {
  const sessions = shop.hours[date.dayOfWeek as Weekday] ?? [];
  return sessions.map((s) => ({
    open: wallInstant(date, toMinutes(s.open), shop.timeZone).epochMilliseconds,
    close: wallInstant(date, toMinutes(s.close), shop.timeZone).epochMilliseconds,
  }));
}

// ---------------------------------------------------------------------------
// Requests

const POINTS = ["open", "fit", "close"] as const;

/**
 * A request at minute granularity, within −3 … +21 days of `now`, biased toward
 * session boundaries (open, close − duration, close, ±1 minute) and toward the
 * 2026 DST weekends when they are in range.
 */
export function arbRequest(sc: ShopCase, now: Temporal.Instant): fc.Arbitrary<BookingRequest> {
  const { shop } = sc;
  const today = localDate(now, shop.timeZone);
  return fc
    .record({
      mode: fc.constantFrom("uniform", "uniform", "boundary", "boundary", "dst"),
      offset: fc.integer({ min: REQUEST_DAYS.min * DAY_MIN, max: REQUEST_DAYS.max * DAY_MIN }),
      dayOffset: fc.integer({ min: REQUEST_DAYS.min, max: REQUEST_DAYS.max }),
      sessionIdx: fc.nat(),
      point: fc.constantFrom(...POINTS),
      jitter: fc.integer({ min: -1, max: 1 }),
      minuteOfDay: fc.integer({ min: 0, max: DAY_MIN - 1 }),
      dstIdx: fc.nat(),
      serviceIdx: fc.nat(),
    })
    .map((g) => {
      const service = shop.services[g.serviceIdx % shop.services.length];
      const uniform = now.add({ minutes: g.offset });
      let date = today.add({ days: g.dayOffset });
      if (g.mode === "uniform") return { serviceId: service.id, start: uniform };
      if (g.mode === "dst") {
        const inRange = DST_DATES.map((d) => Temporal.PlainDate.from(d)).filter((d) => {
          const diff = today.until(d, { largestUnit: "days" }).days;
          return diff >= REQUEST_DAYS.min && diff <= REQUEST_DAYS.max;
        });
        if (inRange.length > 0) date = inRange[g.dstIdx % inRange.length];
      }
      const sessions = oracleSessions(date, shop);
      if (sessions.length === 0 || (g.mode === "dst" && g.point === "open" && g.jitter !== 0)) {
        // Closed day (or a plain DST-day time): any minute of that local date.
        return { serviceId: service.id, start: wallInstant(date, g.minuteOfDay, shop.timeZone) };
      }
      const s = sessions[g.sessionIdx % sessions.length];
      const base =
        g.point === "open" ? s.open : g.point === "close" ? s.close : s.close - service.durationMin * MINUTE;
      return {
        serviceId: service.id,
        start: Temporal.Instant.fromEpochMilliseconds(base + g.jitter * MINUTE),
      };
    });
}

/**
 * A request whose start is inside a session and leaves room for the service,
 * on a day after today, whenever the shop has such a session in range.
 */
export function arbValidRequest(sc: ShopCase, now: Temporal.Instant): fc.Arbitrary<BookingRequest> {
  const { shop } = sc;
  const today = localDate(now, shop.timeZone);
  return fc
    .record({
      dayOffset: fc.integer({ min: 1, max: REQUEST_DAYS.max }),
      pick: fc.nat(),
      frac: fc.double({ min: 0, max: 1, noNaN: true }),
      fallback: arbRequest(sc, now),
    })
    .map((g) => {
      // Search forward from the drawn day for a (session, service) pair that fits.
      for (let d = 0; d < REQUEST_DAYS.max; d++) {
        const offset = 1 + ((g.dayOffset - 1 + d) % REQUEST_DAYS.max);
        const pairs = oracleSessions(today.add({ days: offset }), shop).flatMap((s) =>
          shop.services
            .filter((svc) => s.close - s.open >= svc.durationMin * MINUTE)
            .map((svc) => ({ s, svc })),
        );
        if (pairs.length === 0) continue;
        const { s, svc } = pairs[g.pick % pairs.length];
        const room = Math.floor((s.close - s.open) / MINUTE) - svc.durationMin;
        const start = s.open + Math.floor(g.frac * room) * MINUTE;
        return { serviceId: svc.id, start: Temporal.Instant.fromEpochMilliseconds(start) };
      }
      return g.fallback;
    });
}

/** Existing bookings built only from accepted requests, so they never overlap on a resource. */
export function arbExisting(sc: ShopCase, now: Temporal.Instant): fc.Arbitrary<ExistingBooking[]> {
  return fc
    .array(fc.oneof(arbRequest(sc, now), arbValidRequest(sc, now)), { maxLength: 12 })
    .map((reqs) => acceptInOrder(sc, now, reqs).existing);
}

/** Apply requests in order; each accepted one becomes a booking on its assigned resource. */
export function acceptInOrder(
  sc: ShopCase,
  now: Temporal.Instant,
  reqs: readonly BookingRequest[],
  decide: (req: BookingRequest, ctx: RuleContext) => { ok: boolean; resourceId?: string; start?: Temporal.Instant; end?: Temporal.Instant } = evaluateBooking,
): { existing: ExistingBooking[] } {
  const existing: ExistingBooking[] = [];
  reqs.forEach((req, k) => {
    const v = decide(req, ctxOf({ ...sc, now, existing }));
    if (v.ok && v.resourceId && v.start && v.end) {
      existing.push({ id: `b${k}`, resourceId: v.resourceId, start: v.start, end: v.end });
    }
  });
  return { existing };
}

/** The full generated case most properties use. */
export const arbCase: fc.Arbitrary<Case> = arbShop.chain((sc) =>
  arbNow.chain((now) =>
    fc
      .record({ existing: arbExisting(sc, now), req: arbRequest(sc, now) })
      .map(({ existing, req }) => ({ ...sc, now, existing, req })),
  ),
);

// ---------------------------------------------------------------------------
// Exhaustive grid oracle for P4(d)

export interface OracleResult {
  /** Every grid minute in the window (epoch ms). */
  grid: Set<number>;
  /** The accepted grid slot nearest to R (ties: earlier), or null. */
  nearest: number | null;
}

/**
 * Walks every minute of every session in the search window, keeps the minutes
 * on the slot grid (open + k · step, service ends by close), and returns the
 * nearest one that `evaluateBooking` accepts.
 */
export function gridOracle(req: BookingRequest, ctx: RuleContext, windowDays = 14): OracleResult {
  const service = ctx.shop.services.find((s) => s.id === req.serviceId);
  const grid = new Set<number>();
  if (!service) return { grid, nearest: null };
  const r = req.start.epochMilliseconds;
  const from = Math.max(ctx.now.epochMilliseconds, r - windowDays * DAY_MIN * MINUTE);
  const to = r + windowDays * DAY_MIN * MINUTE;
  const step = ctx.pack.slotStepMin * MINUTE;
  const dur = service.durationMin * MINUTE;
  const tz = ctx.shop.timeZone;
  const first = localDate(Temporal.Instant.fromEpochMilliseconds(from), tz).subtract({ days: 1 });
  const last = localDate(Temporal.Instant.fromEpochMilliseconds(to), tz).add({ days: 1 });
  for (let d = first; Temporal.PlainDate.compare(d, last) <= 0; d = d.add({ days: 1 })) {
    for (const s of oracleSessions(d, ctx.shop)) {
      for (let m = s.open; m + dur <= s.close; m += MINUTE) {
        if ((m - s.open) % step !== 0) continue;
        if (m < from || m > to) continue;
        grid.add(m);
      }
    }
  }
  const ordered = [...grid].sort((a, b) => Math.abs(a - r) - Math.abs(b - r) || a - b);
  for (const m of ordered) {
    if (evaluateBooking({ ...req, start: Temporal.Instant.fromEpochMilliseconds(m) }, ctx).ok) {
      return { grid, nearest: m };
    }
  }
  return { grid, nearest: null };
}

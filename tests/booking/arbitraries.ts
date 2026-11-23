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
import { allSectorPacks, getSectorPack, type SectorPack } from "@/lib/sectors";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { AgendaBooking } from "@/lib/owner/agenda";
import { lolaPack, lolaProfile, lolaRules } from "../fixtures/lola";

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
// Service ids, including Service_Combos (front-desk-brain task 2.4)

/** The design's limits, written here again so the oracle does not read them from lib/booking. */
const ORACLE_MAX_PARTS = 3;
const ORACLE_MAX_COMBO_MIN = 480;
/** About 1 request in 3 asks for a Service_Combo when the shop has one. */
const COMBO_ROLLS = 3;

export interface RequestOptions {
  /** Draw Combo_Ids as service ids too. Default true; the owner-machine generators pass false. */
  combos?: boolean;
}

/**
 * Every valid Combo_Id of a shop, built independently of `lib/booking/services`: each
 * subset of 2–3 catalog services in catalog order, joined with "+", whose durations sum
 * to at most 480 minutes.
 */
export function comboIdsOf(shop: ShopRules): string[] {
  const out: string[] = [];
  const s = shop.services;
  const walk = (from: number, picked: number[]) => {
    if (picked.length >= 2) {
      const total = picked.reduce((sum, k) => sum + s[k].durationMin, 0);
      if (total <= ORACLE_MAX_COMBO_MIN) out.push(picked.map((k) => s[k].id).join("+"));
    }
    if (picked.length === ORACLE_MAX_PARTS) return;
    for (let k = from; k < s.length; k++) walk(k + 1, [...picked, k]);
  };
  walk(0, []);
  return out;
}

/**
 * Oracle: the service a generated id stands for. A catalog id is that service; a
 * generated Combo_Id (always valid) is its parts' summed duration. Independent of
 * `resolveService`, so a broken sum in the code cannot hide in the oracle.
 */
export function serviceOf(shop: ShopRules, id: string): { id: string; durationMin: number } | undefined {
  const exact = shop.services.find((s) => s.id === id);
  if (exact) return exact;
  const parts = id.split("+").map((p) => shop.services.find((s) => s.id === p));
  if (parts.length < 2 || parts.some((p) => !p)) return undefined;
  return { id, durationMin: parts.reduce((sum, p) => sum + p!.durationMin, 0) };
}

/** A service id for a draw: a catalog id, or (1 roll in `COMBO_ROLLS`) a Combo_Id when the shop has any. */
export function drawServiceId(shop: ShopRules, idx: number, roll: number, opts: RequestOptions = {}): string {
  const combos = opts.combos === false ? [] : comboIdsOf(shop);
  if (combos.length > 0 && roll % COMBO_ROLLS === 0) return combos[idx % combos.length];
  return shop.services[idx % shop.services.length].id;
}

// ---------------------------------------------------------------------------
// Requests

const POINTS = ["open", "fit", "close"] as const;

/**
 * A request at minute granularity, within −3 … +21 days of `now`, biased toward
 * session boundaries (open, close − duration, close, ±1 minute) and toward the
 * 2026 DST weekends when they are in range. About 1 in 3 asks for a Combo_Id.
 */
export function arbRequest(sc: ShopCase, now: Temporal.Instant, opts: RequestOptions = {}): fc.Arbitrary<BookingRequest> {
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
      comboRoll: fc.nat(),
    })
    .map((g) => {
      const service = serviceOf(shop, drawServiceId(shop, g.serviceIdx, g.comboRoll, opts))!;
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
export function arbValidRequest(sc: ShopCase, now: Temporal.Instant, opts: RequestOptions = {}): fc.Arbitrary<BookingRequest> {
  const { shop } = sc;
  const today = localDate(now, shop.timeZone);
  const catalog = shop.services.map((s) => s.id);
  const combos = opts.combos === false ? [] : comboIdsOf(shop);
  return fc
    .record({
      dayOffset: fc.integer({ min: 1, max: REQUEST_DAYS.max }),
      pick: fc.nat(),
      frac: fc.double({ min: 0, max: 1, noNaN: true }),
      comboRoll: fc.nat(),
      fallback: arbRequest(sc, now, opts),
    })
    .map((g) => {
      // About 1 in 3 asks for a Combo_Id; if no combo fits anywhere, a catalog service.
      const pools =
        combos.length > 0 && g.comboRoll % COMBO_ROLLS === 0 ? [combos, catalog] : [catalog];
      for (const ids of pools) {
        const candidates = ids.map((id) => serviceOf(shop, id)!);
        // Search forward from the drawn day for a (session, service) pair that fits.
        for (let d = 0; d < REQUEST_DAYS.max; d++) {
          const offset = 1 + ((g.dayOffset - 1 + d) % REQUEST_DAYS.max);
          const pairs = oracleSessions(today.add({ days: offset }), shop).flatMap((s) =>
            candidates
              .filter((svc) => s.close - s.open >= svc.durationMin * MINUTE)
              .map((svc) => ({ s, svc })),
          );
          if (pairs.length === 0) continue;
          const { s, svc } = pairs[g.pick % pairs.length];
          const room = Math.floor((s.close - s.open) / MINUTE) - svc.durationMin;
          const start = s.open + Math.floor(g.frac * room) * MINUTE;
          return { serviceId: svc.id, start: Temporal.Instant.fromEpochMilliseconds(start) };
        }
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
  const service = serviceOf(ctx.shop, req.serviceId);
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

// ---------------------------------------------------------------------------
// Owner machine: agendas and moves (owner-machine M7–M10)

/** Move starts are drawn from −2 to +16 days around `now` (design, M7). */
export const MOVE_START_DAYS = { min: -2, max: 16 } as const;

/**
 * The owner-machine generators draw catalog services only: naming a Combo_Id on the owner
 * screens is front-desk-brain task 4.4, so M7–M11 keep the catalog they were written for.
 */
const NO_COMBOS: RequestOptions = { combos: false };

/** The Shop_Profile and Sector_Pack behind a generated shop, so owner code that takes them can run on it. */
export function profileOf(sc: ShopCase): { profile: ShopProfile; sectorPack: SectorPack } {
  const sectorPack = getSectorPack(sc.packId);
  if (sc.label === "lola") return { profile: lolaProfile, sectorPack };
  const hours: Record<number, { open: string; close: string }[]> = {};
  for (const d of [1, 2, 3, 4, 5, 6, 7] as Weekday[]) {
    const day = sc.shop.hours[d];
    if (day && day.length > 0) hours[d] = day.map((s) => ({ open: s.open, close: s.close }));
  }
  const profile: ShopProfile = {
    id: "random-shop",
    name: "Random shop",
    ownerName: "Owner",
    address: "Test street 1",
    timeZone: sc.shop.timeZone,
    sectorPackId: sc.packId,
    languages: ["es", "en"],
    hours: hours as ShopProfile["hours"],
    services: sc.shop.services.map((s) => ({ id: s.id, name: { es: s.id, en: s.id }, durationMin: s.durationMin, priceCents: 0 })),
    resources: sc.shop.resources.map((r) => ({ id: r.id, name: { es: r.id, en: r.id } })),
    speechRate: 1,
  };
  return { profile, sectorPack };
}

export const activeOf = (agenda: readonly AgendaBooking[]): ExistingBooking[] =>
  agenda
    .filter((b) => b.status === "confirmed")
    .map((b) => ({ id: b.id, resourceId: b.resourceId, start: b.start, end: b.end }));

/**
 * An Agenda built only from accepted requests, so its active bookings never overlap on a
 * resource. The requests are accepted at an earlier moment (0 to 3 days before `now`), so
 * some bookings have already started by `now`. Some are cancelled, some confirmed by the
 * Owner. Never empty: if no request was accepted, one booking is made from a raw request.
 */
export function arbAgendaBookings(sc: ShopCase, now: Temporal.Instant): fc.Arbitrary<AgendaBooking[]> {
  return fc
    .oneof(fc.constant(0), fc.integer({ min: 1, max: 3 * DAY_MIN }))
    .chain((lag) => {
      const bookedAt = now.subtract({ minutes: lag });
      return fc.record({
        bookedAt: fc.constant(bookedAt),
        reqs: fc.array(
          fc.oneof(
            arbValidRequest(sc, bookedAt, NO_COMBOS),
            arbValidRequest(sc, bookedAt, NO_COMBOS),
            arbRequest(sc, bookedAt, NO_COMBOS),
          ),
          { minLength: 1, maxLength: 10 },
        ),
        flags: fc.array(
          fc.record({
            cancelled: fc.integer({ min: 0, max: 4 }).map((n) => n === 0),
            confirmed: fc.boolean(),
            revision: fc.integer({ min: 1, max: 9 }),
            cancelledBy: fc.constantFrom<"caller" | "owner">("caller", "owner"),
          }),
          { minLength: 10, maxLength: 10 },
        ),
      });
    })
    .map(({ bookedAt, reqs, flags }) => {
      let { existing } = acceptInOrder(sc, bookedAt, reqs);
      if (existing.length === 0) {
        const req = reqs[0];
        const service = sc.shop.services.find((s) => s.id === req.serviceId) ?? sc.shop.services[0];
        existing = [
          { id: "b0", resourceId: sc.shop.resources[0].id, start: req.start, end: req.start.add({ minutes: service.durationMin }) },
        ];
      }
      return existing.map((e, k): AgendaBooking => {
        const f = flags[k % flags.length];
        const serviceId = reqs[Number(e.id.slice(1))]?.serviceId ?? sc.shop.services[0].id;
        return {
          id: e.id,
          revision: f.revision,
          resourceId: e.resourceId,
          serviceId,
          start: e.start,
          end: e.end,
          status: f.cancelled ? "cancelled" : "confirmed",
          ownerConfirmedAt: f.confirmed ? bookedAt : null,
          cancelledBy: f.cancelled ? f.cancelledBy : null,
          customerName: `Customer ${k}`,
          channel: "voice", noShowAt: null, paidCents: null, priceCents: null, visitNote: "",
          lastOwnerAction: null,
        };
      });
    });
}

/** An Agenda and one booking from it (the one the Owner moves). */
export function arbAgendaBooking(
  sc: ShopCase,
  now: Temporal.Instant,
): fc.Arbitrary<{ agenda: AgendaBooking[]; booking: AgendaBooking }> {
  return fc
    .record({ agenda: arbAgendaBookings(sc, now), pick: fc.nat() })
    .map(({ agenda, pick }) => ({ agenda, booking: agenda[pick % agenda.length] }));
}

/**
 * A move start at minute granularity, −2 … +16 days from `now`: uniform minutes, grid
 * starts of a session, session boundaries ±1 minute, small shifts of the booking's own
 * start (so it overlaps itself), and plain times on the 2026 DST weekends when in range.
 */
export function arbMoveStart(
  sc: ShopCase,
  now: Temporal.Instant,
  around?: { start: Temporal.Instant; serviceId: string },
): fc.Arbitrary<Temporal.Instant> {
  const { shop } = sc;
  const today = localDate(now, shop.timeZone);
  const step = sc.pack.slotStepMin;
  const durationOf = (id: string | undefined, k: number) =>
    (shop.services.find((s) => s.id === id) ?? shop.services[k % shop.services.length]).durationMin;
  return fc
    .record({
      mode: fc.constantFrom("uniform", "grid", "grid", "boundary", "near", "dst"),
      offset: fc.integer({ min: MOVE_START_DAYS.min * DAY_MIN, max: MOVE_START_DAYS.max * DAY_MIN }),
      dayOffset: fc.integer({ min: MOVE_START_DAYS.min, max: MOVE_START_DAYS.max }),
      sessionIdx: fc.nat(),
      k: fc.nat({ max: 200 }),
      point: fc.constantFrom(...POINTS),
      jitter: fc.integer({ min: -1, max: 1 }),
      shift: fc.integer({ min: -8, max: 8 }),
      minuteOfDay: fc.integer({ min: 0, max: DAY_MIN - 1 }),
      dstIdx: fc.nat(),
      serviceIdx: fc.nat(),
    })
    .map((g) => {
      const uniform = now.add({ minutes: g.offset });
      if (g.mode === "uniform") return uniform;
      if (g.mode === "near") {
        if (!around) return uniform;
        return around.start.add({ minutes: g.shift === 0 ? g.jitter : g.shift * (step || 15) });
      }
      let date = today.add({ days: g.dayOffset });
      if (g.mode === "dst") {
        const inRange = DST_DATES.map((d) => Temporal.PlainDate.from(d)).filter((d) => {
          const diff = today.until(d, { largestUnit: "days" }).days;
          return diff >= MOVE_START_DAYS.min && diff <= MOVE_START_DAYS.max;
        });
        if (inRange.length === 0) return uniform;
        date = inRange[g.dstIdx % inRange.length];
        if (g.point !== "open") return wallInstant(date, g.minuteOfDay, shop.timeZone);
      }
      const sessions = oracleSessions(date, shop);
      if (sessions.length === 0) return wallInstant(date, g.minuteOfDay, shop.timeZone);
      const s = sessions[g.sessionIdx % sessions.length];
      const duration = durationOf(around?.serviceId, g.serviceIdx);
      if (g.mode === "grid" || g.mode === "dst") {
        const room = Math.max(0, Math.floor((s.close - s.open) / MINUTE) - duration);
        const kMax = step > 0 ? Math.floor(room / step) : 0;
        return Temporal.Instant.fromEpochMilliseconds(s.open + (g.k % (kMax + 1)) * step * MINUTE);
      }
      const base = g.point === "open" ? s.open : g.point === "close" ? s.close : s.close - duration * MINUTE;
      return Temporal.Instant.fromEpochMilliseconds(base + g.jitter * MINUTE);
    });
}

export interface MoveCase extends ShopCase {
  profile: ShopProfile;
  sectorPack: SectorPack;
  now: Temporal.Instant;
  agenda: AgendaBooking[];
  booking: AgendaBooking;
  start: Temporal.Instant;
}

/**
 * M7: a shop, `now`, an Agenda, a booking among it and a requested start. A third of the
 * starts land on another booking of the Agenda (±1 minute), so the move often finds its
 * own resource busy and must take another one, or none.
 */
export const arbMoveCase: fc.Arbitrary<MoveCase> = arbShop.chain((sc) =>
  arbNow.chain((now) =>
    arbAgendaBooking(sc, now).chain(({ agenda, booking }) => {
      const others = agenda.filter((b) => b.id !== booking.id);
      const onOther =
        others.length === 0
          ? arbMoveStart(sc, now, booking)
          : fc
              .record({ k: fc.nat(), j: fc.integer({ min: -1, max: 1 }) })
              .map(({ k, j }) => others[k % others.length].start.add({ minutes: j }));
      return fc
        .oneof({ weight: 2, arbitrary: arbMoveStart(sc, now, booking) }, { weight: 1, arbitrary: onOther })
        .map((start) => ({ ...sc, ...profileOf(sc), now, agenda, booking, start }));
    }),
  ),
);

export interface DaySlotsCase extends ShopCase {
  profile: ShopProfile;
  sectorPack: SectorPack;
  now: Temporal.Instant;
  agenda: AgendaBooking[];
  booking: AgendaBooking;
  day: Temporal.PlainDate;
}

/** M8: a shop, `now`, an Agenda, a booking among it and one of the 14 move days (DST days preferred when in range). */
export const arbDaySlotsCase: fc.Arbitrary<DaySlotsCase> = arbShop.chain((sc) =>
  arbNow.chain((now) =>
    fc
      .record({ ab: arbAgendaBooking(sc, now), dayIdx: fc.integer({ min: 0, max: 13 }), dst: fc.boolean(), dstIdx: fc.nat() })
      .map(({ ab, dayIdx, dst, dstIdx }) => {
        const today = localDate(now, sc.shop.timeZone);
        const inRange = DST_DATES.map((d) => Temporal.PlainDate.from(d)).filter((d) => {
          const diff = today.until(d, { largestUnit: "days" }).days;
          return diff >= 0 && diff <= 13;
        });
        const day = dst && inRange.length > 0 ? inRange[dstIdx % inRange.length] : today.add({ days: dayIdx });
        return { ...sc, ...profileOf(sc), now, agenda: ab.agenda, booking: ab.booking, day };
      }),
  ),
);

export type AgendaOp =
  | { kind: "call"; k: number; service: number; shift: number }
  | { kind: "move"; target: number; k: number; shift: number }
  | { kind: "cancel"; target: number };

export interface MoveSequenceCase extends ShopCase {
  profile: ShopProfile;
  sectorPack: SectorPack;
  now: Temporal.Instant;
  /** Start times the operations compete for. */
  pool: Temporal.Instant[];
  ops: AgendaOp[];
}

/** M9: 1–40 caller requests, owner moves and cancels, drawn from a small pool of starts so they collide. */
export const arbMoveSequence: fc.Arbitrary<MoveSequenceCase> = arbShop.chain((sc) =>
  arbNow.chain((now) =>
    fc
      .record({
        pool: fc.array(fc.oneof(arbMoveStart(sc, now), arbValidRequest(sc, now, NO_COMBOS).map((r) => r.start)), { minLength: 1, maxLength: 6 }),
        ops: fc.array(
          fc.oneof(
            { weight: 4, arbitrary: fc.record({ kind: fc.constant("call" as const), k: fc.nat(), service: fc.nat(), shift: fc.integer({ min: -20, max: 20 }) }) },
            { weight: 4, arbitrary: fc.record({ kind: fc.constant("move" as const), target: fc.nat(), k: fc.nat(), shift: fc.integer({ min: -20, max: 20 }) }) },
            { weight: 1, arbitrary: fc.record({ kind: fc.constant("cancel" as const), target: fc.nat() }) },
          ),
          { minLength: 1, maxLength: 40 },
        ),
      })
      .map(({ pool, ops }) => ({ ...sc, ...profileOf(sc), now, pool, ops })),
  ),
);

export interface AgendaCase {
  timeZone: string;
  now: Temporal.Instant;
  rows: AgendaBooking[];
}

/**
 * M10: bookings anywhere from 3 days before to 10 days after `now`, not only accepted
 * ones, with extra weight on local midnights ±1 minute and on the DST weekends, in every
 * zone of `arbShop`.
 */
export const arbAgendaCase: fc.Arbitrary<AgendaCase> = fc
  .record({ tz: fc.constantFrom(...TIME_ZONES), now: arbNow })
  .chain(({ tz, now }) => {
    const today = localDate(now, tz);
    const arbStart = fc.oneof(
      fc.integer({ min: -3 * DAY_MIN, max: 10 * DAY_MIN }).map((m) => now.add({ minutes: m })),
      fc
        .record({ d: fc.integer({ min: -1, max: 9 }), j: fc.integer({ min: -1, max: 1 }) })
        .map(({ d, j }) => wallInstant(today.add({ days: d }), 0, tz).add({ minutes: j })),
      fc
        .record({ d: fc.constantFrom(...DST_DATES), m: fc.integer({ min: 0, max: DAY_MIN - 1 }) })
        .map(({ d, m }) => wallInstant(Temporal.PlainDate.from(d), m, tz)),
    );
    return fc
      .array(
        fc.record({
          start: arbStart,
          cancelled: fc.boolean(),
          confirmed: fc.boolean(),
          resource: fc.constantFrom("r0", "r1"),
        }),
        { maxLength: 20 },
      )
      .map((gs) => ({
        timeZone: tz,
        now,
        rows: gs.map(
          (g, k): AgendaBooking => ({
            id: `a${k}`,
            revision: 1,
            resourceId: g.resource,
            serviceId: "s0",
            start: g.start,
            end: g.start.add({ minutes: 30 }),
            status: g.cancelled ? "cancelled" : "confirmed",
            ownerConfirmedAt: g.confirmed ? now : null,
            cancelledBy: g.cancelled ? "caller" : null,
            customerName: `Customer ${k}`,
            channel: "voice", noShowAt: null, paidCents: null, priceCents: null, visitNote: "",
            lastOwnerAction: null,
          }),
        ),
      }));
  });

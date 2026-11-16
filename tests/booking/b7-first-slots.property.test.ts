import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { evaluateBooking, firstSlotsFrom, type MinuteRange, type RuleContext } from "@/lib/booking";
import { NUM_RUNS, arbCase, comboIdsOf, ctxOf, oracleSessions, serviceOf, type Case } from "./arbitraries";

const MINUTE = 60_000;
const WINDOW_MS = 14 * 24 * 60 * MINUTE;
const MORNING: MinuteRange = { fromMin: 0, toMin: 840 };
const AFTERNOON: MinuteRange = { fromMin: 840, toMin: 1440 };

/**
 * Oracle: the local start minute of an instant through `Intl`, not Temporal, so a zone
 * mistake in the code cannot hide in the oracle.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
function localMinute(ms: number, timeZone: string): number {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return get("hour") * 60 + get("minute");
}

/**
 * Oracle: every grid start in [from, from + 14 days] (each session's opening plus a
 * multiple of the step, walked minute by minute, the service ending by the close), inside
 * `within`, in increasing order, kept while `evaluateBooking` accepts it, up to `limit`.
 */
function oracleFirst(
  serviceId: string,
  from: number,
  within: MinuteRange | null,
  limit: number,
  ctx: RuleContext,
): { accepted: number[]; skippedByWithin: number } {
  const service = serviceOf(ctx.shop, serviceId);
  if (!service || limit <= 0) return { accepted: [], skippedByWithin: 0 };
  const to = from + WINDOW_MS;
  const step = ctx.pack.slotStepMin * MINUTE;
  const dur = service.durationMin * MINUTE;
  const tz = ctx.shop.timeZone;
  const localDate = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tz).toPlainDate();
  const grid = new Set<number>();
  const last = localDate(to).add({ days: 1 });
  for (let d = localDate(from).subtract({ days: 1 }); Temporal.PlainDate.compare(d, last) <= 0; d = d.add({ days: 1 })) {
    for (const s of oracleSessions(d, ctx.shop)) {
      for (let m = s.open; m + dur <= s.close; m += MINUTE) {
        if ((m - s.open) % step === 0 && m >= from && m <= to) grid.add(m);
      }
    }
  }
  const accepted: number[] = [];
  let skippedByWithin = 0;
  for (const m of [...grid].sort((a, b) => a - b)) {
    const ok = evaluateBooking({ serviceId, start: Temporal.Instant.fromEpochMilliseconds(m) }, ctx).ok;
    if (!ok) continue;
    const lm = localMinute(m, tz);
    if (within && (lm < within.fromMin || lm >= within.toMin)) {
      if (accepted.length === 0) skippedByWithin++;
      continue;
    }
    accepted.push(m);
    if (accepted.length >= limit) break;
  }
  return { accepted, skippedByWithin };
}

interface B7Case extends Case {
  from: Temporal.Instant;
  within: MinuteRange | null;
  limit: number;
}

/**
 * `from` is the generated request's start (−3 … +21 days of `now`, biased to session
 * boundaries and the DST weekends), `now` itself, or a few hours after `now`; the service
 * is the request's (a Combo_Id about 1 time in 4). `within` is none, morning, afternoon or
 * a random range.
 */
const arbB7: fc.Arbitrary<B7Case> = arbCase.chain((c) =>
  fc
    .record({
      fromMode: fc.constantFrom("request", "request", "now", "soon"),
      soon: fc.integer({ min: 1, max: 72 * 60 }),
      within: fc.oneof(
        fc.constant<MinuteRange | null>(null),
        fc.constant<MinuteRange | null>(MORNING),
        fc.constant<MinuteRange | null>(AFTERNOON),
        fc
          .tuple(fc.integer({ min: 0, max: 1440 }), fc.integer({ min: 0, max: 1440 }))
          .map(([a, b]): MinuteRange | null => ({ fromMin: Math.min(a, b), toMin: Math.max(a, b) })),
      ),
      limit: fc.integer({ min: 1, max: 5 }),
    })
    .map((g) => ({
      ...c,
      from: g.fromMode === "request" ? c.req.start : g.fromMode === "now" ? c.now : c.now.add({ minutes: g.soon }),
      within: g.within,
      limit: g.limit,
    })),
);

// B7. The first slots from a time are the first ones the rules accept. Validates 8.1–8.3
// (front-desk-brain), the property test of the new lib/booking rule firstSlotsFrom.
describe("B7: firstSlotsFrom returns the first accepted grid slots from `from`", () => {
  it("sound, increasing, inside `within`, and nothing accepted is skipped", { timeout: 300_000 }, () => {
    const reached = { nonEmpty: 0, empty: 0, full: 0, withinSkipped: 0, fromBeforeNow: 0, fromAfterNow: 0, combo: 0 };
    fc.assert(
      fc.property(arbB7, (c) => {
        const ctx = ctxOf(c);
        const serviceId = c.req.serviceId;
        const opts = c.within ? { limit: c.limit, within: c.within } : { limit: c.limit };
        const slots = firstSlotsFrom({ serviceId, from: c.from }, ctx, opts);
        const service = serviceOf(c.shop, serviceId)!;
        const starts = slots.map((s) => s.start.epochMilliseconds);

        // Sound: accepted by evaluateBooking with the same context, on the resource it names.
        for (const s of slots) {
          const e = evaluateBooking({ serviceId, start: s.start }, ctx);
          expect(e.ok).toBe(true);
          expect(e.ok && e.resourceId).toBe(s.resourceId);
          expect(s.end.epochMilliseconds).toBe(s.start.epochMilliseconds + service.durationMin * MINUTE);
        }
        // At or after `from`, inside the window and inside `within`; at most `limit`.
        expect(slots.length).toBeLessThanOrEqual(c.limit);
        for (const ms of starts) {
          expect(ms).toBeGreaterThanOrEqual(c.from.epochMilliseconds);
          expect(ms).toBeLessThanOrEqual(c.from.epochMilliseconds + WINDOW_MS);
          if (c.within) {
            const lm = localMinute(ms, c.shop.timeZone);
            expect(lm >= c.within.fromMin && lm < c.within.toMin).toBe(true);
          }
        }
        // Strictly increasing.
        for (let k = 1; k < starts.length; k++) expect(starts[k]).toBeGreaterThan(starts[k - 1]);

        // Complete: the exhaustive grid scan finds exactly these, so no accepted slot inside
        // `within` comes before the first one, or between two returned ones.
        const oracle = oracleFirst(serviceId, c.from.epochMilliseconds, c.within, c.limit, ctx);
        expect(starts).toEqual(oracle.accepted);

        if (slots.length > 0) reached.nonEmpty++;
        else reached.empty++;
        if (slots.length === c.limit) reached.full++;
        if (oracle.skippedByWithin > 0) reached.withinSkipped++;
        if (c.from.epochMilliseconds < c.now.epochMilliseconds) reached.fromBeforeNow++;
        if (c.from.epochMilliseconds > c.now.epochMilliseconds) reached.fromAfterNow++;
        if (comboIdsOf(c.shop).includes(serviceId)) reached.combo++;
      }),
      { numRuns: NUM_RUNS },
    );
    // Every branch the property is about was reached, so it cannot pass without testing anything.
    for (const [branch, n] of Object.entries(reached)) expect(n, branch).toBeGreaterThan(0);
  });
});

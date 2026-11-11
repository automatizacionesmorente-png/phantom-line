import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { checkBooking, evaluateBooking, type ExistingBooking } from "@/lib/booking";
import { NUM_RUNS, arbNow, arbShop, arbValidRequest, ctxOf } from "./arbitraries";

const MINUTE = 60_000;
const at = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms);

/** Per resource: overlapping blockers, back-to-back neighbours, or nothing. */
const arbResourcePlan = fc.record({
  busy: fc.boolean(),
  blockerLen: fc.integer({ min: 1, max: 180 }),
  blockerShift: fc.double({ min: 0, max: 1, noNaN: true }),
  before: fc.boolean(), // a booking ending exactly at the start
  after: fc.boolean(), // a booking starting exactly at the end
});

const arbP6 = arbShop.chain((sc) =>
  arbNow.chain((now) =>
    fc
      .record({
        req: arbValidRequest(sc, now),
        allBusy: fc.boolean(),
        plans: fc.array(arbResourcePlan, { minLength: 3, maxLength: 3 }),
        ignore: fc.option(fc.nat(), { nil: undefined }),
      })
      .map((g) => ({ ...sc, now, ...g })),
  ),
);

// P6. Busy everywhere is rejected; busy somewhere is not. Validates 9.6 (and 5.4, 5.12).
describe("P6: resources", () => {
  it("rejected exactly when every resource is busy; otherwise the first free resource", { timeout: 120_000 }, () => {
    let applied = 0;
    fc.assert(
      fc.property(arbP6, (g) => {
        const base = ctxOf({ ...g, existing: [] });
        // Only requests that pass rules 1–6 (no bookings involved yet).
        if (!evaluateBooking(g.req, base).ok) return;
        applied++;
        const service = g.shop.services.find((s) => s.id === g.req.serviceId)!;
        const s = g.req.start.epochMilliseconds;
        const e = s + service.durationMin * MINUTE;

        const existing: ExistingBooking[] = [];
        const blockers: string[] = [];
        g.shop.resources.forEach((res, k) => {
          const p = g.plans[k];
          if (g.allBusy || p.busy) {
            // Overlaps [s, e): starts anywhere in [s − len + 1, e − 1] minutes.
            const span = p.blockerLen + service.durationMin - 2;
            const bs = s - (p.blockerLen - 1) * MINUTE + Math.floor(p.blockerShift * span) * MINUTE;
            const id = `block-${res.id}`;
            existing.push({ id, resourceId: res.id, start: at(bs), end: at(bs + p.blockerLen * MINUTE) });
            blockers.push(id);
          }
          if (p.before) existing.push({ id: `before-${res.id}`, resourceId: res.id, start: at(s - 30 * MINUTE), end: at(s) });
          if (p.after) existing.push({ id: `after-${res.id}`, resourceId: res.id, start: at(e), end: at(e + 30 * MINUTE) });
        });
        const ignoreBookingId = g.ignore === undefined || blockers.length === 0 ? undefined : blockers[g.ignore % blockers.length];
        const req = { ...g.req, ignoreBookingId };

        const busy = new Set(
          existing
            .filter((b) => b.id !== ignoreBookingId)
            .filter((b) => b.start.epochMilliseconds < e && s < b.end.epochMilliseconds)
            .map((b) => b.resourceId),
        );
        const free = g.shop.resources.filter((r) => !busy.has(r.id));
        const v = checkBooking(req, { ...base, existing });
        if (free.length === 0) {
          expect(v.ok).toBe(false);
          expect(!v.ok && v.reason).toBe("all_resources_busy");
        } else {
          expect(v.ok).toBe(true);
          expect(v.ok && v.resourceId).toBe(free[0].id);
          expect(busy.has(v.ok ? v.resourceId : "")).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
    // The generator must actually exercise the property.
    expect(applied).toBeGreaterThanOrEqual(NUM_RUNS / 2);
  });
});

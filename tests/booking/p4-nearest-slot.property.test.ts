import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkBooking, evaluateBooking, type ShopRules, type Weekday } from "@/lib/booking";
import { NUM_RUNS, arbCase, ctxOf, gridOracle } from "./arbitraries";

const MINUTE = 60_000;
const WINDOW = 14 * 24 * 60 * MINUTE;
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/**
 * "At least one weekly session long enough for the service". The extra 60
 * minutes cover the hour a session can lose on a spring-forward day, which can
 * be the only full occurrence of that weekday inside the window.
 */
function hasLongEnoughSession(shop: ShopRules, durationMin: number): boolean {
  return ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).some((d) =>
    (shop.hours[d] ?? []).some((s) => toMin(s.close) - toMin(s.open) >= durationMin + 60),
  );
}

// P4. A rejection comes with the nearest valid grid slot. Validates 9.4 (and 5.5).
describe("P4: rejections come with the nearest valid slot", () => {
  it("clauses (a) to (e)", { timeout: 300_000 }, () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const ctx = ctxOf(c);
        const v = checkBooking(c.req, ctx);
        if (v.ok || v.reason === "unknown_service") return;
        const service = c.shop.services.find((s) => s.id === c.req.serviceId)!;
        const r = c.req.start.epochMilliseconds;
        const alts = v.alternatives;
        const dist = (ms: number) => Math.abs(ms - r);

        // (a) every alternative is accepted by evaluateBooking with the same context,
        //     on the resource it names.
        for (const a of alts) {
          const e = evaluateBooking({ ...c.req, start: a.start }, ctx);
          expect(e.ok).toBe(true);
          expect(e.ok && e.resourceId).toBe(a.resourceId);
          expect(a.end.epochMilliseconds).toBe(a.start.epochMilliseconds + service.durationMin * MINUTE);
        }
        // (b) inside [max(now, R − 14 d), R + 14 d].
        const from = Math.max(c.now.epochMilliseconds, r - WINDOW);
        for (const a of alts) {
          expect(a.start.epochMilliseconds).toBeGreaterThanOrEqual(from);
          expect(a.start.epochMilliseconds).toBeLessThanOrEqual(r + WINDOW);
        }
        // (c) distinct, at most 3, sorted by |start − R| with ties to the earlier start.
        expect(alts.length).toBeLessThanOrEqual(3);
        const starts = alts.map((a) => a.start.epochMilliseconds);
        expect(new Set(starts).size).toBe(starts.length);
        for (let k = 1; k < starts.length; k++) {
          const prev = starts[k - 1];
          const cur = starts[k];
          expect(dist(prev) < dist(cur) || (dist(prev) === dist(cur) && prev < cur)).toBe(true);
        }
        // (d) exhaustive minute-by-minute oracle over the slot grid.
        const oracle = gridOracle(c.req, ctx);
        for (const s of starts) expect(oracle.grid.has(s)).toBe(true);
        if (oracle.nearest === null) {
          expect(alts).toEqual([]);
        } else {
          expect(alts.length).toBeGreaterThan(0);
          expect(dist(starts[0])).toBeLessThanOrEqual(dist(oracle.nearest));
          expect(starts[0]).toBe(oracle.nearest);
        }
        // (e) with no existing bookings the list is non-empty.
        if (hasLongEnoughSession(c.shop, service.durationMin)) {
          const empty = checkBooking(c.req, { ...ctx, existing: [] });
          if (!empty.ok) expect(empty.alternatives.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

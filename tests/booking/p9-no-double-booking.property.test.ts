import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkBooking, overlaps, type BookingRequest, type ExistingBooking } from "@/lib/booking";
import { NUM_RUNS, arbNow, arbRequest, arbShop, arbValidRequest, ctxOf, drawServiceId } from "./arbitraries";

/**
 * Sequences of 1–40 requests drawn from a small pool of start times, so many
 * requests compete for the same resource at the same time.
 */
const arbSequence = arbShop.chain((sc) =>
  arbNow.chain((now) =>
    fc
      .record({
        pool: fc.array(fc.oneof(arbRequest(sc, now), arbValidRequest(sc, now)), { minLength: 1, maxLength: 8 }),
        picks: fc.array(
          fc.record({ k: fc.nat(), service: fc.nat(), combo: fc.nat(), shift: fc.integer({ min: -20, max: 20 }) }),
          { minLength: 1, maxLength: 40 },
        ),
      })
      .map(({ pool, picks }) => ({
        ...sc,
        now,
        reqs: picks.map(({ k, service, combo, shift }): BookingRequest => ({
          // A catalog service or, about 1 in 3, a Combo_Id (task 2.4).
          serviceId: drawServiceId(sc.shop, service, combo),
          start: pool[k % pool.length].start.add({ minutes: shift % 3 === 0 ? shift : 0 }),
        })),
      })),
  ),
);

// P9. No two accepted bookings share a resource and overlap. Validates 9.9 and 5.11.
describe("P9: no double booking", () => {
  it("applying 1–40 requests in order never double-books a resource", { timeout: 300_000 }, () => {
    let acceptedPairs = 0;
    fc.assert(
      fc.property(arbSequence, (g) => {
        const accepted: ExistingBooking[] = [];
        g.reqs.forEach((req, k) => {
          const v = checkBooking(req, ctxOf({ ...g, existing: accepted }));
          if (v.ok) accepted.push({ id: `b${k}`, resourceId: v.resourceId, start: v.start, end: v.end });
        });
        for (let a = 0; a < accepted.length; a++) {
          for (let b = a + 1; b < accepted.length; b++) {
            acceptedPairs++;
            const x = accepted[a];
            const y = accepted[b];
            expect(x.resourceId !== y.resourceId || !overlaps(x, y)).toBe(true);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
    expect(acceptedPairs).toBeGreaterThan(0);
  });
});

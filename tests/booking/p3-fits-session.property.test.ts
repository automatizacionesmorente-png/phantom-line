import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkBooking } from "@/lib/booking";
import { NUM_RUNS, arbCase, arbShop, arbNow, arbExisting, arbValidRequest, ctxOf, oracleSessions } from "./arbitraries";

const MINUTE = 60_000;

/** Mostly requests that start inside a session, so acceptances are common. */
const arbMostlyValid = arbShop.chain((sc) =>
  arbNow.chain((now) =>
    fc
      .record({ existing: arbExisting(sc, now), req: arbValidRequest(sc, now) })
      .map(({ existing, req }) => ({ ...sc, now, existing, req })),
  ),
);

// P3. An accepted service ends by its session's close, using real-time arithmetic. Validates 9.3 (and 5.2).
describe("P3: accepted services end by the session's close", () => {
  it("there is a session with open <= start and start + duration <= close", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(fc.oneof(arbCase, arbMostlyValid), (c) => {
        const v = checkBooking(c.req, ctxOf(c));
        if (!v.ok) return;
        const service = c.shop.services.find((s) => s.id === c.req.serviceId)!;
        const start = c.req.start.epochMilliseconds;
        const end = start + service.durationMin * MINUTE; // real minutes, not wall-clock
        const date = c.req.start.toZonedDateTimeISO(c.shop.timeZone).toPlainDate();
        const fits = oracleSessions(date, c.shop).some((s) => s.open <= start && end <= s.close);
        expect(fits).toBe(true);
        expect(v.end.epochMilliseconds).toBe(end);
        expect(c.shop.resources.map((r) => r.id)).toContain(v.resourceId);
        // No accepted booking breaks a pack rule (sector-packs.md).
        for (const rule of c.pack.rules) {
          expect(rule({ service, start: v.start, end: v.end, session: v.session, timeZone: c.shop.timeZone }).ok).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

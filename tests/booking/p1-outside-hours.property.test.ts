import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkBooking } from "@/lib/booking";
import { NUM_RUNS, arbCase, ctxOf, oracleSessions } from "./arbitraries";

// P1. Outside opening hours is rejected. Validates 9.1 (and 5.6).
describe("P1: outside opening hours is rejected", () => {
  it("rejects every start that no session of its local date contains", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const date = c.req.start.toZonedDateTimeISO(c.shop.timeZone).toPlainDate();
        const s = c.req.start.epochMilliseconds;
        const inside = oracleSessions(date, c.shop).some((x) => x.open <= s && s < x.close);
        if (inside) return;
        expect(checkBooking(c.req, ctxOf(c)).ok).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

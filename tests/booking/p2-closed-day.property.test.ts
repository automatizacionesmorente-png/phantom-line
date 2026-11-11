import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkBooking, type Weekday } from "@/lib/booking";
import { NUM_RUNS, arbCase, ctxOf } from "./arbitraries";

// P2. Closed weekdays are rejected. Validates 9.2.
describe("P2: closed weekdays are rejected", () => {
  it("a request on a weekday with no sessions is closed_day, or an earlier reason", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const weekday = c.req.start.toZonedDateTimeISO(c.shop.timeZone).dayOfWeek as Weekday;
        if ((c.shop.hours[weekday] ?? []).length > 0) return;
        const v = checkBooking(c.req, ctxOf(c));
        expect(v.ok).toBe(false);
        expect(["unknown_service", "in_the_past", "closed_day"]).toContain(!v.ok && v.reason);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

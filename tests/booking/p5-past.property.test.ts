import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkBooking } from "@/lib/booking";
import { NUM_RUNS, arbCase, ctxOf } from "./arbitraries";

// P5. The past is rejected. Validates 9.5 (and 5.3).
describe("P5: the past is rejected", () => {
  it("any start before now is in_the_past (or unknown_service)", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(arbCase, fc.integer({ min: 1, max: 3 * 1440 }), (c, back) => {
        // Every run applies: mirror future requests into the past, keep past ones.
        const start =
          c.req.start.epochMilliseconds < c.now.epochMilliseconds ? c.req.start : c.now.subtract({ minutes: back });
        const v = checkBooking({ ...c.req, start }, ctxOf(c));
        expect(v.ok).toBe(false);
        expect(["in_the_past", "unknown_service"]).toContain(!v.ok && v.reason);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a start exactly at now is never rejected as in_the_past", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const v = checkBooking({ ...c.req, start: c.now }, ctxOf(c));
        expect(!v.ok && v.reason).not.toBe("in_the_past");
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

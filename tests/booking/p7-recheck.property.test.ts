import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkBooking } from "@/lib/booking";
import { NUM_RUNS, arbCase, ctxOf, type Case } from "./arbitraries";

// Temporal objects have no own enumerable fields, so compare their JSON (toJSON = ISO string).
const json = (v: unknown) => JSON.stringify(v);

const arbWithShuffle = arbCase.chain((c) =>
  fc
    .shuffledSubarray(c.existing, { minLength: c.existing.length, maxLength: c.existing.length })
    .map((shuffled): [Case, Case] => [c, { ...c, existing: shuffled }]),
);

// P7. A re-check gives the same verdict, also with `existing` shuffled. Validates 9.7 (and 5.9).
describe("P7: re-checking gives the same verdict", () => {
  it("same context twice, and with existing bookings shuffled", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(arbWithShuffle, ([c, shuffled]) => {
        const first = checkBooking(c.req, ctxOf(c));
        const again = checkBooking(c.req, ctxOf(c));
        const reordered = checkBooking(c.req, ctxOf(shuffled));
        expect(json(again)).toBe(json(first));
        expect(json(reordered)).toBe(json(first));
        if (first.ok) {
          // Server re-validation of an accepted request: accepted again, same resource.
          expect(again.ok && again.resourceId).toBe(first.resourceId);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkBooking } from "@/lib/booking";
import { NUM_RUNS, arbCase, ctxOf } from "./arbitraries";

// S1. An unknown serviceId is always rejected as unknown_service. Validates 5.7.
describe("S1: unknown services", () => {
  it("any serviceId outside the catalog is unknown_service, with no alternatives", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(arbCase, fc.string({ maxLength: 20 }), (c, raw) => {
        const ids = new Set(c.shop.services.map((s) => s.id));
        const serviceId = ids.has(raw) ? `${raw}-not-offered` : raw;
        const v = checkBooking({ ...c.req, serviceId }, ctxOf(c));
        expect(v).toEqual({ ok: false, reason: "unknown_service", alternatives: [] });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

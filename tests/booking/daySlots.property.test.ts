import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { daySlots, evaluateBooking, slotCandidates } from "@/lib/booking";
import { moveContext } from "@/lib/owner/move";
import { NUM_RUNS, activeOf, arbDaySlotsCase, oracleSessions, wallInstant } from "./arbitraries";

const MINUTE = 60_000;

// M8. Move_Slots are exactly the accepted grid slots of the day. Validates 10.3, 15.4.
// With M7, the property test of the new lib/booking rules daySlots and preferResource.
describe("M8: daySlots are exactly the accepted grid starts of the day", () => {
  it("sound, complete, in time order, no duplicates", { timeout: 300_000 }, () => {
    let nonEmpty = 0;
    fc.assert(
      fc.property(arbDaySlotsCase, (c) => {
        const existing = activeOf(c.agenda);
        const ctx = moveContext(c.booking, c.profile, c.sectorPack, c.now, existing);
        const req = { serviceId: c.booking.serviceId, ignoreBookingId: c.booking.id };
        const slots = daySlots(req, c.day, ctx);
        const service = c.shop.services.find((s) => s.id === req.serviceId)!;
        const step = c.pack.slotStepMin * MINUTE;
        const sessions = oracleSessions(c.day, c.shop);
        if (slots.length > 0) nonEmpty++;

        // Sound: each slot is accepted with the same context, on its resource, on the day's grid.
        for (const s of slots) {
          const e = evaluateBooking({ ...req, start: s.start }, ctx);
          expect(e.ok).toBe(true);
          if (e.ok) {
            expect(e.resourceId).toBe(s.resourceId);
            expect(e.end.equals(s.end)).toBe(true);
          }
          const ms = s.start.epochMilliseconds;
          expect(
            sessions.some((x) => ms >= x.open && (ms - x.open) % step === 0 && ms + service.durationMin * MINUTE <= x.close),
          ).toBe(true);
        }

        // Strictly increasing: time order, no duplicates.
        for (let k = 1; k < slots.length; k++) {
          expect(Temporal.Instant.compare(slots[k - 1].start, slots[k].start)).toBe(-1);
        }

        // Complete: every grid start of the whole local day that the rules accept is listed.
        const from = wallInstant(c.day, 0, c.shop.timeZone);
        const to = wallInstant(c.day.add({ days: 1 }), 0, c.shop.timeZone).subtract({ nanoseconds: 1 });
        const listed = new Set(slots.map((s) => s.start.epochMilliseconds));
        for (const start of slotCandidates(service, ctx, from, to)) {
          if (!start.toZonedDateTimeISO(c.shop.timeZone).toPlainDate().equals(c.day)) continue;
          if (evaluateBooking({ ...req, start }, ctx).ok) expect(listed.has(start.epochMilliseconds)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
    expect(nonEmpty).toBeGreaterThan(0);
  });
});

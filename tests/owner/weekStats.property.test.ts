import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { serviceView } from "@/lib/conversation/catalog";
import { computeWeekStats, weekBounds, type WeekBooking, type WeekCall } from "@/lib/owner/weekStats";
import { arbNow, DST_DATES } from "../booking/arbitraries";
import { lolaProfile } from "../fixtures/lola";
import { NUM_RUNS } from "../messages/arbitraries";

const shop = { timeZone: lolaProfile.timeZone, hours: lolaProfile.hours, services: lolaProfile.services };
const NOW = Temporal.Instant.from("2026-11-26T11:00:00Z");
const BASE = NOW.epochMilliseconds - 8 * 24 * 3600_000;
const SERVICES = ["haircut", "colour", "beard", "haircut+beard", "colour+beard", "nope"];
const STATUSES = ["open", "completed", "abandoned", "failed"];

const arbInstant = fc.integer({ min: 0, max: 16 * 24 * 3600 }).map((s) => Temporal.Instant.fromEpochMilliseconds(BASE + s * 1000));
const arbCall = fc
  .record({
    n: fc.integer({ min: 0, max: 40 }),
    status: fc.constantFrom(...STATUSES),
    startedAt: arbInstant,
    seconds: fc.integer({ min: -600, max: 3600 }),
    ended: fc.boolean(),
  })
  .map((c): WeekCall => {
    const end = c.startedAt.add({ seconds: c.seconds });
    return { id: `c${c.n}`, status: c.status, startedAt: c.startedAt, updatedAt: end, endedAt: c.ended ? end : null };
  });
const arbBooking = fc
  .record({
    n: fc.integer({ min: 0, max: 40 }),
    serviceId: fc.constantFrom(...SERVICES.slice(0, 5)),
    callN: fc.option(fc.integer({ min: 0, max: 12 }), { nil: null }),
    reschedule: fc.boolean(),
    status: fc.constantFrom("confirmed", "cancelled"),
    createdAt: arbInstant,
  })
  .map((b): WeekBooking => ({
    id: `b${b.n}`,
    serviceId: b.serviceId,
    callId: b.callN === null ? null : `c${b.callN}`,
    rescheduledFrom: b.reschedule ? "old" : null,
    status: b.status,
    createdAt: b.createdAt,
  }));
const arbRows = fc.record({ calls: fc.array(arbCall, { maxLength: 30 }), bookings: fc.array(arbBooking, { maxLength: 30 }) });

describe("computeWeekStats properties", () => {
  it("never shows a negative number, and lost calls are answered calls", () => {
    fc.assert(
      fc.property(arbRows, ({ calls, bookings }) => {
        const s = computeWeekStats({ now: NOW, shop, calls, bookings });
        for (const v of [s.callsAnswered, s.bookings, s.lostCalls, s.timedCalls]) expect(v).toBeGreaterThanOrEqual(0);
        if (s.revenueCents !== null) expect(s.revenueCents).toBeGreaterThanOrEqual(0);
        if (s.timeSavedSeconds !== null) expect(s.timeSavedSeconds).toBeGreaterThanOrEqual(0);
        expect(s.lostCalls).toBeLessThanOrEqual(s.callsAnswered);
        expect(s.timedCalls).toBeLessThanOrEqual(s.callsAnswered);
        expect(s.timeSavedSeconds === null).toBe(s.timedCalls === 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("revenue is the sum of the catalogue prices of the bookings counted", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...SERVICES), { maxLength: 12 }), (ids) => {
        const bookings = ids.map(
          (serviceId, i): WeekBooking => ({
            id: `b${i}`,
            serviceId,
            callId: `c${i}`,
            rescheduledFrom: null,
            status: "confirmed",
            createdAt: NOW.subtract({ hours: 5 }),
          }),
        );
        const s = computeWeekStats({ now: NOW, shop, calls: [], bookings });
        expect(s.bookings).toBe(ids.length);
        const views = ids.map((id) => serviceView(id, shop));
        if (views.every((v) => v.known)) {
          expect(s.revenueCents).toBe(views.reduce((sum, v) => sum + (v.known ? v.priceCents : 0), 0));
        } else {
          expect(s.revenueCents).toBeNull();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("counts each booking and each call once, however many times a row is listed", () => {
    fc.assert(
      fc.property(arbRows, ({ calls, bookings }) => {
        const once = computeWeekStats({ now: NOW, shop, calls, bookings });
        const twice = computeWeekStats({ now: NOW, shop, calls: [...calls, ...calls], bookings: [...bookings, ...bookings] });
        expect(twice).toEqual(once);
        const callIds = new Set(bookings.filter((b) => b.callId !== null).map((b) => b.callId));
        expect(once.bookings).toBeLessThanOrEqual(callIds.size);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("the week holds exactly the instants from Monday 00:00 to the next Monday 00:00 local, DST weeks included", () => {
    fc.assert(
      fc.property(fc.oneof(arbNow, fc.constantFrom(...DST_DATES).chain((d) => fc.integer({ min: 0, max: 7 * 24 }).map((h) => Temporal.Instant.from(`${d}T00:00:00Z`).add({ hours: h })))), (at) => {
        const tz = shop.timeZone;
        const b = weekBounds(at, tz);
        const local = (i: Temporal.Instant) => i.toZonedDateTimeISO(tz);
        expect(Temporal.Instant.compare(b.start, at)).toBeLessThanOrEqual(0);
        expect(Temporal.Instant.compare(at, b.end)).toBeLessThan(0);
        expect(local(b.start).dayOfWeek).toBe(1);
        expect(local(b.start).toPlainTime().toString()).toBe("00:00:00");
        expect(local(b.end).dayOfWeek).toBe(1);
        expect(local(b.end).toPlainTime().toString()).toBe("00:00:00");
        expect(local(b.end).toPlainDate().since(local(b.start).toPlainDate()).days).toBe(7);
        // The instant just before the end is still in this week, and the end opens the next.
        expect(weekBounds(b.end.subtract({ milliseconds: 1 }), tz).start.equals(b.start)).toBe(true);
        expect(weekBounds(b.end, tz).start.equals(b.end)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

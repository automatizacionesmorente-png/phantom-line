import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { lapsedClients, type LapsedInput, lapseThresholdDays } from "@/lib/clients/lapsed";
import { summarize, type ClientBooking } from "@/lib/clients/summary";

/** BACKLOG 15: the list of clients who have not come back is decided by code. */
const NOW = Temporal.Instant.from("2026-11-10T08:00:00Z");
const DAY = 86_400_000;
const at = (daysFromNow: number) => Temporal.Instant.fromEpochMilliseconds(NOW.epochMilliseconds + Math.round(daysFromNow * DAY));

/** One booking: when it starts (days from now, -400 to +30), how long it lasts, and its state. */
const bookingArb = fc
  .record({
    id: fc.uuid(),
    startDays: fc.integer({ min: -400, max: 30 }),
    minutes: fc.integer({ min: 15, max: 180 }),
    status: fc.constantFrom("confirmed", "confirmed", "confirmed", "cancelled"),
    noShow: fc.boolean(),
    serviceId: fc.constantFrom("corte", "tinte", "barba"),
  })
  .map(
    (b): ClientBooking => {
      const start = at(b.startDays);
      return { id: b.id, serviceId: b.serviceId, start, end: start.add({ minutes: b.minutes }), status: b.status, noShow: b.noShow, paidCents: null, visitNote: "" };
    },
  );

const clientsArb = fc.array(fc.array(bookingArb, { maxLength: 8 }), { minLength: 0, maxLength: 12 }).map((lists) =>
  lists.map((bookings, i): LapsedInput & { bookings: ClientBooking[] } => ({
    id: `c${i}`,
    name: `Client ${i}`,
    summary: summarize(bookings, NOW),
    bookings,
  })),
);

describe("lapsedClients (BACKLOG 15)", () => {
  it("never lists a client with an unfinished confirmed booking, nor one who never visited", () => {
    fc.assert(
      fc.property(clientsArb, (clients) => {
        const listed = new Set(lapsedClients(clients, NOW).map((l) => l.id));
        for (const c of clients) {
          const future = c.bookings.some((b) => b.status === "confirmed" && Temporal.Instant.compare(b.end, NOW) > 0);
          if (future) expect(listed.has(c.id)).toBe(false);
          if (c.summary.lastVisit === null) expect(listed.has(c.id)).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("orders by days overdue, most overdue first, and every entry is really overdue", () => {
    fc.assert(
      fc.property(clientsArb, (clients) => {
        const out = lapsedClients(clients, NOW);
        for (let i = 0; i < out.length; i++) {
          expect(out[i].overdueDays).toBeGreaterThan(0);
          expect(out[i].overdueDays).toBe(out[i].daysSince - out[i].thresholdDays);
          if (i > 0) expect(out[i - 1].overdueDays).toBeGreaterThanOrEqual(out[i].overdueDays);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("interval rule: listed exactly when the days since the last visit exceed the own interval, or 60 without one", () => {
    fc.assert(
      fc.property(clientsArb, (clients) => {
        const listed = new Map(lapsedClients(clients, NOW).map((l) => [l.id, l]));
        for (const c of clients) {
          const { lastVisit, upcoming, intervalDays } = c.summary;
          if (lastVisit === null || upcoming !== null) continue;
          const daysSince = Math.floor((NOW.epochMilliseconds - lastVisit.epochMilliseconds) / DAY);
          const threshold = lapseThresholdDays(intervalDays);
          expect(listed.has(c.id)).toBe(daysSince > threshold);
          if (listed.has(c.id)) expect(listed.get(c.id)!.thresholdDays).toBe(threshold);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("a client with one visit is judged by the 60 days; with a 14-day rhythm, by 21 (1.5 × 14, never under 21)", () => {
    const visit = (id: string, days: number): ClientBooking => ({
      id,
      serviceId: "corte",
      start: at(-days),
      end: at(-days).add({ minutes: 30 }),
      status: "confirmed",
      noShow: false,
      paidCents: null,
      visitNote: "",
    });
    const one = summarize([visit("a", 59)], NOW);
    const oneOld = summarize([visit("b", 61)], NOW);
    const rhythm = summarize([visit("c1", 65), visit("c2", 51), visit("c3", 37), visit("c4", 23)], NOW);
    expect(rhythm.intervalDays).toBe(14);
    const out = lapsedClients(
      [
        { id: "one", name: "One", summary: one },
        { id: "oneOld", name: "OneOld", summary: oneOld },
        { id: "rhythm", name: "Rhythm", summary: rhythm },
      ],
      NOW,
    );
    expect(out.map((l) => l.id)).toEqual(["rhythm", "oneOld"]); // 2 days overdue, then 1
    expect(out.find((l) => l.id === "rhythm")).toMatchObject({ daysSince: 23, thresholdDays: 21, overdueDays: 2 });
    expect(out.find((l) => l.id === "oneOld")).toMatchObject({ daysSince: 61, thresholdDays: 60, overdueDays: 1 });
  });
});

describe("lapse threshold", () => {
  it("is 1.5 times the client's interval, never under 21 days, and 60 days without an interval", () => {
    expect(lapseThresholdDays(7)).toBe(21);
    expect(lapseThresholdDays(28)).toBe(42);
    expect(lapseThresholdDays(null)).toBe(60);
  });
});

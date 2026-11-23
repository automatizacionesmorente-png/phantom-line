import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { agendaWindow, allowedActions, groupAgenda, type AgendaBooking } from "@/lib/owner/agenda";
import { NUM_RUNS, arbAgendaCase, arbNow } from "../booking/arbitraries";

/** Oracle: the shop-local date of an instant by Intl, never Temporal's zone code. */
const intlDate = (i: Temporal.Instant, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(i.epochMilliseconds);

// M10. The Agenda groups every booking once, on its local day. Validates 9.1, 9.4.
describe("M10: the Agenda groups every booking once, on its local day", () => {
  it("8 consecutive local days from today; each booking in the window once, on its day; active first, by start", () => {
    let placed = 0;
    let leftOut = 0;
    fc.assert(
      fc.property(arbAgendaCase, ({ timeZone, now, rows }) => {
        const w = agendaWindow(now, timeZone);
        const days = groupAgenda(rows, w, timeZone);

        const today = Temporal.PlainDate.from(intlDate(now, timeZone));
        const expectedDays = Array.from({ length: 8 }, (_, k) => today.add({ days: k }).toString());
        expect(days.map((d) => d.date)).toEqual(expectedDays);

        const where = new Map<string, string[]>();
        for (const d of days) for (const b of d.items) where.set(b.id, [...(where.get(b.id) ?? []), d.date]);
        for (const b of rows) {
          const local = intlDate(b.start, timeZone);
          if (expectedDays.includes(local)) {
            placed++;
            expect(where.get(b.id)).toEqual([local]);
          } else {
            leftOut++;
            expect(where.has(b.id)).toBe(false);
          }
        }

        for (const d of days) {
          const firstCancelled = d.items.findIndex((b) => b.status === "cancelled");
          if (firstCancelled >= 0) expect(d.items.slice(firstCancelled).every((b) => b.status === "cancelled")).toBe(true);
          for (const part of [d.items.filter((b) => b.status !== "cancelled"), d.items.filter((b) => b.status === "cancelled")]) {
            for (let k = 1; k < part.length; k++) {
              expect(Temporal.Instant.compare(part[k - 1].start, part[k].start)).toBeLessThanOrEqual(0);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
    expect(placed).toBeGreaterThan(0);
    expect(leftOut).toBeGreaterThan(0);
  });
});

const arbActionCase = arbNow.chain((now) =>
  fc.record({
    now: fc.constant(now),
    booking: fc
      .record({
        offset: fc.oneof(fc.integer({ min: -3 * 1440, max: 3 * 1440 }), fc.integer({ min: -1, max: 1 })),
        cancelled: fc.boolean(),
        confirmed: fc.boolean(),
      })
      .map(
        ({ offset, cancelled, confirmed }): AgendaBooking => ({
          id: "b",
          revision: 1,
          resourceId: "r0",
          serviceId: "s0",
          start: now.add({ minutes: offset }),
          end: now.add({ minutes: offset + 30 }),
          status: cancelled ? "cancelled" : "confirmed",
          ownerConfirmedAt: confirmed ? now.subtract({ hours: 1 }) : null,
          cancelledBy: cancelled ? "owner" : null,
          customerName: "Ana",
          channel: "voice", noShowAt: null, paidCents: null, priceCents: null, visitNote: "",
          lastOwnerAction: null,
        }),
      ),
  }),
);

// M11. Allowed actions. Validates 10.1, 10.2.
describe("M11: allowed actions", () => {
  it("none for cancelled or started; otherwise move and cancel, and confirm iff unconfirmed", () => {
    fc.assert(
      fc.property(arbActionCase, ({ now, booking }) => {
        const actions = allowedActions(booking, now);
        const started = booking.start.epochMilliseconds <= now.epochMilliseconds;
        if (booking.status === "cancelled" || started) {
          expect(actions).toEqual([]);
          return;
        }
        expect(actions).toContain("move");
        expect(actions).toContain("cancel");
        expect(actions.includes("confirm")).toBe(booking.ownerConfirmedAt === null);
        expect(new Set(actions).size).toBe(actions.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

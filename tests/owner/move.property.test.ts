import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { checkBooking, daySlots, evaluateBooking, overlaps, type ExistingBooking } from "@/lib/booking";
import { toShopRules } from "@/lib/conversation/shopProfile";
import { allowedActions, type AgendaBooking } from "@/lib/owner/agenda";
import { decideMove, moveContext } from "@/lib/owner/move";
import { NUM_RUNS, activeOf, arbMoveCase, arbMoveSequence, ctxOf } from "../booking/arbitraries";

/** Oracle for "the start is in moveDays": the shop-local date by Intl, 0 … 13 days after today. */
function inMoveWindow(start: Temporal.Instant, now: Temporal.Instant, timeZone: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const today = Temporal.PlainDate.from(fmt.format(now.epochMilliseconds));
  const day = fmt.format(start.epochMilliseconds);
  return Array.from({ length: 14 }, (_, k) => today.add({ days: k }).toString()).includes(day);
}

const freeOn = (resourceId: string, range: { start: Temporal.Instant; end: Temporal.Instant }, others: readonly ExistingBooking[]) =>
  !others.some((b) => b.resourceId === resourceId && overlaps(b, range));

// M7. A move is accepted only where the Booking_Rules accept it. Validates 15.4, 10.4, 10.6, 10.9.
describe("M7: a move is accepted only where the Booking_Rules accept it", () => {
  it("decideMove accepts exactly when move is allowed, the day is a move day and the rules accept", { timeout: 300_000 }, () => {
    const seen = { accepted: 0, notMovable: 0, outside: 0, rules: 0, keptOwn: 0, tookOther: 0 };
    fc.assert(
      fc.property(arbMoveCase, (c) => {
        const existing = activeOf(c.agenda);
        const d = decideMove({ booking: c.booking, start: c.start, now: c.now, shop: c.profile, pack: c.sectorPack, existing });

        const req = { serviceId: c.booking.serviceId, start: c.start, ignoreBookingId: c.booking.id };
        const movable = allowedActions(c.booking, c.now).includes("move");
        const inWindow = inMoveWindow(c.start, c.now, c.shop.timeZone);
        // The rules in the shop's own resource order: acceptance must not depend on the order.
        const plain = evaluateBooking(req, ctxOf({ ...c, existing }));
        expect(toShopRules(c.profile)).toEqual(c.shop);

        expect(d.ok).toBe(movable && inWindow && plain.ok);
        if (!d.ok) {
          if (!movable) {
            seen.notMovable++;
            expect(d.reason).toBe("not_movable");
          } else if (!inWindow) {
            seen.outside++;
            expect(d.reason).toBe("outside_move_window");
          } else {
            seen.rules++;
            expect(!plain.ok && d.reason).toBe(!plain.ok && plain.reason);
            const ctx = moveContext(c.booking, c.profile, c.sectorPack, c.now, existing);
            const date = c.start.toZonedDateTimeISO(c.shop.timeZone).toPlainDate();
            expect(d.slots).toEqual(daySlots({ serviceId: req.serviceId, ignoreBookingId: req.ignoreBookingId }, date, ctx));
          }
          return;
        }
        seen.accepted++;
        const v = d.verdict;
        const service = c.shop.services.find((s) => s.id === c.booking.serviceId)!;
        expect(v.start.equals(c.start)).toBe(true);
        expect(v.end.equals(c.start.add({ minutes: service.durationMin }))).toBe(true);
        // Free on its resource among the other bookings.
        const others = existing.filter((b) => b.id !== c.booking.id);
        expect(freeOn(v.resourceId, v, others)).toBe(true);
        // The booking's own resource whenever that one is free (10.6).
        if (freeOn(c.booking.resourceId, v, others)) {
          seen.keptOwn++;
          expect(v.resourceId).toBe(c.booking.resourceId);
        } else {
          seen.tookOther++;
          expect(v.resourceId).not.toBe(c.booking.resourceId);
        }
      }),
      { numRuns: NUM_RUNS },
    );
    // Every branch of the property was exercised.
    for (const [k, n] of Object.entries(seen)) expect(n, k).toBeGreaterThan(0);
  });
});

// M9. Owner moves never double-book (pure half; the database half is task 8.12). Validates 15.5, 10.5.
describe("M9: owner moves never double-book", () => {
  it("1–40 caller requests, owner moves and cancels on an in-memory agenda never overlap on a resource", { timeout: 300_000 }, () => {
    let movesApplied = 0;
    let callsApplied = 0;
    fc.assert(
      fc.property(arbMoveSequence, (g) => {
        const agenda: AgendaBooking[] = [];
        g.ops.forEach((op, n) => {
          if (op.kind === "call") {
            const service = g.shop.services[op.service % g.shop.services.length];
            const start = g.pool[op.k % g.pool.length].add({ minutes: op.shift % 3 === 0 ? op.shift : 0 });
            const v = checkBooking({ serviceId: service.id, start }, ctxOf({ ...g, existing: activeOf(agenda) }));
            if (v.ok) {
              callsApplied++;
              agenda.push({
                id: `b${n}`, revision: 1, resourceId: v.resourceId, serviceId: service.id, start: v.start, end: v.end,
                status: "confirmed", ownerConfirmedAt: null, cancelledBy: null, customerName: `C${n}`, channel: "voice",
                lastOwnerAction: null,
              });
            }
          } else if (agenda.length > 0) {
            const k = op.target % agenda.length;
            const b = agenda[k];
            if (op.kind === "cancel") {
              agenda[k] = { ...b, status: "cancelled", cancelledBy: "owner", revision: b.revision + 1 };
            } else {
              const start = g.pool[op.k % g.pool.length].add({ minutes: op.shift % 3 === 0 ? op.shift : 0 });
              const d = decideMove({ booking: b, start, now: g.now, shop: g.profile, pack: g.sectorPack, existing: activeOf(agenda) });
              if (d.ok) {
                movesApplied++;
                agenda[k] = {
                  ...b, start: d.verdict.start, end: d.verdict.end, resourceId: d.verdict.resourceId,
                  ownerConfirmedAt: null, revision: b.revision + 1,
                };
              }
            }
          }
          const active = activeOf(agenda);
          for (let a = 0; a < active.length; a++) {
            for (let c = a + 1; c < active.length; c++) {
              const x = active[a];
              const y = active[c];
              expect(x.resourceId !== y.resourceId || !overlaps(x, y)).toBe(true);
            }
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
    expect(callsApplied).toBeGreaterThan(0);
    expect(movesApplied).toBeGreaterThan(0);
  });
});

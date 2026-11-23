import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { daySlots, evaluateBooking, localDateOf, toInstant, type ExistingBooking } from "@/lib/booking";
import { getSectorPack, type SectorPack } from "@/lib/sectors";
import type { AgendaBooking } from "@/lib/owner/agenda";
import { decideMove, MOVE_WINDOW_DAYS, moveContext, moveDays, type MoveDecision } from "@/lib/owner/move";
import { lolaProfile, lolaRules, lolaPack } from "../fixtures/lola";

const TZ = "Europe/Madrid";
const at = (d: string, time: string) => toInstant(Temporal.PlainDate.from(d), Temporal.PlainTime.from(time), TZ);
const hairSalon = getSectorPack("hair-salon");
const NOW = at("2026-11-13", "09:00"); // Friday

function booking(o: Partial<AgendaBooking> = {}): AgendaBooking {
  const start = o.start ?? at("2026-11-14", "10:00");
  const duration = (o.serviceId ?? "haircut") === "colour" ? 90 : 30;
  return {
    id: "b1",
    revision: 1,
    resourceId: "chair-1",
    serviceId: "haircut",
    end: start.add({ minutes: duration }),
    status: "confirmed",
    ownerConfirmedAt: null,
    cancelledBy: null,
    customerName: "Ana",
    channel: "voice", noShowAt: null, paidCents: null, priceCents: null, visitNote: "",
    lastOwnerAction: null,
    ...o,
    start,
  };
}
const asExisting = (b: AgendaBooking): ExistingBooking => ({ id: b.id, resourceId: b.resourceId, start: b.start, end: b.end });
const other = (id: string, resourceId: string, d: string, from: string, minutes: number): ExistingBooking => ({
  id,
  resourceId,
  start: at(d, from),
  end: at(d, from).add({ minutes }),
});

function move(b: AgendaBooking, start: Temporal.Instant, existing: ExistingBooking[], o: { now?: Temporal.Instant; pack?: SectorPack } = {}): MoveDecision {
  return decideMove({ booking: b, start, now: o.now ?? NOW, shop: lolaProfile, pack: o.pack ?? hairSalon, existing });
}
/** The fresh Move_Slots the rejection must carry: daySlots of the requested day, the booking ignored, its chair first. */
function freshSlots(b: AgendaBooking, start: Temporal.Instant, existing: ExistingBooking[], o: { now?: Temporal.Instant; pack?: SectorPack } = {}) {
  const ctx = moveContext(b, lolaProfile, o.pack ?? hairSalon, o.now ?? NOW, existing);
  return daySlots({ serviceId: b.serviceId, ignoreBookingId: b.id }, localDateOf(start, TZ), ctx);
}
function expectRejected(d: MoveDecision, reason: string) {
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toBe(reason);
  return d.ok ? [] : d.slots;
}

describe("moveDays", () => {
  it("is today and the next 13 local days", () => {
    const days = moveDays(NOW, TZ).map(String);
    expect(MOVE_WINDOW_DAYS).toBe(14);
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-11-13");
    expect(days[13]).toBe("2026-11-26");
  });
});

describe("moveContext", () => {
  it("is the shop with the booking's own resource first and the pack's grid and rules", () => {
    const ctx = moveContext(booking({ resourceId: "chair-2" }), lolaProfile, hairSalon, NOW, []);
    expect(ctx.shop.resources.map((r) => r.id)).toEqual(["chair-2", "chair-1"]);
    expect(ctx.shop.hours).toEqual(lolaRules.hours);
    expect(ctx.pack).toEqual(lolaPack);
    expect(ctx.now).toBe(NOW);
  });
});

describe("decideMove rejections", () => {
  const b = booking();
  const existing = [asExisting(b)];

  it("not_movable: a cancelled booking", () => {
    const d = move(booking({ status: "cancelled", cancelledBy: "caller" }), at("2026-11-14", "11:00"), existing);
    expect(expectRejected(d, "not_movable")).toEqual([]);
  });

  it("not_movable: a booking that has started", () => {
    const d = move(b, at("2026-11-14", "11:00"), existing, { now: at("2026-11-14", "10:05") });
    expect(expectRejected(d, "not_movable")).toEqual([]);
  });

  it("outside_move_window: yesterday, and today + 14", () => {
    expect(expectRejected(move(b, at("2026-11-12", "11:00"), existing), "outside_move_window")).toEqual([]);
    expect(expectRejected(move(b, at("2026-11-27", "11:00"), existing), "outside_move_window")).toEqual([]);
    // Today + 13 (Thursday 26) is still in the window.
    expect(move(b, at("2026-11-26", "11:00"), existing).ok).toBe(true);
  });

  it("unknown_service, with no slots to offer", () => {
    const perm = booking({ serviceId: "perm" });
    const start = at("2026-11-14", "11:00");
    expect(expectRejected(move(perm, start, [asExisting(perm)]), "unknown_service")).toEqual([]);
  });

  it("in_the_past, carrying the rest of today's slots", () => {
    const start = at("2026-11-13", "08:00");
    const slots = expectRejected(move(b, start, existing), "in_the_past");
    expect(slots.length).toBeGreaterThan(0);
    expect(slots).toEqual(freshSlots(b, start, existing));
  });

  it("closed_day (Sunday), carrying the day's slots: none", () => {
    const start = at("2026-11-15", "11:00");
    expect(expectRejected(move(b, start, existing), "closed_day")).toEqual([]);
    expect(freshSlots(b, start, existing)).toEqual([]);
  });

  it("outside_hours (21:00), carrying the day's slots", () => {
    const start = at("2026-11-14", "21:00");
    const slots = expectRejected(move(b, start, existing), "outside_hours");
    expect(slots.length).toBeGreaterThan(0);
    expect(slots).toEqual(freshSlots(b, start, existing));
  });

  it("does_not_fit (a colour at 13:00 would end at 14:30), carrying the day's slots", () => {
    const colour = booking({ serviceId: "colour" });
    const start = at("2026-11-14", "13:00");
    const slots = expectRejected(move(colour, start, [asExisting(colour)]), "does_not_fit");
    expect(slots.length).toBeGreaterThan(0);
    expect(slots).toEqual(freshSlots(colour, start, [asExisting(colour)]));
    expect(slots.every((s) => Temporal.Instant.compare(s.start, at("2026-11-14", "12:30")) <= 0 || Temporal.Instant.compare(s.start, at("2026-11-14", "17:00")) >= 0)).toBe(true);
  });

  it("all_resources_busy (both chairs at 17:00), carrying the day's slots without 17:00", () => {
    const busy = [...existing, other("x1", "chair-1", "2026-11-14", "17:00", 30), other("x2", "chair-2", "2026-11-14", "17:00", 30)];
    const start = at("2026-11-14", "17:00");
    const slots = expectRejected(move(b, start, busy), "all_resources_busy");
    expect(slots).toEqual(freshSlots(b, start, busy));
    expect(slots.some((s) => s.start.equals(start))).toBe(false);
    expect(slots.some((s) => s.start.equals(at("2026-11-14", "17:30")))).toBe(true);
  });

  it("a sector rule's reason, carrying the day's slots the rule allows", () => {
    const noMornings: SectorPack = {
      ...hairSalon,
      rules: [({ start }) => (start.toZonedDateTimeISO(TZ).hour < 12 ? { ok: false, reason: "no_mornings" } : { ok: true })],
    };
    const start = at("2026-11-14", "11:00");
    const slots = expectRejected(move(b, start, existing, { pack: noMornings }), "sector:no_mornings");
    expect(slots).toEqual(freshSlots(b, start, existing, { pack: noMornings }));
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.start.toZonedDateTimeISO(TZ).hour >= 12)).toBe(true);
  });
});

describe("decideMove acceptances", () => {
  it("a 30-minute move on the same chair is accepted thanks to ignoreBookingId", () => {
    // A colour on chair-1 17:00–18:30; chair-2 is taken all evening.
    const colour = booking({ serviceId: "colour", start: at("2026-11-14", "17:00") });
    const existing = [asExisting(colour), other("x2", "chair-2", "2026-11-14", "17:00", 180)];
    const start = at("2026-11-14", "17:30");
    const d = move(colour, start, existing);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.verdict.resourceId).toBe("chair-1");
      expect(d.verdict.start.equals(start)).toBe(true);
      expect(d.verdict.end.equals(at("2026-11-14", "19:00"))).toBe(true);
    }
    // Without ignoring itself, the booking would block its own move.
    const ctx = moveContext(colour, lolaProfile, hairSalon, NOW, existing);
    const blocked = evaluateBooking({ serviceId: "colour", start }, ctx);
    expect(!blocked.ok && blocked.reason).toBe("all_resources_busy");
  });

  it("keeps the booking's chair when it is free, even if it is not the shop's first chair", () => {
    const b = booking({ resourceId: "chair-2" });
    const d = move(b, at("2026-11-14", "11:00"), [asExisting(b)]);
    expect(d.ok && d.verdict.resourceId).toBe("chair-2");
  });

  it("takes the other chair when its own is busy at the new time", () => {
    const b = booking({ resourceId: "chair-2" });
    const existing = [asExisting(b), other("x2", "chair-2", "2026-11-14", "11:00", 30)];
    const d = move(b, at("2026-11-14", "11:00"), existing);
    expect(d.ok && d.verdict.resourceId).toBe("chair-1");
  });

  it("an off-grid start the rules accept is accepted", () => {
    const b = booking();
    const d = move(b, at("2026-11-14", "11:07"), [asExisting(b)]);
    expect(d.ok).toBe(true);
  });
});

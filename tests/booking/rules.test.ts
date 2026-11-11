import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
  checkBooking,
  evaluateBooking,
  toInstant,
  type ExistingBooking,
  type RuleContext,
  type SectorRule,
} from "@/lib/booking";
import { lolaPack, lolaRules } from "../fixtures/lola";

const TZ = "Europe/Madrid";
const at = (date: string, time: string) =>
  toInstant(Temporal.PlainDate.from(date), Temporal.PlainTime.from(time), TZ);
const ctx = (existing: ExistingBooking[] = [], over: Partial<RuleContext> = {}): RuleContext => ({
  now: at("2026-11-11", "09:00"),
  shop: lolaRules,
  pack: lolaPack,
  existing,
  ...over,
});
const booking = (id: string, resourceId: string, start: string, minutes: number): ExistingBooking => {
  const s = at("2026-11-11", start);
  return { id, resourceId, start: s, end: s.add({ minutes }) };
};
const reasonOf = (serviceId: string, date: string, time: string, c = ctx()) => {
  const e = evaluateBooking({ serviceId, start: at(date, time) }, c);
  return e.ok ? "ok" : e.reason;
};

describe("evaluateBooking: one test per rejection reason", () => {
  it("unknown_service", () => {
    expect(reasonOf("manicure", "2026-11-11", "10:00")).toBe("unknown_service");
  });
  it("in_the_past: one minute before now", () => {
    expect(reasonOf("haircut", "2026-11-11", "08:59", ctx([], { now: at("2026-11-11", "09:00") }))).toBe("in_the_past");
    // A start exactly at `now` is not in the past (it is outside hours here).
    expect(reasonOf("haircut", "2026-11-11", "09:00")).toBe("outside_hours");
  });
  it("closed_day: Sunday and Monday", () => {
    expect(reasonOf("haircut", "2026-11-15", "11:00")).toBe("closed_day");
    expect(reasonOf("haircut", "2026-11-16", "11:00")).toBe("closed_day");
  });
  it("outside_hours: before opening, the lunch gap, exactly at close, after close", () => {
    expect(reasonOf("haircut", "2026-11-11", "09:59")).toBe("outside_hours");
    expect(reasonOf("haircut", "2026-11-11", "15:00")).toBe("outside_hours");
    expect(reasonOf("haircut", "2026-11-11", "14:00")).toBe("outside_hours");
    expect(reasonOf("haircut", "2026-11-11", "20:00")).toBe("outside_hours");
    expect(reasonOf("haircut", "2026-11-11", "21:00")).toBe("outside_hours");
  });
  it("does_not_fit: a 90-minute colour at 19:00 ends after 20:00; at 18:30 it fits exactly", () => {
    expect(reasonOf("colour", "2026-11-11", "19:00")).toBe("does_not_fit");
    expect(reasonOf("colour", "2026-11-11", "18:31")).toBe("does_not_fit");
    expect(reasonOf("colour", "2026-11-11", "18:30")).toBe("ok");
  });
  it("all_resources_busy: both chairs taken", () => {
    const c = ctx([booking("a", "chair-1", "10:00", 30), booking("b", "chair-2", "10:15", 30)]);
    expect(reasonOf("haircut", "2026-11-11", "10:20", c)).toBe("all_resources_busy");
  });
  it("sector:<name>: a synthetic pack rule rejects", () => {
    const noLateColour: SectorRule = ({ service, start, session }) =>
      service.id === "colour" && Temporal.Instant.compare(start.add({ hours: 2 }), session.close) > 0
        ? { ok: false, reason: "colour_too_late" }
        : { ok: true };
    const c = ctx([], { pack: { slotStepMin: 15, rules: [noLateColour] } });
    expect(reasonOf("colour", "2026-11-11", "18:30", c)).toBe("sector:colour_too_late");
    expect(reasonOf("colour", "2026-11-11", "17:00", c)).toBe("ok");
    expect(reasonOf("haircut", "2026-11-11", "19:30", c)).toBe("ok");
  });
});

describe("evaluateBooking: resources", () => {
  it("assigns chair-1 when both are free", () => {
    const e = evaluateBooking({ serviceId: "haircut", start: at("2026-11-11", "10:00") }, ctx());
    expect(e).toMatchObject({ ok: true, resourceId: "chair-1" });
  });
  it("uses the second chair when the first is busy", () => {
    const e = evaluateBooking(
      { serviceId: "haircut", start: at("2026-11-11", "10:00") },
      ctx([booking("a", "chair-1", "10:00", 30)]),
    );
    expect(e).toMatchObject({ ok: true, resourceId: "chair-2" });
  });
  it("back-to-back on the same chair is allowed", () => {
    const e = evaluateBooking(
      { serviceId: "haircut", start: at("2026-11-11", "10:30") },
      ctx([booking("a", "chair-1", "10:00", 30)]),
    );
    expect(e).toMatchObject({ ok: true, resourceId: "chair-1" });
  });
  it("ignoreBookingId lets a booking move 30 minutes later on the same chair", () => {
    // chair-1: the colour being moved (10:00–11:30); chair-2: busy 10:00–12:30.
    const existing = [booking("move-me", "chair-1", "10:00", 90), booking("other", "chair-2", "10:00", 150)];
    const req = { serviceId: "colour", start: at("2026-11-11", "10:30") };
    // Without the ignore, 10:30–12:00 collides with the booking itself and with chair-2.
    expect(evaluateBooking(req, ctx(existing))).toMatchObject({ ok: false, reason: "all_resources_busy" });
    // With it, the booking moves 30 minutes later and stays on chair-1.
    expect(evaluateBooking({ ...req, ignoreBookingId: "move-me" }, ctx(existing))).toMatchObject({
      ok: true,
      resourceId: "chair-1",
    });
    // Ignoring a different booking does not free chair-1.
    expect(evaluateBooking({ ...req, ignoreBookingId: "other-id" }, ctx(existing))).toMatchObject({
      ok: false,
      reason: "all_resources_busy",
    });
  });
  it("the end is start + duration in real minutes", () => {
    const e = evaluateBooking({ serviceId: "colour", start: at("2026-11-11", "17:00") }, ctx());
    expect(e.ok && e.end.toString()).toBe(at("2026-11-11", "18:30").toString());
  });
});

describe("checkBooking", () => {
  it("returns the evaluation when accepted", () => {
    const v = checkBooking({ serviceId: "haircut", start: at("2026-11-11", "10:00") }, ctx());
    expect(v).toMatchObject({ ok: true, resourceId: "chair-1" });
  });
  it("unknown_service comes with no alternatives", () => {
    const v = checkBooking({ serviceId: "manicure", start: at("2026-11-11", "10:00") }, ctx());
    expect(v).toEqual({ ok: false, reason: "unknown_service", alternatives: [] });
  });
});

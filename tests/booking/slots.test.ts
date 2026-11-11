import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
  checkBooking,
  findNearestSlots,
  slotCandidates,
  toInstant,
  type RuleContext,
} from "@/lib/booking";
import { lolaPack, lolaRules } from "../fixtures/lola";

const TZ = "Europe/Madrid";
const at = (date: string, time: string) =>
  toInstant(Temporal.PlainDate.from(date), Temporal.PlainTime.from(time), TZ);
const ctx = (now: Temporal.Instant): RuleContext => ({
  now,
  shop: lolaRules,
  pack: lolaPack,
  existing: [],
});
const local = (i: Temporal.Instant) => i.toZonedDateTimeISO(TZ).toPlainDateTime().toString().slice(0, 16);

describe("worked example: Lola, Wednesday 2026-11-11, now 09:00, haircut at 21:00", () => {
  const v = checkBooking({ serviceId: "haircut", start: at("2026-11-11", "21:00") }, ctx(at("2026-11-11", "09:00")));

  it("is rejected as outside_hours", () => {
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toBe("outside_hours");
  });
  it("offers 19:30, 19:15 and 19:00 on chair-1", () => {
    expect(!v.ok && v.alternatives.map((s) => [local(s.start), s.resourceId])).toEqual([
      ["2026-11-11T19:30", "chair-1"],
      ["2026-11-11T19:15", "chair-1"],
      ["2026-11-11T19:00", "chair-1"],
    ]);
  });
  it("19:30 ends exactly at the 20:00 close", () => {
    expect(!v.ok && local(v.alternatives[0].end)).toBe("2026-11-11T20:00");
  });
});

describe("DST companions", () => {
  it("Saturday 28 March 21:00 → Saturday 19:30, which is 18:30Z (UTC+1)", () => {
    const v = checkBooking({ serviceId: "haircut", start: at("2026-03-28", "21:00") }, ctx(at("2026-03-28", "09:00")));
    expect(!v.ok && v.alternatives[0].start.toString()).toBe("2026-03-28T18:30:00Z");
  });
  it("Tuesday 31 March 19:30 is 17:30Z (UTC+2)", () => {
    expect(at("2026-03-31", "19:30").toString()).toBe("2026-03-31T17:30:00Z");
  });
  it("Sunday 29 March 12:00 (closed) → Saturday 19:30, not Tuesday 10:00", () => {
    const req = { serviceId: "haircut", start: at("2026-03-29", "12:00") };
    const v = checkBooking(req, ctx(at("2026-03-28", "09:00")));
    expect(!v.ok && v.reason).toBe("closed_day");
    expect(!v.ok && local(v.alternatives[0].start)).toBe("2026-03-28T19:30");
    // 15.5 real hours before vs 46 real hours after, across the 23-hour Sunday.
    expect(at("2026-03-28", "19:30").until(req.start).total("hours")).toBe(15.5);
    expect(req.start.until(at("2026-03-31", "10:00")).total("hours")).toBe(46);
  });
});

describe("findNearestSlots window and grid", () => {
  it("never offers a slot before now", () => {
    const now = at("2026-11-11", "19:20");
    const slots = findNearestSlots({ serviceId: "haircut", start: at("2026-11-11", "19:00") }, ctx(now));
    expect(slots.map((s) => local(s.start))).toEqual(["2026-11-11T19:30", "2026-11-12T10:00", "2026-11-12T10:15"]);
  });
  it("never offers a slot more than 14 days from the request", () => {
    const now = at("2026-11-11", "09:00");
    const slots = findNearestSlots({ serviceId: "haircut", start: at("2026-11-11", "21:00") }, ctx(now), { limit: 10_000 });
    const r = at("2026-11-11", "21:00");
    for (const s of slots) {
      expect(Math.abs(s.start.epochMilliseconds - r.epochMilliseconds)).toBeLessThanOrEqual(14 * 24 * 3_600_000);
    }
    expect(slots.length).toBeGreaterThan(3);
  });
  it("slotCandidates puts every slot on the 15-minute grid from each opening and fits the service", () => {
    const c = ctx(at("2026-11-11", "00:00"));
    const all = slotCandidates({ id: "colour", durationMin: 90 }, c, at("2026-11-11", "00:00"), at("2026-11-11", "23:59"));
    expect(all.map(local).map((s) => s.slice(11))).toEqual([
      "10:00", "10:15", "10:30", "10:45", "11:00", "11:15", "11:30", "11:45", "12:00", "12:15", "12:30",
      "17:00", "17:15", "17:30", "17:45", "18:00", "18:15", "18:30",
    ]);
  });
  it("an off-grid request that is valid is still accepted", () => {
    const v = checkBooking({ serviceId: "haircut", start: at("2026-11-11", "10:07") }, ctx(at("2026-11-11", "09:00")));
    expect(v.ok).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { daySlots, toInstant, type RuleContext, type ShopRules } from "@/lib/booking";
import { lolaPack, lolaRules } from "../fixtures/lola";

const TZ = "Europe/Madrid";
const day = (d: string) => Temporal.PlainDate.from(d);
const at = (d: string, time: string) => toInstant(day(d), Temporal.PlainTime.from(time), TZ);
const local = (i: Temporal.Instant) => i.toZonedDateTimeISO(TZ).toString({ timeZoneName: "never" }).slice(11, 22);
const lola = (now: Temporal.Instant, existing: RuleContext["existing"] = []): RuleContext => ({
  now,
  shop: lolaRules,
  pack: lolaPack,
  existing,
});

describe("daySlots: Lola", () => {
  // Saturday 14 November 2026; chair-1 has a haircut at 17:00.
  const now = at("2026-11-13", "09:00");
  const existing = [{ id: "b1", resourceId: "chair-1", start: at("2026-11-14", "17:00"), end: at("2026-11-14", "17:30") }];
  const slots = daySlots({ serviceId: "haircut" }, day("2026-11-14"), lola(now, existing));
  const of = (time: string) => slots.find((s) => s.start.equals(at("2026-11-14", time)));

  it("lists 17:00 on the other chair when chair-1 is busy", () => {
    expect(of("17:00")?.resourceId).toBe("chair-2");
    expect(of("16:59")).toBeUndefined();
    expect(of("17:30")?.resourceId).toBe("chair-1");
  });

  it("lists every 15-minute start of both sessions, in order, ending by each close", () => {
    expect(slots.map((s) => local(s.start).slice(0, 5))).toEqual([
      "10:00", "10:15", "10:30", "10:45", "11:00", "11:15", "11:30", "11:45", "12:00", "12:15", "12:30", "12:45",
      "13:00", "13:15", "13:30",
      "17:00", "17:15", "17:30", "17:45", "18:00", "18:15", "18:30", "18:45", "19:00", "19:15", "19:30",
    ]);
    for (const s of slots) expect(s.end.equals(s.start.add({ minutes: 30 }))).toBe(true);
  });

  it("ignoreBookingId frees the booking's own chair", () => {
    const freed = daySlots({ serviceId: "haircut", ignoreBookingId: "b1" }, day("2026-11-14"), lola(now, existing));
    expect(freed.find((s) => s.start.equals(at("2026-11-14", "17:00")))?.resourceId).toBe("chair-1");
  });

  it("a closed day lists nothing (Sunday and Monday)", () => {
    expect(daySlots({ serviceId: "haircut" }, day("2026-11-15"), lola(now))).toEqual([]);
    expect(daySlots({ serviceId: "haircut" }, day("2026-11-16"), lola(now))).toEqual([]);
  });

  it("an unknown service lists nothing", () => {
    expect(daySlots({ serviceId: "perm" }, day("2026-11-14"), lola(now))).toEqual([]);
  });

  it("today lists only what is still ahead", () => {
    const slotsToday = daySlots({ serviceId: "haircut" }, day("2026-11-14"), lola(at("2026-11-14", "19:00")));
    expect(slotsToday.map((s) => local(s.start).slice(0, 5))).toEqual(["19:00", "19:15", "19:30"]);
  });
});

describe("daySlots on the DST days (Madrid, a night session 01:00–04:00, 30-minute grid)", () => {
  const night: ShopRules = {
    timeZone: TZ,
    hours: { 7: [{ open: "01:00", close: "04:00" }] },
    services: [{ id: "s", durationMin: 30 }],
    resources: [{ id: "r" }],
  };
  const ctx = (now: string): RuleContext => ({
    now: Temporal.Instant.from(now),
    shop: night,
    pack: { slotStepMin: 30, rules: [] },
    existing: [],
  });

  it("the 23-hour day (29 March) skips the missing hour 02:00–03:00", () => {
    const slots = daySlots({ serviceId: "s" }, day("2026-03-29"), ctx("2026-03-20T00:00:00Z"));
    expect(slots.map((s) => local(s.start))).toEqual(["01:00:00+01", "01:30:00+01", "03:00:00+02", "03:30:00+02"]);
  });

  it("the 25-hour day (25 October) lists the repeated hour twice, once per offset", () => {
    const slots = daySlots({ serviceId: "s" }, day("2026-10-25"), ctx("2026-10-20T00:00:00Z"));
    expect(slots.map((s) => local(s.start))).toEqual([
      "01:00:00+02", "01:30:00+02", "02:00:00+02", "02:30:00+02",
      "02:00:00+01", "02:30:00+01", "03:00:00+01", "03:30:00+01",
    ]);
  });
});

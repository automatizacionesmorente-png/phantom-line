import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { localDateOf, overlaps, sessionsOn, toInstant, type ShopRules } from "@/lib/booking";
import { lolaRules } from "../fixtures/lola";

const d = (s: string) => Temporal.PlainDate.from(s);
const t = (s: string) => Temporal.PlainTime.from(s);
const i = (s: string) => Temporal.Instant.from(s);
const iso = (sessions: { open: Temporal.Instant; close: Temporal.Instant }[]) =>
  sessions.map((s) => [s.open.toString(), s.close.toString()]);

/** Synthetic shop open only on Sundays, 01:00–05:00 Madrid time: crosses both 2026 transitions. */
const sundayNight: ShopRules = {
  timeZone: "Europe/Madrid",
  hours: { 7: [{ open: "01:00", close: "05:00" }] },
  services: [{ id: "x", durationMin: 30 }],
  resources: [{ id: "r" }],
};
const realHours = (s: { open: Temporal.Instant; close: Temporal.Instant }) =>
  s.open.until(s.close).total("hours");

describe("toInstant / localDateOf in Europe/Madrid around DST 2026", () => {
  it("Saturday 28 March is UTC+1", () => {
    expect(toInstant(d("2026-03-28"), t("10:00"), "Europe/Madrid").toString()).toBe(
      "2026-03-28T09:00:00Z",
    );
  });
  it("Sunday 29 March: 02:30 does not exist and moves forward to 03:30 CEST", () => {
    expect(toInstant(d("2026-03-29"), t("02:30"), "Europe/Madrid").toString()).toBe(
      "2026-03-29T01:30:00Z",
    );
  });
  it("Tuesday 31 March is UTC+2", () => {
    expect(toInstant(d("2026-03-31"), t("10:00"), "Europe/Madrid").toString()).toBe(
      "2026-03-31T08:00:00Z",
    );
  });
  it("Saturday 24 October is still UTC+2", () => {
    expect(toInstant(d("2026-10-24"), t("10:00"), "Europe/Madrid").toString()).toBe(
      "2026-10-24T08:00:00Z",
    );
  });
  it("Sunday 25 October: the repeated 02:30 takes the earlier instant; 10:00 is UTC+1", () => {
    expect(toInstant(d("2026-10-25"), t("02:30"), "Europe/Madrid").toString()).toBe(
      "2026-10-25T00:30:00Z",
    );
    expect(toInstant(d("2026-10-25"), t("10:00"), "Europe/Madrid").toString()).toBe(
      "2026-10-25T09:00:00Z",
    );
  });
  it("localDateOf uses the shop's zone, not UTC", () => {
    // 23:30Z on the 28th is already 00:30 on the 29th in Madrid.
    expect(localDateOf(i("2026-03-28T23:30:00Z"), "Europe/Madrid").toString()).toBe("2026-03-29");
    expect(localDateOf(i("2026-03-28T23:30:00Z"), "UTC").toString()).toBe("2026-03-28");
  });
});

describe("sessionsOn", () => {
  it("Lola on Saturday 28 March (UTC+1) and Tuesday 31 March (UTC+2)", () => {
    expect(iso(sessionsOn(d("2026-03-28"), lolaRules))).toEqual([
      ["2026-03-28T09:00:00Z", "2026-03-28T13:00:00Z"],
      ["2026-03-28T16:00:00Z", "2026-03-28T19:00:00Z"],
    ]);
    expect(iso(sessionsOn(d("2026-03-31"), lolaRules))).toEqual([
      ["2026-03-31T08:00:00Z", "2026-03-31T12:00:00Z"],
      ["2026-03-31T15:00:00Z", "2026-03-31T18:00:00Z"],
    ]);
  });
  it("Lola is closed on Sunday 29 March and Sunday 25 October", () => {
    expect(sessionsOn(d("2026-03-29"), lolaRules)).toEqual([]);
    expect(sessionsOn(d("2026-10-25"), lolaRules)).toEqual([]);
  });
  it("the Sunday 01:00–05:00 shop has 3 real hours on 29 March and 5 on 25 October", () => {
    expect(sessionsOn(d("2026-03-29"), sundayNight).map(realHours)).toEqual([3]);
    expect(sessionsOn(d("2026-10-25"), sundayNight).map(realHours)).toEqual([5]);
    expect(sessionsOn(d("2026-04-05"), sundayNight).map(realHours)).toEqual([4]);
  });
});

describe("overlaps", () => {
  const r = (a: string, b: string) => ({ start: i(a), end: i(b) });
  it("back-to-back ranges do not overlap", () => {
    expect(overlaps(r("2026-11-11T09:00:00Z", "2026-11-11T09:30:00Z"), r("2026-11-11T09:30:00Z", "2026-11-11T10:00:00Z"))).toBe(false);
    expect(overlaps(r("2026-11-11T09:30:00Z", "2026-11-11T10:00:00Z"), r("2026-11-11T09:00:00Z", "2026-11-11T09:30:00Z"))).toBe(false);
  });
  it("one shared minute overlaps", () => {
    expect(overlaps(r("2026-11-11T09:00:00Z", "2026-11-11T09:31:00Z"), r("2026-11-11T09:30:00Z", "2026-11-11T10:00:00Z"))).toBe(true);
  });
  it("containment overlaps", () => {
    expect(overlaps(r("2026-11-11T09:00:00Z", "2026-11-11T11:00:00Z"), r("2026-11-11T09:30:00Z", "2026-11-11T10:00:00Z"))).toBe(true);
  });
});

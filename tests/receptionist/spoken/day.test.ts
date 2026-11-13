import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { parseSpokenDay, speakDay, todayIn } from "@/lib/receptionist/spoken";

const d = (iso: string) => Temporal.PlainDate.from(iso);
/** Thursday 12 November 2026. */
const TODAY = d("2026-11-12");

describe("speakDay (Requirement 7, design.md table)", () => {
  it.each([
    ["2026-11-11", "ayer", "yesterday"],
    ["2026-11-12", "hoy", "today"],
    ["2026-11-13", "mañana", "tomorrow"],
    ["2026-11-14", "pasado mañana", "the day after tomorrow"],
    ["2026-11-15", "este domingo", "this Sunday"],
    ["2026-11-16", "el lunes que viene", "next Monday"],
    ["2026-11-18", "el miércoles que viene", "next Wednesday"],
    ["2026-11-19", "el jueves diecinueve", "Thursday the nineteenth"],
    ["2026-11-30", "el lunes treinta", "Monday the thirtieth"],
    ["2026-11-10", "el martes diez", "Tuesday the tenth"],
    ["2026-12-01", "el martes uno de diciembre", "Tuesday the first of December"],
    ["2026-12-21", "el lunes veintiuno de diciembre", "Monday the twenty-first of December"],
  ])("%s from Thursday the 12th → %s / %s", (date, es, en) => {
    expect(speakDay(d(date), TODAY, "es")).toBe(es);
    expect(speakDay(d(date), TODAY, "en")).toBe(en);
    expect(parseSpokenDay(es, TODAY, "es")?.toString()).toBe(date);
    expect(parseSpokenDay(en, TODAY, "en")?.toString()).toBe(date);
  });

  it("adds the weekday for today, tomorrow and the day after only", () => {
    expect(speakDay(d("2026-11-12"), TODAY, "es", { withWeekday: true })).toBe("hoy jueves");
    expect(speakDay(d("2026-11-13"), TODAY, "es", { withWeekday: true })).toBe("mañana viernes");
    expect(speakDay(d("2026-11-14"), TODAY, "es", { withWeekday: true })).toBe("pasado mañana sábado");
    expect(speakDay(d("2026-11-13"), TODAY, "en", { withWeekday: true })).toBe("tomorrow, Friday");
    expect(speakDay(d("2026-11-14"), TODAY, "en", { withWeekday: true })).toBe("the day after tomorrow, Saturday");
    expect(speakDay(d("2026-11-16"), TODAY, "es", { withWeekday: true })).toBe("el lunes que viene");
    expect(speakDay(d("2026-11-11"), TODAY, "es", { withWeekday: true })).toBe("ayer");
    expect(parseSpokenDay("mañana viernes", TODAY, "es")?.toString()).toBe("2026-11-13");
    expect(parseSpokenDay("tomorrow, Friday", TODAY, "en")?.toString()).toBe("2026-11-13");
    expect(parseSpokenDay("mañana sábado", TODAY, "es")).toBeNull();
  });

  it("parses a day of the month said in several words (regression, found by N4)", () => {
    // N4 shrank to now = 2026-02-26T23:00Z (27 Feb in Madrid), 32 days ahead.
    const today = d("2026-02-27");
    expect(speakDay(d("2026-03-31"), today, "es")).toBe("el martes treinta y uno de marzo");
    expect(parseSpokenDay("el martes treinta y uno de marzo", today, "es")?.toString()).toBe("2026-03-31");
    expect(parseSpokenDay("el sábado veintiuno", d("2026-11-12"), "es")?.toString()).toBe("2026-11-21");
  });

  it("crosses the year boundary", () => {
    const today = d("2026-12-30"); // a Wednesday
    expect(speakDay(d("2026-12-31"), today, "es")).toBe("mañana");
    expect(speakDay(d("2027-01-01"), today, "es")).toBe("pasado mañana");
    expect(speakDay(d("2027-01-02"), today, "es")).toBe("este sábado");
    expect(speakDay(d("2027-01-04"), today, "en")).toBe("next Monday");
    expect(speakDay(d("2027-01-20"), today, "es")).toBe("el miércoles veinte de enero");
    expect(speakDay(d("2027-01-20"), today, "en")).toBe("Wednesday the twentieth of January");
    expect(parseSpokenDay("el miércoles veinte de enero", today, "es")?.toString()).toBe("2027-01-20");
    expect(parseSpokenDay("el lunes que viene", today, "es")?.toString()).toBe("2027-01-04");
  });
});

describe("today in the shop's zone across the 2026 Madrid DST weekends", () => {
  const zone = "Europe/Madrid";
  it.each([
    // Spring forward, Sunday 29 March 2026.
    ["2026-03-28T22:30:00Z", "2026-03-28"], // 23:30 CET on Saturday
    ["2026-03-28T23:30:00Z", "2026-03-29"], // 00:30 CET on Sunday, while UTC is still Saturday
    ["2026-03-29T01:30:00Z", "2026-03-29"], // 03:30 CEST, just after the change
    ["2026-03-29T21:59:00Z", "2026-03-29"], // 23:59 CEST
    ["2026-03-29T22:00:00Z", "2026-03-30"], // 00:00 CEST on Monday
    // Fall back, Sunday 25 October 2026.
    ["2026-10-24T22:30:00Z", "2026-10-25"], // 00:30 CEST on Sunday
    ["2026-10-25T00:30:00Z", "2026-10-25"], // 02:30 CEST, the first pass of the repeated hour
    ["2026-10-25T01:30:00Z", "2026-10-25"], // 02:30 CET, the second pass
    ["2026-10-25T22:59:00Z", "2026-10-25"], // 23:59 CET
    ["2026-10-25T23:00:00Z", "2026-10-26"], // 00:00 CET on Monday
  ])("%s is %s in Madrid", (instant, date) => {
    const today = todayIn(Temporal.Instant.from(instant), zone);
    expect(today.toString()).toBe(date);
    expect(speakDay(today, today, "es")).toBe("hoy");
    expect(speakDay(today.add({ days: 1 }), today, "es")).toBe("mañana");
    expect(speakDay(today.add({ days: 2 }), today, "en")).toBe("the day after tomorrow");
  });

  it("names the right weekday for tomorrow on both change days", () => {
    const spring = todayIn(Temporal.Instant.from("2026-03-28T23:30:00Z"), zone);
    expect(speakDay(spring.add({ days: 1 }), spring, "es", { withWeekday: true })).toBe("mañana lunes");
    const autumn = todayIn(Temporal.Instant.from("2026-10-24T22:30:00Z"), zone);
    expect(speakDay(autumn.add({ days: 1 }), autumn, "en", { withWeekday: true })).toBe("tomorrow, Monday");
  });
});

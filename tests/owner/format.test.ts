import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { formatClock, formatDayHeading } from "@/lib/owner/format";

const TZ = "Europe/Madrid";
const at = (iso: string) => Temporal.Instant.from(iso);
const day = (iso: string) => Temporal.PlainDate.from(iso);

describe("formatClock (owner-machine 9.2)", () => {
  it("writes 19:30 in Spanish and 7:30 pm in English", () => {
    const i = at("2026-11-13T18:30:00Z"); // Friday 13, 19:30 in Madrid (CET)
    expect(formatClock(i, TZ, "es")).toBe("19:30");
    expect(formatClock(i, TZ, "en")).toBe("7:30 pm");
  });

  it("drops the minutes on the hour in English only, and handles noon, midnight and the morning", () => {
    expect(formatClock(at("2026-11-13T09:00:00Z"), TZ, "es")).toBe("10:00");
    expect(formatClock(at("2026-11-13T09:00:00Z"), TZ, "en")).toBe("10 am");
    expect(formatClock(at("2026-11-13T11:00:00Z"), TZ, "en")).toBe("12 pm");
    expect(formatClock(at("2026-11-12T23:05:00Z"), TZ, "en")).toBe("12:05 am");
    expect(formatClock(at("2026-11-12T23:05:00Z"), TZ, "es")).toBe("00:05");
    expect(formatClock(at("2026-11-13T08:15:00Z"), TZ, "es")).toBe("09:15");
    expect(formatClock(at("2026-11-13T08:15:00Z"), TZ, "en")).toBe("9:15 am");
  });

  it("29 March 2026 in Madrid: the clock jumps from 02:00 to 03:00", () => {
    expect(formatClock(at("2026-03-29T00:30:00Z"), TZ, "es")).toBe("01:30"); // CET, +1
    expect(formatClock(at("2026-03-29T01:30:00Z"), TZ, "es")).toBe("03:30"); // CEST, +2
    expect(formatClock(at("2026-03-29T01:30:00Z"), TZ, "en")).toBe("3:30 am");
    expect(formatClock(at("2026-03-29T16:00:00Z"), TZ, "es")).toBe("18:00");
    expect(formatClock(at("2026-03-29T16:00:00Z"), TZ, "en")).toBe("6 pm");
  });

  it("25 October 2026 in Madrid: 02:30 happens twice, and the afternoon is back on CET", () => {
    expect(formatClock(at("2026-10-25T00:30:00Z"), TZ, "es")).toBe("02:30"); // CEST
    expect(formatClock(at("2026-10-25T01:30:00Z"), TZ, "es")).toBe("02:30"); // CET
    expect(formatClock(at("2026-10-25T18:30:00Z"), TZ, "es")).toBe("19:30");
    expect(formatClock(at("2026-10-25T18:30:00Z"), TZ, "en")).toBe("7:30 pm");
  });

  it("uses the shop's zone, never the server's", () => {
    const i = at("2026-11-13T18:30:00Z");
    expect(formatClock(i, "America/New_York", "en")).toBe("1:30 pm");
    expect(formatClock(i, "UTC", "es")).toBe("18:30");
  });
});

describe("lib/owner/format.ts is self-contained", () => {
  it("imports nothing from lib/receptionist, which the natural-voice spec turns into spoken forms", () => {
    const source = readFileSync(fileURLToPath(new URL("../../lib/owner/format.ts", import.meta.url)), "utf8");
    const imports = [...source.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["@/lib/sectors", "temporal-polyfill"]);
  });
});

describe("formatDayHeading (owner-machine 9.1)", () => {
  it("writes Viernes 13 and Friday the 13th", () => {
    expect(formatDayHeading(day("2026-11-13"), "es")).toBe("Viernes 13");
    expect(formatDayHeading(day("2026-11-13"), "en")).toBe("Friday the 13th");
  });

  it("the DST days of 2026 in Madrid are plain Sundays", () => {
    expect(formatDayHeading(day("2026-03-29"), "es")).toBe("Domingo 29");
    expect(formatDayHeading(day("2026-03-29"), "en")).toBe("Sunday the 29th");
    expect(formatDayHeading(day("2026-10-25"), "es")).toBe("Domingo 25");
    expect(formatDayHeading(day("2026-10-25"), "en")).toBe("Sunday the 25th");
  });

  it("English ordinals, including 11th to 13th", () => {
    const en = (iso: string) => formatDayHeading(day(iso), "en");
    expect(en("2026-11-01")).toBe("Sunday the 1st");
    expect(en("2026-11-02")).toBe("Monday the 2nd");
    expect(en("2026-11-03")).toBe("Tuesday the 3rd");
    expect(en("2026-11-11")).toBe("Wednesday the 11th");
    expect(en("2026-11-12")).toBe("Thursday the 12th");
    expect(en("2026-11-21")).toBe("Saturday the 21st");
    expect(en("2026-11-22")).toBe("Sunday the 22nd");
    expect(en("2026-11-23")).toBe("Monday the 23rd");
    expect(formatDayHeading(day("2026-11-18"), "es")).toBe("Miércoles 18");
    expect(formatDayHeading(day("2026-11-14"), "es")).toBe("Sábado 14");
  });
});

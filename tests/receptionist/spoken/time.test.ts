import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
  clockWords,
  minuteSessions,
  parseSpokenTime,
  periodOf,
  speakTime,
  type TimeContext,
} from "@/lib/receptionist/spoken";

const t = (hhmm: string) => Temporal.PlainTime.from(hhmm);
/** Peluquería Lola: 10:00–14:00 and 17:00–20:00. */
const LOLA: TimeContext = { sessions: minuteSessions([{ open: "10:00", close: "14:00" }, { open: "17:00", close: "20:00" }]) };

describe("speakTime, Spanish (Requirement 6.2–6.5)", () => {
  it.each([
    ["10:00", "a las diez"],
    ["10:15", "a las diez y cuarto"],
    ["10:30", "a las diez y media"],
    ["10:45", "a las once menos cuarto"],
    ["10:20", "a las diez y veinte"],
    ["10:40", "a las once menos veinte"],
    ["10:25", "a las diez y veinticinco"],
    ["10:35", "a las once menos veinticinco"],
    ["10:01", "a las diez y uno"],
    ["10:07", "a las diez y siete"],
    ["13:30", "a la una y media"],
    ["12:00", "a las doce del mediodía"],
  ])("with Lola's sessions, %s → %s", (time, words) => {
    expect(speakTime(t(time), "es", LOLA)).toBe(words);
  });

  it.each([
    ["10:00", "a las diez"],
    ["13:30", "a la una y media"],
    ["17:15", "a las cinco y cuarto"],
    ["19:30", "a las siete y media"],
    ["21:00", "a las nueve de la noche"],
    ["12:00", "a las doce del mediodía"],
    ["00:00", "a las doce de la noche"],
  ])("Lola's time %s → %s", (time, words) => {
    expect(speakTime(t(time), "es", LOLA)).toBe(words);
  });

  it.each([
    ["17:15", "a las cinco y cuarto de la tarde"],
    ["21:00", "a las nueve de la noche"],
    ["10:00", "a las diez de la mañana"],
    ["12:40", "a la una menos veinte del mediodía"],
    ["00:40", "a la una menos veinte de la noche"],
    ["23:50", "a las doce menos diez de la noche"],
    ["00:15", "a las doce y cuarto de la noche"],
    ["01:00", "a la una de la noche"],
    ["13:00", "a la una del mediodía"],
    ["06:00", "a las seis de la mañana"],
    ["14:00", "a las dos de la tarde"],
  ])("with no sessions, the period is always said: %s → %s", (time, words) => {
    expect(speakTime(t(time), "es")).toBe(words);
  });

  it("says the period when both readings are open, and when the time itself is closed", () => {
    const both: TimeContext = { sessions: minuteSessions([{ open: "09:00", close: "10:00" }, { open: "21:00", close: "22:00" }]) };
    expect(speakTime(t("09:30"), "es", both)).toBe("a las nueve y media de la mañana");
    expect(speakTime(t("21:30"), "es", both)).toBe("a las nueve y media de la noche");
    expect(speakTime(t("20:00"), "es", LOLA)).toBe("a las ocho de la tarde");
    expect(speakTime(t("09:00"), "es", LOLA)).toBe("a las nueve de la mañana");
  });

  it("clockWords is the same without the preposition", () => {
    expect(clockWords(t("17:15"), "es", LOLA)).toBe("las cinco y cuarto");
    expect(clockWords(t("13:30"), "es", LOLA)).toBe("la una y media");
    expect(clockWords(t("21:00"), "en", LOLA)).toBe("nine at night");
    expect(periodOf(t("20:59"), "es")).toBe("de la tarde");
    expect(periodOf(t("05:59"), "es")).toBe("de la noche");
    expect(periodOf(t("04:59"), "en")).toBe("at night");
    expect(periodOf(t("05:00"), "en")).toBe("in the morning");
  });
});

describe("speakTime, English (Requirement 6.6)", () => {
  it.each([
    ["10:00", "at ten"],
    ["17:15", "at quarter past five"],
    ["19:30", "at half past seven"],
    ["10:45", "at quarter to eleven"],
    ["10:10", "at ten past ten"],
    ["10:40", "at twenty to eleven"],
    ["12:00", "at noon"],
    ["00:00", "at midnight"],
  ])("with Lola's sessions, %s → %s", (time, words) => {
    expect(speakTime(t(time), "en", LOLA)).toBe(words);
  });

  it.each([
    ["10:00", "at ten"],
    ["13:30", "at half past one"],
    ["17:15", "at quarter past five"],
    ["19:30", "at half past seven"],
    ["21:00", "at nine at night"],
    ["12:00", "at noon"],
    ["00:00", "at midnight"],
  ])("Lola's time %s → %s", (time, words) => {
    expect(speakTime(t(time), "en", LOLA)).toBe(words);
  });

  it.each([
    ["17:07", "at seven minutes past five in the afternoon"],
    ["17:01", "at one minute past five in the afternoon"],
    ["17:47", "at thirteen minutes to six in the afternoon"],
    ["18:35", "at twenty-five to seven in the evening"],
    ["18:59", "at one minute to seven in the evening"],
    ["09:00", "at nine in the morning"],
    ["12:15", "at quarter past twelve in the afternoon"],
    ["23:45", "at quarter to twelve at night"],
  ])("with no sessions, %s → %s", (time, words) => {
    expect(speakTime(t(time), "en")).toBe(words);
  });
});

describe("parseSpokenTime", () => {
  it("parses the owner's examples back with Lola's sessions", () => {
    expect(parseSpokenTime("a las cinco y cuarto", "es", LOLA)?.toString()).toBe("17:15:00");
    expect(parseSpokenTime("a las siete y media", "es", LOLA)?.toString()).toBe("19:30:00");
    expect(parseSpokenTime("a la una y media", "es", LOLA)?.toString()).toBe("13:30:00");
    expect(parseSpokenTime("a las once menos cuarto", "es", LOLA)?.toString()).toBe("10:45:00");
    expect(parseSpokenTime("a las nueve de la noche", "es", LOLA)?.toString()).toBe("21:00:00");
    expect(parseSpokenTime("at quarter past five", "en", LOLA)?.toString()).toBe("17:15:00");
    expect(parseSpokenTime("at nine at night", "en")?.toString()).toBe("21:00:00");
    expect(parseSpokenTime("at noon", "en")?.toString()).toBe("12:00:00");
  });

  it('parses the feminine hour word "una" (regression, found by N1)', () => {
    // N1 failed on its first minute with "la una": 00:31 and every 13:xx came back null.
    expect(parseSpokenTime("a la una menos veintinueve de la noche", "es")?.toString()).toBe("00:31:00");
    expect(parseSpokenTime("a la una del mediodía", "es")?.toString()).toBe("13:00:00");
    expect(parseSpokenTime("a la uno", "es", LOLA)).toBeNull();
  });

  it("refuses words with no unique reading", () => {
    expect(parseSpokenTime("a las cinco", "es")).toBeNull();
    expect(parseSpokenTime("a las nueve", "es", LOLA)).toBeNull();
    expect(parseSpokenTime("a la dos", "es", LOLA)).toBeNull();
    expect(parseSpokenTime("a las once menos media", "es", LOLA)).toBeNull();
    expect(parseSpokenTime("at teatime", "en", LOLA)).toBeNull();
  });
});

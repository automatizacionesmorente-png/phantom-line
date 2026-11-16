import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { readWhen } from "@/lib/conversation/brain/when";
import { sessionsOfShop } from "@/lib/conversation/brain/read";
import { lolaSeedProfile } from "@/lib/db/seed";
import type { Lang } from "@/lib/sectors";

/** Day and time reading (front-desk-brain 5.1–5.7, design.md "Day and time" and task 1.3's forms). */
const sessionsOf = sessionsOfShop(lolaSeedProfile); // Tue–Sat 10:00–14:00 and 17:00–20:00
// Saturday 14 November 2026, the regression call's day.
const SAT = Temporal.PlainDate.from("2026-11-14");
const MON = Temporal.PlainDate.from("2026-11-16");

function read(text: string, today = SAT, lang: Lang = "es", defaultDay?: string) {
  const r = readWhen(text, today, lang, sessionsOf, { defaultDay: defaultDay ? Temporal.PlainDate.from(defaultDay) : null });
  return { day: r.day?.toString() ?? null, time: r.time?.toString().slice(0, 5) ?? null, part: r.partOfDay };
}

describe("readWhen: days (5.1)", () => {
  it.each([
    ["hoy", "2026-11-14"],
    ["mañana", "2026-11-15"],
    ["pasado mañana", "2026-11-16"],
    ["mañana sábado", "2026-11-15"],
    ["el martes", "2026-11-17"],
    ["este martes", "2026-11-17"],
    ["el martes que viene", "2026-11-17"],
    ["el próximo martes", "2026-11-17"],
    ["el sábado", "2026-11-21"],
    ["el veinte", "2026-11-20"],
    ["el 20", "2026-11-20"],
    ["el día 20", "2026-11-20"],
    ["el 20 de noviembre", "2026-11-20"],
    ["20 de diciembre", "2026-12-20"],
    ["el 3", "2026-12-03"],
    ["el martes veinticuatro", "2026-11-24"],
    ["el martes uno de diciembre", "2026-12-01"],
    ["20/11", "2026-11-20"],
    ["el 2/1", "2027-01-02"],
  ])("es %s → %s", (said, date) => {
    expect(read(said).day).toBe(date);
  });

  it.each([
    ["today", "2026-11-14"],
    ["tomorrow", "2026-11-15"],
    ["the day after tomorrow", "2026-11-16"],
    ["next Tuesday", "2026-11-17"],
    ["on Tuesday", "2026-11-17"],
    ["this Saturday", "2026-11-14"],
    ["the 20th", "2026-11-20"],
    ["November 20", "2026-11-20"],
    ["November the twentieth", "2026-11-20"],
    ["Tuesday the twenty-fourth", "2026-11-24"],
    ["Tuesday the first of December", "2026-12-01"],
  ])("en %s → %s", (said, date) => {
    expect(read(said, SAT, "en").day).toBe(date);
  });

  it("on Monday, 'this Tuesday' is tomorrow and 'next Tuesday' the week after", () => {
    expect(read("this Tuesday", MON, "en").day).toBe("2026-11-17");
    expect(read("next Tuesday", MON, "en").day).toBe("2026-11-24");
    expect(read("el martes", MON).day).toBe("2026-11-17");
  });
});

describe("readWhen: times (5.2, 5.3)", () => {
  it.each([
    // The forms Chrome wrote in real calls (task 1.3).
    ["a las 4:00 de la tarde", "16:00"],
    ["a las 17", "17:00"],
    ["a las cinco", "17:00"],
    // Digits (5.2).
    ["a las 5", "17:00"],
    ["17:30", "17:30"],
    ["17.30", "17:30"],
    ["a las 5:30", "17:30"],
    ["5pm", "17:00"],
    ["17h", "17:00"],
    ["a las 10", "10:00"],
    ["a las 5 y media", "17:30"],
    // Words (5.2).
    ["a las cinco y media", "17:30"],
    ["a las once menos cuarto", "10:45"],
    ["a la una", "13:00"],
    ["a la una de la tarde", "13:00"],
    ["a las doce del mediodía", "12:00"],
    ["a mediodía", "12:00"],
    ["sobre las seis", "18:00"],
    ["a las diez de la mañana", "10:00"],
    ["a las nueve de la noche", "21:00"],
    ["a las cinco y veinticinco", "17:25"],
    ["a las seis menos veinte", "17:40"],
  ])("es %s → %s", (said, time) => {
    expect(read(said).time).toBe(time);
  });

  it.each([
    ["at half past five", "17:30"],
    ["at noon", "12:00"],
    ["at midnight", "00:00"],
    ["at five", "17:00"],
    ["at 5 pm", "17:00"],
    ["at 10am", "10:00"],
    ["at quarter to six", "17:45"],
    ["at twenty-five past five", "17:25"],
    ["at five thirty", "17:30"],
    ["at five in the evening", "17:00"],
    ["at seven in the morning", "07:00"],
    ["at nine at night", "21:00"],
    ["at 5 o'clock", "17:00"],
  ])("en %s → %s", (said, time) => {
    expect(read(said, SAT, "en").time).toBe(time);
  });

  it("chooses the reading inside the day's sessions, else afternoon for 1–7 and morning for 8–11 (5.3)", () => {
    // Tuesday: 10–14 and 17–20.
    expect(read("el martes a las 11").time).toBe("11:00");
    expect(read("el martes a las 6").time).toBe("18:00");
    // Monday is closed: neither reading is inside.
    expect(read("el lunes a las 6").time).toBe("18:00");
    expect(read("el lunes a las 9").time).toBe("09:00");
    // 8:00 and 20:00 are both outside on Tuesday.
    expect(read("el martes a las 8").time).toBe("08:00");
    // A time with no day uses the Call's day when there is one.
    expect(read("a las 9", SAT, "es", "2026-11-17").time).toBe("09:00");
  });
});

describe("readWhen: part of the day, corrections and the non-cue filter (5.4, 5.5, 5.7)", () => {
  it("reads a part of the day alone, never as a time (5.4)", () => {
    expect(read("por la tarde")).toEqual({ day: null, time: null, part: "afternoon" });
    expect(read("mañana por la mañana")).toEqual({ day: "2026-11-15", time: null, part: "morning" });
    expect(read("esta tarde")).toEqual({ day: "2026-11-14", time: null, part: "afternoon" });
    expect(read("in the morning", SAT, "en")).toEqual({ day: null, time: null, part: "morning" });
    expect(read("good morning", SAT, "en").part).toBeNull();
    // A period that belongs to a time is that time's.
    expect(read("a las 5 de la tarde").part).toBeNull();
  });

  it("lets the last time and the last day win (5.5)", () => {
    expect(read("a las cinco, no, a las seis").time).toBe("18:00");
    expect(read("el martes, no, el miércoles").day).toBe("2026-11-18");
    expect(read("at five, no, at six", SAT, "en").time).toBe("18:00");
    expect(readWhen("a las cinco, no, a las seis", SAT, "es", sessionsOf).timeHits).toBe(2);
  });

  it("keeps a day without a time and a time without a day (5.6)", () => {
    expect(read("el martes")).toEqual({ day: "2026-11-17", time: null, part: null });
    expect(read("a las cinco")).toEqual({ day: null, time: "17:00", part: null });
    expect(read("mañana a las 5")).toEqual({ day: "2026-11-15", time: "17:00", part: null });
  });

  it.each([
    "mi teléfono es 612 34 56 78",
    "612-345-678",
    "+34 612 345 678",
    "son 25 euros",
    "dura 45 minutos",
    "una cita",
    "dos servicios",
    "somos 3 personas",
    "quería un corte",
    "me llamo Ana",
    "seis uno dos, treinta y cuatro, cincuenta y seis, setenta y ocho",
    "it costs 15 euros",
    "two services please",
    "it takes 30 minutes",
    "a haircut for one",
    "a table for two",
  ])("reads no day or time in %j (5.7)", (said) => {
    const r = read(said);
    expect(r.day).toBeNull();
    expect(r.time).toBeNull();
  });
});

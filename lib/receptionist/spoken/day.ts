import type { Temporal } from "temporal-polyfill";
import type { Lang } from "@/lib/sectors";
import { speakNumber, speakOrdinal } from "./numbers";

/**
 * Days in words, relative to today in the shop's time zone. Pure: only
 * PlainDate arithmetic, so a daylight-saving change cannot move a day. The
 * parser is `parseSpokenDay` in `parse.ts`.
 */

export const WEEKDAY_WORDS: Record<Lang, readonly string[]> = {
  es: ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};

export const MONTH_WORDS: Record<Lang, readonly string[]> = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

/**
 * Yesterday, today, tomorrow and the day after, keyed by days from today. `speakDay` says only
 * −1 to 1; the day after (2) is here so `parseSpokenDay` still understands a caller who says
 * "pasado mañana" / "the day after tomorrow".
 */
export const RELATIVE_DAY_WORDS: Record<Lang, Readonly<Record<-1 | 0 | 1 | 2, string>>> = {
  es: { [-1]: "ayer", 0: "hoy", 1: "mañana", 2: "pasado mañana" },
  en: { [-1]: "yesterday", 0: "today", 1: "tomorrow", 2: "the day after tomorrow" },
};

export interface SpeakDayOptions {
  /** For today and tomorrow, also say the weekday: "mañana viernes" / "tomorrow, Friday". */
  withWeekday?: boolean;
}

/** Today's calendar date in the shop's time zone, never the server's. */
export function todayIn(now: Temporal.Instant, timeZone: string): Temporal.PlainDate {
  return now.toZonedDateTimeISO(timeZone).toPlainDate();
}

/** Whole days from `today` to `date` (negative in the past). */
export function daysBetween(today: Temporal.PlainDate, date: Temporal.PlainDate): number {
  return today.until(date, { largestUnit: "days" }).days;
}

/**
 * A day as the receptionist says it: "ayer", "hoy", "mañana", "el sábado" (2 to
 * 6 days ahead, never "pasado mañana", "este" or "que viene"), "el sábado
 * veinte", "el sábado veinte de diciembre"; "yesterday", "today", "tomorrow",
 * "this Saturday" (2 to 6 days ahead, same Monday-to-Sunday week), "next
 * Saturday" (2 to 6 days ahead, next week), "Saturday the twentieth",
 * "Saturday the twentieth of December". Both dates are in the shop's time zone.
 */
export function speakDay(
  date: Temporal.PlainDate,
  today: Temporal.PlainDate,
  lang: Lang,
  opts: SpeakDayOptions = {},
): string {
  const d = daysBetween(today, date);
  const weekday = WEEKDAY_WORDS[lang][date.dayOfWeek - 1];
  // Owner's call, 2026-11-15: two days ahead is "el martes", never "pasado mañana".
  if (d >= -1 && d <= 1) {
    const rel = RELATIVE_DAY_WORDS[lang][d as -1 | 0 | 1];
    if (!opts.withWeekday || d < 0) return rel;
    return lang === "es" ? `${rel} ${weekday}` : `${rel}, ${weekday}`;
  }
  if (d >= 2 && d <= 6) {
    const sameWeek = today.dayOfWeek + d <= 7;
    if (lang === "es") return `el ${weekday}`;
    return sameWeek ? `this ${weekday}` : `next ${weekday}`;
  }
  const sameMonth = date.month === today.month && date.year === today.year;
  const month = MONTH_WORDS[lang][date.month - 1];
  if (lang === "es") {
    const base = `el ${weekday} ${speakNumber(date.day, "es")}`;
    return sameMonth ? base : `${base} de ${month}`;
  }
  const base = `${weekday} the ${speakOrdinal(date.day)}`;
  return sameMonth ? base : `${base} of ${month}`;
}

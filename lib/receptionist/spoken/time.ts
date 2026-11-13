import type { Lang } from "@/lib/sectors";
import type { Session } from "@/lib/booking";
import { speakNumber } from "./numbers";

/**
 * Times of day in words, as people say them in a Madrid salon or in English.
 * Pure. The parser is `parseSpokenTime` in `parse.ts`.
 */

/** A local wall-clock time; a `Temporal.PlainTime` fits. Seconds are ignored. */
export interface ClockTime {
  readonly hour: number;
  readonly minute: number;
}

/** One open session of a local date, in minutes from local midnight, half-open [open, close). */
export interface MinuteRange {
  readonly open: number;
  readonly close: number;
}

/** The open sessions of the date the time belongs to. Without it, the period of the day is always said. */
export interface TimeContext {
  readonly sessions: readonly MinuteRange[];
}

export const MINUTES_PER_DAY = 1440;
const HALF_DAY = 720;

/** "HH:MM" opening sessions to minute ranges. */
export function minuteSessions(sessions: readonly Session[]): MinuteRange[] {
  return sessions.map((s) => ({ open: hhmmToMinutes(s.open), close: hhmmToMinutes(s.close) }));
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minuteOfDay(t: ClockTime): number {
  return t.hour * 60 + t.minute;
}

export function isOpenAt(minute: number, ctx: TimeContext): boolean {
  return ctx.sessions.some((s) => minute >= s.open && minute < s.close);
}

/** The Period_Of_Day ranges, by the actual time (design.md). Each is shorter than 12 hours. */
export const PERIODS: Record<Lang, readonly { words: string; from: number; to: number }[]> = {
  es: [
    { words: "de la mañana", from: 6 * 60, to: 12 * 60 },
    { words: "del mediodía", from: 12 * 60, to: 14 * 60 },
    { words: "de la tarde", from: 14 * 60, to: 21 * 60 },
    { words: "de la noche", from: 21 * 60, to: 6 * 60 },
  ],
  en: [
    { words: "in the morning", from: 5 * 60, to: 12 * 60 },
    { words: "in the afternoon", from: 12 * 60, to: 18 * 60 },
    { words: "in the evening", from: 18 * 60, to: 21 * 60 },
    { words: "at night", from: 21 * 60, to: 5 * 60 },
  ],
};

/** Whether a minute of the day falls in a period range; a range may wrap past midnight. */
export function inPeriod(minute: number, p: { from: number; to: number }): boolean {
  return p.from < p.to ? minute >= p.from && minute < p.to : minute >= p.from || minute < p.to;
}

/** The period words for a time: "de la tarde" / "in the evening". */
export function periodOf(t: ClockTime, lang: Lang): string {
  const minute = minuteOfDay(t);
  const found = PERIODS[lang].find((p) => inPeriod(minute, p));
  // The ranges cover the whole day, so this never falls through.
  return (found ?? PERIODS[lang][0]).words;
}

/**
 * Whether the period of the day must be said (Requirement 6.5). It is left
 * out only when the time is inside an open session and its 12-hour twin on the
 * same day is not. 12:00 and 00:00 always carry it, and so does any time given
 * with no sessions.
 */
export function needsPeriod(minute: number, ctx?: TimeContext): boolean {
  if (minute === 0 || minute === HALF_DAY) return true;
  if (!ctx) return true;
  return !(isOpenAt(minute, ctx) && !isOpenAt((minute + HALF_DAY) % MINUTES_PER_DAY, ctx));
}

/** The hour word is the next hour's from minute 31 on ("las once menos cuarto"). */
function shownHour12(minute: number): number {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const shown = m <= 30 ? h : (h + 1) % 24;
  return shown % 12 || 12;
}

function esClock(minute: number): string {
  const m = minute % 60;
  const h12 = shownHour12(minute);
  const hour = h12 === 1 ? "la una" : `las ${speakNumber(h12, "es")}`;
  if (m === 0) return hour;
  if (m <= 30) return `${hour} y ${m === 15 ? "cuarto" : m === 30 ? "media" : speakNumber(m, "es")}`;
  const left = 60 - m;
  return `${hour} menos ${left === 15 ? "cuarto" : speakNumber(left, "es")}`;
}

function enMinutes(n: number): string {
  if (n % 5 === 0) return speakNumber(n, "en");
  return `${speakNumber(n, "en")} ${n === 1 ? "minute" : "minutes"}`;
}

function enClock(minute: number): string {
  if (minute === 0) return "midnight";
  if (minute === HALF_DAY) return "noon";
  const m = minute % 60;
  const hour = speakNumber(shownHour12(minute), "en");
  if (m === 0) return hour;
  if (m === 15) return `quarter past ${hour}`;
  if (m === 30) return `half past ${hour}`;
  if (m === 45) return `quarter to ${hour}`;
  if (m < 30) return `${enMinutes(m)} past ${hour}`;
  return `${enMinutes(60 - m)} to ${hour}`;
}

/**
 * The time without its preposition: "las cinco y cuarto", "la una y media",
 * "las nueve de la noche", "las doce del mediodía"; "quarter past five",
 * "nine at night", "noon".
 */
export function clockWords(t: ClockTime, lang: Lang, ctx?: TimeContext): string {
  const minute = minuteOfDay(t);
  if (lang === "en" && (minute === 0 || minute === HALF_DAY)) return enClock(minute);
  const clock = lang === "es" ? esClock(minute) : enClock(minute);
  return needsPeriod(minute, ctx) ? `${clock} ${periodOf(t, lang)}` : clock;
}

/**
 * A time as the receptionist says it, with its preposition: "a las cinco y
 * cuarto", "a la una y media", "a las nueve de la noche"; "at quarter past
 * five", "at noon". Never a digit. Pass the open sessions of that day so the
 * period of the day is said only when it is needed.
 */
export function speakTime(t: ClockTime, lang: Lang, ctx?: TimeContext): string {
  return `${lang === "es" ? "a" : "at"} ${clockWords(t, lang, ctx)}`;
}

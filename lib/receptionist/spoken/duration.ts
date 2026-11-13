import type { Lang } from "@/lib/sectors";
import { speakNumber } from "./numbers";

/**
 * How long a service takes, in words: "media hora", "una hora y media",
 * "veinte minutos"; "half an hour", "an hour and a half", "twenty minutes".
 * Pure, and never a digit. Whole minutes from 1 to 999 999.
 */
export function speakDuration(minutes: number, lang: Lang): string {
  if (!Number.isInteger(minutes) || minutes < 1) throw new RangeError("speakDuration covers whole minutes from 1");
  return lang === "es" ? esDuration(minutes) : enDuration(minutes);
}

function esMinutes(n: number): string {
  return n === 1 ? "un minuto" : `${speakNumber(n, "es")} minutos`;
}

function esHours(h: number): string {
  return h === 1 ? "una hora" : `${speakNumber(h, "es")} horas`;
}

function esDuration(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return m === 30 ? "media hora" : m === 15 ? "un cuarto de hora" : m === 45 ? "tres cuartos de hora" : esMinutes(m);
  if (m === 0) return esHours(h);
  if (m === 30) return `${esHours(h)} y media`;
  if (m === 15) return `${esHours(h)} y cuarto`;
  return `${esHours(h)} y ${esMinutes(m)}`;
}

function enMinutes(n: number): string {
  return n === 1 ? "one minute" : `${speakNumber(n, "en")} minutes`;
}

function enDuration(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return m === 30 ? "half an hour" : enMinutes(m);
  const hours = h === 1 ? "an hour" : `${speakNumber(h, "en")} hours`;
  if (m === 0) return hours;
  if (m === 30) return h === 1 ? "an hour and a half" : `${speakNumber(h, "en")} and a half hours`;
  return `${hours} and ${enMinutes(m)}`;
}

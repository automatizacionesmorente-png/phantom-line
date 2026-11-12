import type { Temporal } from "temporal-polyfill";
import type { Lang } from "@/lib/sectors";

const WEEKDAYS: Record<Lang, readonly string[]> = {
  es: ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}

/** Only the time, in the shop's zone: "a las 19:30" / "7:30 pm". */
export function formatTime(instant: Temporal.Instant, timeZone: string, lang: Lang): string {
  const z = instant.toZonedDateTimeISO(timeZone);
  const mm = String(z.minute).padStart(2, "0");
  if (lang === "es") {
    return `${z.hour === 1 ? "a la" : "a las"} ${String(z.hour).padStart(2, "0")}:${mm}`;
  }
  const h12 = z.hour % 12 === 0 ? 12 : z.hour % 12;
  const suffix = z.hour < 12 ? "am" : "pm";
  return z.minute === 0 ? `${h12} ${suffix}` : `${h12}:${mm} ${suffix}`;
}

/** A local date alone: "el viernes 13" / "Friday the 13th". */
export function formatDay(date: Temporal.PlainDate, lang: Lang): string {
  const weekday = WEEKDAYS[lang][date.dayOfWeek - 1];
  return lang === "es" ? `el ${weekday} ${date.day}` : `${weekday} the ${ordinal(date.day)}`;
}

/** Day and time in the shop's zone: "el miércoles 11 a las 19:30" / "Wednesday the 11th at 7:30 pm". */
export function formatSlot(instant: Temporal.Instant, timeZone: string, lang: Lang): string {
  const z = instant.toZonedDateTimeISO(timeZone);
  const weekday = WEEKDAYS[lang][z.dayOfWeek - 1];
  return lang === "es"
    ? `el ${weekday} ${z.day} ${formatTime(instant, timeZone, lang)}`
    : `${weekday} the ${ordinal(z.day)} at ${formatTime(instant, timeZone, lang)}`;
}

/**
 * Several slots as one spoken phrase; a slot on the same day as the one before
 * it says only the time: "el miércoles 11 a las 19:30, a las 19:15 o a las 19:00".
 */
export function formatSlotList(instants: readonly Temporal.Instant[], timeZone: string, lang: Lang): string {
  const parts = instants.map((instant, k) => {
    const sameDay =
      k > 0 &&
      instants[k - 1].toZonedDateTimeISO(timeZone).toPlainDate().equals(instant.toZonedDateTimeISO(timeZone).toPlainDate());
    if (!sameDay) return formatSlot(instant, timeZone, lang);
    return lang === "es" ? formatTime(instant, timeZone, lang) : `at ${formatTime(instant, timeZone, lang)}`;
  });
  return joinOr(parts, lang);
}

export function joinOr(parts: readonly string[], lang: Lang): string {
  return joinWith(parts, lang === "es" ? "o" : "or");
}
export function joinAnd(parts: readonly string[], lang: Lang): string {
  return joinWith(parts, lang === "es" ? "y" : "and");
}
function joinWith(parts: readonly string[], word: string): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ${word} ${parts[parts.length - 1]}`;
}

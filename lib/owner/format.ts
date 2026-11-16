/**
 * Written times and day headings for the owner's screen (owner-machine 9.2, 10.3, 10.8).
 * Self-contained on purpose: the receptionist's formatters in lib/receptionist turn into
 * spoken forms, which is right for a voice and wrong for a written agenda. Pure, no server
 * imports, so the browser uses it too. Every time is shown in the shop's zone.
 */
import type { Temporal } from "temporal-polyfill";
import type { Lang } from "@/lib/sectors";

const WEEKDAYS: Record<Lang, readonly string[]> = {
  es: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

/** The local clock time of an instant in the shop's zone: "19:30" / "7:30 pm", "10:00" / "10 am". */
export function formatClock(instant: Temporal.Instant, timeZone: string, lang: Lang): string {
  const z = instant.toZonedDateTimeISO(timeZone);
  const mm = String(z.minute).padStart(2, "0");
  if (lang === "es") return `${String(z.hour).padStart(2, "0")}:${mm}`;
  const h12 = z.hour % 12 === 0 ? 12 : z.hour % 12;
  const suffix = z.hour < 12 ? "am" : "pm";
  return z.minute === 0 ? `${h12} ${suffix}` : `${h12}:${mm} ${suffix}`;
}

/** A heading for a local date: "Viernes 13" / "Friday the 13th". */
export function formatDayHeading(date: Temporal.PlainDate, lang: Lang): string {
  const weekday = WEEKDAYS[lang][date.dayOfWeek - 1];
  return lang === "es" ? `${weekday} ${date.day}` : `${weekday} the ${ordinal(date.day)}`;
}

import { Temporal } from "temporal-polyfill";

/** "15", "15,5" and "15.50" are euros; anything else (negative, 3 decimals, text) is null. Result in cents. */
export function parseEuros(text: string): number | null {
  const m = /^(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + (m[2] === undefined ? 0 : Number(m[2].padEnd(2, "0")));
}

/** Cents as the text of an amount field: "15" or "15,50" (es) / "15.50" (en). */
export function eurosText(cents: number, lang: "es" | "en"): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  if (rest === 0) return String(whole);
  return `${whole}${lang === "es" ? "," : "."}${String(rest).padStart(2, "0")}`;
}

/** The shop-local `date` ("YYYY-MM-DD") and `time` ("HH:MM") of an instant. */
export function localParts(iso: string, tz: string): { date: string; time: string } {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
  return { date: z.toPlainDate().toString(), time: `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}` };
}

/** The instant of a shop-local date and time, or null when either is not a real value. */
export function localInstant(date: string, time: string, tz: string): Temporal.Instant | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  try {
    return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(tz).toInstant();
  } catch {
    return null;
  }
}

/** The next multiple of `stepMin` minutes after `now`, as shop-local date and time. */
export function nextSlot(nowIso: string, tz: string, stepMin: number): { date: string; time: string } {
  const z = Temporal.Instant.from(nowIso).toZonedDateTimeISO(tz).round({ smallestUnit: "minute", roundingMode: "floor" });
  const over = z.minute % stepMin;
  return localParts(z.add({ minutes: stepMin - over }).toInstant().toString(), tz);
}

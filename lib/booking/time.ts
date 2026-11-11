import { Temporal } from "temporal-polyfill";
import type { SessionInstants, ShopRules, Weekday } from "./types";

/**
 * A shop-local date and wall time as an instant. Uses Temporal's default
 * "compatible" disambiguation: a time in a spring-forward gap moves forward by
 * the gap, a repeated time in the fall-back hour takes the earlier instant.
 */
export function toInstant(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime,
  timeZone: string,
): Temporal.Instant {
  return date.toZonedDateTime({ timeZone, plainTime: time }).toInstant();
}

/** The calendar date of an instant in the given time zone (never the server's). */
export function localDateOf(instant: Temporal.Instant, timeZone: string): Temporal.PlainDate {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate();
}

/** The sessions of one local date, as instants in the shop's time zone. */
export function sessionsOn(date: Temporal.PlainDate, shop: ShopRules): SessionInstants[] {
  const sessions = shop.hours[date.dayOfWeek as Weekday] ?? [];
  return sessions.map((s) => ({
    open: toInstant(date, Temporal.PlainTime.from(s.open), shop.timeZone),
    close: toInstant(date, Temporal.PlainTime.from(s.close), shop.timeZone),
  }));
}

/** Half-open ranges [start, end): back-to-back ranges do not overlap. */
export function overlaps(
  a: { start: Temporal.Instant; end: Temporal.Instant },
  b: { start: Temporal.Instant; end: Temporal.Instant },
): boolean {
  return (
    Temporal.Instant.compare(a.start, b.end) < 0 && Temporal.Instant.compare(b.start, a.end) < 0
  );
}

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { parseSpokenDay, speakDay, todayIn } from "@/lib/receptionist/spoken";
import type { Lang } from "@/lib/sectors";

/**
 * N4. Days: relative words, no digits, round trip, and `today` in the shop's
 * zone across the 2026 Madrid DST weekends and around local midnight.
 * Validates 7.2–7.7, 13.2.
 */

const ZONE = "Europe/Madrid";
const LANGS: readonly Lang[] = ["es", "en"];
const RELATIVE: Record<Lang, readonly string[]> = {
  es: ["hoy", "mañana", "pasado mañana"],
  en: ["today", "tomorrow", "the day after tomorrow"],
};

/** The oracle for "today": the Madrid calendar date of an instant, from Intl, not from Temporal. */
const madridDate = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

const ms = (iso: string) => Date.parse(iso);
const anyIn2026 = fc.integer({ min: ms("2026-01-01T00:00:00Z"), max: ms("2026-12-31T23:59:59Z") });
/** Both change weekends, from Friday 22:00 UTC to Monday 02:00 UTC. */
const dstWeekends = fc.oneof(
  fc.integer({ min: ms("2026-03-27T22:00:00Z"), max: ms("2026-03-30T02:00:00Z") }),
  fc.integer({ min: ms("2026-10-23T22:00:00Z"), max: ms("2026-10-26T02:00:00Z") }),
);
/** 23:00–01:00 local time on any day of 2026. */
const aroundMidnight = fc
  .tuple(fc.integer({ min: 0, max: 364 }), fc.integer({ min: 0, max: 119 }))
  .map(([day, minute]) =>
    Temporal.PlainDate.from("2026-01-01")
      .add({ days: day })
      .toZonedDateTime({ timeZone: ZONE, plainTime: Temporal.PlainTime.from("23:00") })
      .add({ minutes: minute })
      .toInstant().epochMilliseconds,
  );
const arbNow = fc.oneof(anyIn2026, dstWeekends, aroundMidnight).map((x) => Temporal.Instant.fromEpochMilliseconds(x));

describe("N4: days are relative, digit-free, round-trip, and use the shop's today", () => {
  it("holds for any now in 2026 and targets from −1 to +60 days", () => {
    fc.assert(
      fc.property(arbNow, fc.integer({ min: -1, max: 60 }), fc.boolean(), (now, offset, withWeekday) => {
        const today = todayIn(now, ZONE);
        expect(today.toString()).toBe(madridDate.format(now.epochMilliseconds));
        const date = today.add({ days: offset });
        for (const lang of LANGS) {
          const words = speakDay(date, today, lang, { withWeekday });
          expect(words).not.toMatch(/\d/);
          if (offset >= 0 && offset <= 2) {
            const rel = RELATIVE[lang][offset];
            if (withWeekday) expect(words.startsWith(`${rel}${lang === "es" ? " " : ", "}`), words).toBe(true);
            else expect(words).toBe(rel);
          }
          expect(parseSpokenDay(words, today, lang)?.toString(), `"${words}" from ${today}`).toBe(date.toString());
        }
      }),
      { numRuns: 500 },
    );
  });
});

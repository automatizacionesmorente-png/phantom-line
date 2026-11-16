import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { readWhen } from "@/lib/conversation/brain/when";
import {
  periodOf,
  speakDay,
  speakDuration,
  speakNumber,
  speakPhone,
  speakPrice,
  speakTime,
  type MinuteRange,
} from "@/lib/receptionist/spoken";
import type { Lang } from "@/lib/sectors";

/**
 * B9 of front-desk-brain design.md: days and times are read as said, and only when said
 * (5.1–5.3, 5.5, 5.7). Session sets are random, todays include both 2026 Madrid DST weekends.
 */
const NUM_RUNS = 200;
const DST_DATES = ["2026-03-28", "2026-03-29", "2026-10-24", "2026-10-25"];

type Week = Record<number, MinuteRange[]>;
/** 1 or 2 sessions per weekday on the 15-minute grid, between 06:00 and 23:00. */
const arbDay: fc.Arbitrary<MinuteRange[]> = fc
  .tuple(fc.integer({ min: 24, max: 80 }), fc.integer({ min: 2, max: 24 }), fc.option(fc.tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 2, max: 16 })), { nil: null }))
  .map(([open, len, second]) => {
    const a = { open: open * 15, close: Math.min((open + len) * 15, 92 * 15) };
    if (!second) return [a];
    const bOpen = a.close + second[0] * 15;
    const b = { open: bOpen, close: Math.min(bOpen + second[1] * 15, 92 * 15) };
    return b.open < b.close ? [a, b] : [a];
  });
const arbWeek: fc.Arbitrary<Week> = fc.array(arbDay, { minLength: 7, maxLength: 7 }).map((d) => Object.fromEntries(d.map((s, k) => [k + 1, s])));
const arbToday = fc.oneof(
  fc.constantFrom(...DST_DATES).map((d) => Temporal.PlainDate.from(d)),
  fc.integer({ min: 0, max: 364 }).map((n) => Temporal.PlainDate.from("2026-01-01").add({ days: n })),
);
const inside = (m: number, s: readonly MinuteRange[]) => s.some((r) => m >= r.open && m < r.close);

/** A date within 14 days and a time on the 5-minute grid inside that date's sessions. */
const arbCase = fc
  .record({ week: arbWeek, today: arbToday, ahead: fc.integer({ min: 0, max: 14 }), pick: fc.nat(), lang: fc.constantFrom<Lang>("es", "en") })
  .map(({ week, today, ahead, pick, lang }) => {
    const date = today.add({ days: ahead });
    const sessions = week[date.dayOfWeek];
    const grid: number[] = [];
    for (const s of sessions) for (let m = Math.ceil(s.open / 5) * 5; m < s.close; m += 5) grid.push(m);
    const minute = grid[pick % grid.length];
    return { week, today, date, sessions, minute, lang, ahead };
  });

type Form = "spoken" | "digits24" | "digitsDot" | "digitsH" | "digitsPeriod" | "digitsBare";

/** The 5.3 rule, written on its own: the reading inside the sessions, else by the said hour. */
function ruleReads(h12: number, mm: number, sessions: readonly MinuteRange[]): number {
  const base = (h12 % 12) * 60 + mm;
  const cands = [base, base + 720].filter((m) => inside(m, sessions));
  if (cands.length === 1) return cands[0];
  return h12 >= 8 && h12 <= 11 ? base : base + 720;
}

function timeText(minute: number, form: Form, lang: Lang, sessions: readonly MinuteRange[]): string | null {
  const h = Math.floor(minute / 60);
  const mm = minute % 60;
  const t = { hour: h, minute: mm };
  const two = String(mm).padStart(2, "0");
  const at = lang === "es" ? "a las" : "at";
  switch (form) {
    case "spoken":
      return speakTime(t, lang, { sessions });
    case "digits24":
      return `${at} ${h}:${two}`;
    case "digitsDot":
      return lang === "es" ? `${at} ${h}.${two}` : `${at} ${h}:${two}`;
    case "digitsH":
      return mm === 0 ? `${h}h` : `${h}h${two}`;
    case "digitsPeriod": {
      if (h === 0 || h === 12) return null;
      const h12 = h % 12;
      if (lang === "en") return `${at} ${h12}:${two} ${h < 12 ? "am" : "pm"}`;
      return `${h12 === 1 ? "a la" : "a las"} ${h12}:${two} ${periodOf(t, "es")}`;
    }
    case "digitsBare": {
      // A 12-hour hour with no period: only when the 5.3 rule reads it back as this time.
      const h12 = h % 12 || 12;
      if (ruleReads(h12, mm, sessions) !== minute) return null;
      return mm === 0 ? `${at} ${h12}` : `${at} ${h12}:${two}`;
    }
  }
}

describe("B9. Days and times are read as said, and only when said", () => {
  it("reads the date and the time in every form (5.1–5.3), and the last one said (5.5)", () => {
    const seen: Record<string, number> = {};
    const hit = (k: string) => (seen[k] = (seen[k] ?? 0) + 1);
    fc.assert(
      fc.property(
        arbCase,
        fc.constantFrom<Form>("spoken", "spoken", "digits24", "digitsDot", "digitsH", "digitsPeriod", "digitsBare"),
        fc.boolean(),
        fc.integer({ min: 0, max: 14 }),
        fc.nat(),
        ({ week, today, date, sessions, minute, lang }, form, correct, otherAhead, otherPick) => {
          const sessionsOf = (d: Temporal.PlainDate) => week[d.dayOfWeek];
          const time = timeText(minute, form, lang, sessions);
          fc.pre(time !== null);
          const day = speakDay(date, today, lang);
          let said = `${day} ${time}`;
          let expDate = date;
          let expMinute = minute;
          if (correct) {
            // "X, no, Y": the second day and time count.
            const d2 = today.add({ days: otherAhead });
            const s2 = week[d2.dayOfWeek];
            const grid: number[] = [];
            for (const s of s2) for (let m = Math.ceil(s.open / 5) * 5; m < s.close; m += 5) grid.push(m);
            const m2 = grid[otherPick % grid.length];
            said = `${said}, no, ${speakDay(d2, today, lang)} ${speakTime({ hour: Math.floor(m2 / 60), minute: m2 % 60 }, lang, { sessions: s2 })}`;
            expDate = d2;
            expMinute = m2;
            hit("correction");
          }
          hit(form);
          hit(lang);
          hit(`ahead-${Math.min(Temporal.PlainDate.compare(date, today) === 0 ? 0 : today.until(date).days, 7)}`);
          const r = readWhen(said, today, lang, sessionsOf);
          expect(r.day?.toString(), said).toBe(expDate.toString());
          expect(r.time?.toString().slice(0, 5), said).toBe(
            `${String(Math.floor(expMinute / 60)).padStart(2, "0")}:${String(expMinute % 60).padStart(2, "0")}`,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
    for (const k of ["spoken", "digits24", "digitsDot", "digitsH", "digitsPeriod", "digitsBare", "correction", "es", "en", "ahead-0", "ahead-1", "ahead-7"])
      expect(seen[k] ?? 0, k).toBeGreaterThan(0);
  });

  it("reads no day and no time from words that are not a day or time cue (5.7)", () => {
    const seen: Record<string, number> = {};
    const arbMobile = fc
      .tuple(fc.constantFrom("6", "7"), fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 8, maxLength: 8 }))
      .map(([a, rest]) => a + rest.join(""));
    const arbNonTime = fc.oneof(
      fc.tuple(fc.integer({ min: 1, max: 99_999 }), fc.constantFrom<Lang>("es", "en")).map(([c, l]) => ({ kind: "price", text: `${l === "es" ? "son" : "it's"} ${speakPrice(c, l)}` })),
      fc.integer({ min: 1, max: 999 }).map((e) => ({ kind: "priceDigits", text: `cuesta ${e} euros` })),
      fc.tuple(fc.integer({ min: 1, max: 480 }), fc.constantFrom<Lang>("es", "en")).map(([m, l]) => ({ kind: "duration", text: `${l === "es" ? "dura" : "it takes"} ${speakDuration(m, l)}` })),
      fc.integer({ min: 1, max: 240 }).map((m) => ({ kind: "durationDigits", text: `tarda ${m} minutos` })),
      arbMobile.map((p) => ({ kind: "phone", text: `mi teléfono es ${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 7)} ${p.slice(7)}` })),
      arbMobile.map((p) => ({ kind: "phoneDash", text: `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` })),
      arbMobile.map((p) => ({ kind: "phoneWords", text: speakPhone(`+34${p}`, "es") })),
      arbMobile.map((p) => ({ kind: "phonePlus", text: `+34 ${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` })),
      fc.integer({ min: 1, max: 9 }).map((n) => ({ kind: "count", text: `somos ${speakNumber(n, "es")} personas` })),
      fc.constantFrom("una cita", "dos servicios", "un corte y una barba", "quería una cita para dos", "two services please", "a haircut for one").map((t) => ({ kind: "noun", text: t })),
      fc.constantFrom("me llamo Ana García", "soy Luis", "my name is John", "a nombre de María José").map((t) => ({ kind: "name", text: t })),
    );
    fc.assert(
      fc.property(arbNonTime, arbToday, arbWeek, ({ kind, text }, today, week) => {
        seen[kind] = (seen[kind] ?? 0) + 1;
        const r = readWhen(text, today, "es", (d) => week[d.dayOfWeek]);
        expect(r.day, text).toBeNull();
        expect(r.time, text).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
    for (const k of ["price", "priceDigits", "duration", "durationDigits", "phone", "phoneDash", "phoneWords", "phonePlus", "count", "noun", "name"])
      expect(seen[k] ?? 0, k).toBeGreaterThan(0);
  });
});

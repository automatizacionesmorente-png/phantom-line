import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { minuteSessions, parseSpokenTime, speakTime, type TimeContext } from "@/lib/receptionist/spoken";
import type { Lang } from "@/lib/sectors";

/**
 * N1–N3: times of day. Every property runs over all 1 440 minutes
 * exhaustively, in both languages, for no context, for Lola's sessions, and
 * for random session sets (0–3 sessions on 5-minute boundaries).
 */

const LANGS: readonly Lang[] = ["es", "en"];
const ALL_MINUTES = Array.from({ length: 1440 }, (_, m) => m);
const LOLA: TimeContext = { sessions: minuteSessions([{ open: "10:00", close: "14:00" }, { open: "17:00", close: "20:00" }]) };

/** 0–3 disjoint sessions [open, close) on 5-minute boundaries, close up to 24:00. */
const arbContext: fc.Arbitrary<TimeContext> = fc
  .uniqueArray(fc.integer({ min: 0, max: 288 }), { maxLength: 6 })
  .map((xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const sessions: { open: number; close: number }[] = [];
    for (let i = 0; i + 1 < s.length; i += 2) sessions.push({ open: s[i] * 5, close: s[i + 1] * 5 });
    return { sessions };
  });

const FIXED_CONTEXTS: readonly [string, TimeContext | undefined][] = [
  ["no context", undefined],
  ["Lola", LOLA],
];

const plain = (m: number) => Temporal.PlainTime.from({ hour: Math.floor(m / 60), minute: m % 60 });
/** A plain object is a ClockTime too, and much cheaper than a polyfilled PlainTime in a 576 000-step loop. */
const clock = (m: number) => ({ hour: Math.floor(m / 60), minute: m % 60 });

/** Written here, independently of the implementation. */
function openAt(m: number, ctx: TimeContext): boolean {
  return ctx.sessions.some((s) => s.open <= m && m < s.close);
}
const PERIOD_ENDINGS: Record<Lang, readonly string[]> = {
  es: [" de la mañana", " del mediodía", " de la tarde", " de la noche"],
  en: [" in the morning", " in the afternoon", " in the evening", " at night"],
};
function hasPeriod(words: string, lang: Lang): boolean {
  if (lang === "en" && (words === "at noon" || words === "at midnight")) return true;
  return PERIOD_ENDINGS[lang].some((p) => words.endsWith(p));
}

/**
 * Plain comparisons first, `expect` only on a mismatch: the same assertions,
 * but 200 runs × 2 880 round trips stay within the test timeout.
 */
function checkN1(ctx: TimeContext | undefined): void {
  for (const lang of LANGS) {
    for (const m of ALL_MINUTES) {
      const words = speakTime(clock(m), lang, ctx);
      const back = parseSpokenTime(words, lang, ctx);
      const ok = !/\d/.test(words) && back !== null && back.hour * 60 + back.minute === m;
      if (ok) continue;
      expect(words, `${m} ${lang}`).not.toMatch(/\d/);
      expect(back?.toString(), `"${words}" (${lang})`).toBe(plain(m).toString());
    }
  }
}

function checkN2(ctx: TimeContext | undefined): void {
  for (const m of ALL_MINUTES) {
    const words = speakTime(clock(m), "es", ctx);
    const h = Math.floor(m / 60);
    const shown = m % 60 <= 30 ? h : (h + 1) % 24;
    const isUna = shown % 12 === 1;
    const ok =
      words.startsWith("a la una") === isUna &&
      (isUna || words.startsWith("a las ")) &&
      !/cero|las 0/.test(words) &&
      !(h === 0 && m % 60 <= 30 && !words.startsWith("a las doce"));
    if (ok) continue;
    expect(words.startsWith("a la una"), words).toBe(isUna);
    if (!isUna) expect(words.startsWith("a las "), words).toBe(true);
    expect(words).not.toMatch(/cero|las 0/);
    if (h === 0 && m % 60 <= 30) expect(words.startsWith("a las doce"), words).toBe(true);
  }
}

function checkN3(ctx: TimeContext | undefined): void {
  for (const lang of LANGS) {
    for (const m of ALL_MINUTES) {
      const words = speakTime(clock(m), lang, ctx);
      const expected =
        ctx === undefined || !openAt(m, ctx) || openAt((m + 720) % 1440, ctx) || m === 0 || m === 720;
      if (hasPeriod(words, lang) !== expected) expect(hasPeriod(words, lang), `"${words}"`).toBe(expected);
    }
  }
}

/** 200 runs over every minute in both languages take a few seconds. */
const LONG = 60_000;

describe("N1: times have no digits and round-trip (Validates 6.7, 6.8, 13.1)", () => {
  it.each(FIXED_CONTEXTS)("over all minutes with %s", (_, ctx) => checkN1(ctx));
  it("over all minutes with random sessions", () => {
    fc.assert(fc.property(arbContext, (ctx) => checkN1(ctx)), { numRuns: 200 });
  }, LONG);
});

describe('N2: "la una" / "las N", never "cero" (Validates 6.3, 13.1)', () => {
  it.each(FIXED_CONTEXTS)("over all minutes with %s", (_, ctx) => checkN2(ctx));
  it("over all minutes with random sessions", () => {
    fc.assert(fc.property(arbContext, (ctx) => checkN2(ctx)), { numRuns: 200 });
  }, LONG);
});

describe("N3: the period appears exactly when it is needed (Validates 6.5)", () => {
  it.each(FIXED_CONTEXTS)("over all minutes with %s", (_, ctx) => checkN3(ctx));
  it("over all minutes with random sessions", () => {
    fc.assert(fc.property(arbContext, (ctx) => checkN3(ctx)), { numRuns: 200 });
  }, LONG);
});

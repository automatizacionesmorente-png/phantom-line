import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DIGIT_WORDS,
  parseNumber,
  parsePhone,
  parsePrice,
  speakNumber,
  speakPhone,
  speakPrice,
} from "@/lib/receptionist/spoken";
import type { Lang } from "@/lib/sectors";

const arbLang = fc.constantFrom<Lang>("es", "en");

describe("N5: numbers 0–999 999 round-trip with no digits (Validates 8.2, 8.5)", () => {
  it("speaks and parses back every number", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999_999 }), arbLang, fc.boolean(), (n, lang, apocope) => {
        const words = speakNumber(n, lang, { apocope });
        expect(words).not.toMatch(/\d/);
        expect(parseNumber(words, lang)).toBe(n);
      }),
      { numRuns: 1000 },
    );
  });

  it("gives the exact Spanish forms", () => {
    expect(speakNumber(21, "es")).toBe("veintiuno");
    expect(speakNumber(21, "es", { apocope: true })).toBe("veintiún");
    expect(speakNumber(100, "es")).toBe("cien");
    expect(speakNumber(101, "es")).toBe("ciento uno");
    expect(speakNumber(500, "es")).toBe("quinientos");
    expect(speakNumber(700, "es")).toBe("setecientos");
    expect(speakNumber(900, "es")).toBe("novecientos");
  });
});

describe("N6: prices and Spanish phones round-trip (Validates 8.1, 8.3)", () => {
  it("prices from 0 to 99 999 cents", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999 }), arbLang, (cents, lang) => {
        const words = speakPrice(cents, lang);
        expect(words).not.toMatch(/\d/);
        expect(parsePrice(words, lang)).toBe(cents);
      }),
      { numRuns: 1000 },
    );
  });

  const arbSpanishMobile = fc
    .tuple(fc.constantFrom("6", "7"), fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 8, maxLength: 8 }))
    .map(([first, rest]) => `+34${first}${rest.join("")}`);

  it("Spanish mobiles are read in exactly 3 groups of 3 digit words", () => {
    fc.assert(
      fc.property(arbSpanishMobile, arbLang, (phone, lang) => {
        const words = speakPhone(phone, lang);
        expect(words).not.toMatch(/\d/);
        const groups = words.split("; ");
        expect(groups).toHaveLength(3);
        for (const g of groups) {
          const ws = g.split(", ");
          expect(ws).toHaveLength(3);
          for (const w of ws) expect(DIGIT_WORDS[lang]).toContain(w);
        }
        expect(parsePhone(words, lang)).toBe(phone);
      }),
      { numRuns: 500 },
    );
  });

  it("other E.164 numbers round-trip with their country code", () => {
    const arbE164 = fc
      .tuple(fc.integer({ min: 1, max: 9 }), fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 7, maxLength: 14 }))
      .map(([first, rest]) => `+${first}${rest.join("")}`);
    fc.assert(
      fc.property(arbE164, arbLang, (phone, lang) => {
        const words = speakPhone(phone, lang);
        expect(words).not.toMatch(/\d/);
        expect(parsePhone(words, lang)).toBe(phone);
      }),
      { numRuns: 500 },
    );
  });
});

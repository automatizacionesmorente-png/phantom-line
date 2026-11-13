import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_TEMPLATE_SENTENCES, toSpokenReply } from "@/lib/receptionist/speech";
import type { Lang } from "@/lib/sectors";

/**
 * N9. The safety net leaves no digits and is idempotent. For all strings,
 * including generated digit times, prices, phones, ordinals and plain numbers,
 * and both languages: `toSpokenReply(s, lang)` contains no digit, and a second
 * pass changes nothing. The limits of S4 (sentences, words, no markup) hold
 * with a language too. S4 itself, with no language, is unchanged in
 * `speech.property.test.ts`. Validates natural-voice 11.4, 11.5, 13.5.
 */

const lang = fc.constantFrom<Lang>("es", "en");
const hour = fc.integer({ min: 0, max: 23 });
const hour12 = fc.integer({ min: 1, max: 12 });
const minute = fc.integer({ min: 0, max: 59 });
const two = (n: number) => String(n).padStart(2, "0");

/** Digit times the way a model or a recognizer writes them. */
const digitTime = fc.oneof(
  fc.tuple(fc.constantFrom("a las ", "a la ", "at ", "las ", "", "de "), hour, minute, fc.constantFrom("", "h", " h", " horas", "hrs")).map(
    ([p, h, m, s]) => `${p}${h}:${two(m)}${s}`,
  ),
  fc.tuple(fc.constantFrom("a las ", "at "), hour, minute).map(([p, h, m]) => `${p}${h}.${two(m)}h`),
  fc.tuple(fc.constantFrom("a las ", "a la ", "at "), hour).map(([p, h]) => `${p}${h}`),
  fc.tuple(hour12, minute, fc.constantFrom("am", "pm", "a.m.", "p.m.", " am", " PM", " a. m.")).map(
    ([h, m, s]) => `${h}:${two(m)}${s}`,
  ),
  fc.tuple(fc.constantFrom("a las ", "at ", ""), hour12, fc.constantFrom(" de la tarde", " de la mañana", " de la noche", " del mediodía", " in the evening", " at night")).map(
    ([p, h, s]) => `${p}${h}${s}`,
  ),
  // Out of range: still digits to remove.
  fc.tuple(fc.integer({ min: 24, max: 99 }), fc.integer({ min: 0, max: 99 })).map(([h, m]) => `a las ${h}:${two(m)}`),
);

const cents = fc.integer({ min: 0, max: 99_999_99 });
const price = fc.oneof(
  cents.map((c) => `${Math.floor(c / 100)} €`),
  cents.map((c) => `${Math.floor(c / 100)},${two(c % 100)} €`),
  cents.map((c) => `${Math.floor(c / 100)}€`),
  cents.map((c) => `€${Math.floor(c / 100)}.${two(c % 100)}`),
  cents.map((c) => `€ ${Math.floor(c / 100)}`),
  cents.map((c) => `${Math.floor(c / 100)} euros`),
  fc.integer({ min: 1, max: 999 }).map((n) => `1.${String(n).padStart(3, "0")} €`),
);

const digit = fc.integer({ min: 0, max: 9 }).map(String);
const phone = fc.oneof(
  fc.array(digit, { minLength: 9, maxLength: 9 }).map((d) => `${d.slice(0, 3).join("")} ${d.slice(3, 6).join("")} ${d.slice(6).join("")}`),
  fc.array(digit, { minLength: 9, maxLength: 9 }).map((d) => d.join("")),
  fc.array(digit, { minLength: 9, maxLength: 9 }).map((d) => `+34 ${d.join("")}`),
  fc.tuple(fc.array(digit, { minLength: 6, maxLength: 20 }), fc.constantFrom("", " ", ".", "-")).map(([d, sep]) => d.join(sep)),
);

const ordinal = fc.oneof(
  fc.integer({ min: 0, max: 999_999 }).map((n) => `${n}${["th", "st", "nd", "rd"][n % 4]}`),
  fc.integer({ min: 0, max: 99 }).map((n) => `${n}ª`),
  fc.integer({ min: 0, max: 99 }).map((n) => `${n}.º`),
);

const number = fc.oneof(
  fc.integer({ min: 0, max: 999_999 }).map(String),
  fc.tuple(fc.integer({ min: 1, max: 9 }), fc.array(digit, { minLength: 6, maxLength: 29 })).map(([lead, rest]) => `${lead}${rest.join("")}`),
  fc.tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 999 })).map(([a, b]) => `${a},${b}`),
  fc.tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 999 })).map(([a, b]) => `${a}.${b}`),
  fc.array(fc.integer({ min: 0, max: 999 }), { minLength: 2, maxLength: 5 }).map((xs) => xs.join(".")),
  fc.constantFrom("007", "0", "00", "1.2.3", "2,5", "abc123def", "x9", "9x", "1/2", "50%", "3-4", "10–12"),
);

const word = fc.constantFrom(
  "hola", "Te", "espero", "mañana", "sábado", "Tengo", "libre", "o", "y", "cita", "corte", "cuesta", "Lola", "vale",
  "See", "you", "the", "is", "or", "and", "then", "sharp", "minutes", "minutos", "the", "el", "tu", "teléfono",
);
const glue = fc.constantFrom(" ", " ", " ", ", ", ". ", "? ", "! ", "…", "\n", "\n- ", "\n1. ", "**", "(", ")", ":", ";", "", "€", "h");

const piece = fc.oneof(
  { weight: 3, arbitrary: word },
  { weight: 3, arbitrary: glue },
  { weight: 2, arbitrary: digitTime },
  { weight: 2, arbitrary: price },
  { weight: 1, arbitrary: phone },
  { weight: 1, arbitrary: ordinal },
  { weight: 2, arbitrary: number },
  { weight: 1, arbitrary: digit },
  { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 6 }) },
);

/** Mostly text that looks like a model reply with digits in it, sometimes any unicode string. */
const arbText = fc.oneof(
  { weight: 5, arbitrary: fc.array(piece, { maxLength: 60 }).map((xs) => xs.join("")) },
  { weight: 1, arbitrary: fc.string({ unit: "grapheme", maxLength: 300 }) },
);

/** The same oracle as S4, written independently of the implementation. */
function oracleSentences(text: string): string[] {
  return text
    .replace(/(\d)\.(?=\d)/g, "$1\u0001")
    .split(/[.!?…]+/)
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}
const MARKDOWN = /[*_#`~[\]|<>{}\\]/;
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0f]/u;

describe("N9: the safety net in toSpokenReply(text, lang)", () => {
  it("leaves no digit, for the model's limit and the template limit", () => {
    fc.assert(
      fc.property(arbText, lang, fc.constantFrom(undefined, MAX_TEMPLATE_SENTENCES), (text, l, maxSentences) => {
        const out = toSpokenReply(text, l, { maxSentences });
        expect(out).not.toMatch(/\d/);
      }),
      { numRuns: 500 },
    );
  });

  it("is idempotent: a second pass changes nothing", () => {
    fc.assert(
      fc.property(arbText, lang, fc.constantFrom(undefined, MAX_TEMPLATE_SENTENCES), (text, l, maxSentences) => {
        const once = toSpokenReply(text, l, { maxSentences });
        expect(toSpokenReply(once, l, { maxSentences })).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  it("keeps the S4 limits with a language: sentences, 25 words, no markup, emoji or newline", () => {
    fc.assert(
      fc.property(arbText, lang, fc.constantFrom(undefined, MAX_TEMPLATE_SENTENCES), (text, l, maxSentences) => {
        const out = toSpokenReply(text, l, { maxSentences });
        const sentences = oracleSentences(out);
        expect(sentences.length).toBeLessThanOrEqual(maxSentences ?? 2);
        for (const s of sentences) expect(s.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(25);
        expect(out).not.toMatch(MARKDOWN);
        expect(out).not.toMatch(EMOJI);
        expect(out).not.toMatch(/\n/);
      }),
      { numRuns: 300 },
    );
  });

  it("changes nothing in a text that has no digit, apart from the S4 cleanup", () => {
    fc.assert(
      fc.property(arbText.map((s) => s.replace(/\d/g, "")), lang, (text, l) => {
        expect(toSpokenReply(text, l)).toBe(toSpokenReply(text));
      }),
      { numRuns: 300 },
    );
  });
});

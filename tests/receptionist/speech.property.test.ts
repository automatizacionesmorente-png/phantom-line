import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { toSpokenReply } from "@/lib/receptionist/speech";

/**
 * S4. For all strings, toSpokenReply returns at most 2 sentences of at most 25
 * words each, with no markdown or emoji. Validates 4.11.
 *
 * The sentence oracle is written here independently of the implementation:
 * a sentence ends at a run of . ! ? … (a dot between two digits is part of a
 * number), and only pieces with a letter or a digit count.
 */
function oracleSentences(text: string): string[] {
  return text
    .replace(/(\d)\.(?=\d)/g, "$1\u0001")
    .split(/[.!?…]+/)
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}
const MARKDOWN = /[*_#`~[\]|<>{}\\]/;
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0f]/u;
const LIST_LINE = /(^|\n)\s*([-+*•]|\d+[.)])\s/;

const word = fc.oneof(
  fc.constantFrom("hola", "cita", "corte", "19:30", "15.50", "mañana", "¿vale", "sí", "Lola", "ok", "—", "a"),
  fc.string({ minLength: 1, maxLength: 8 }),
);
const piece = fc.oneof(
  word,
  fc.constantFrom(" ", "  ", "\n", "\n- ", "\n1. ", ". ", "! ", "? ", "…", ".", "**", "_", "#", "`", "[x](http://y)", "> ", "|"),
  fc.constantFrom("😀", "👩🏽‍🦰", "🇪🇸", "✂️", "🎃", "1️⃣", "©"),
);
/** Mostly text that looks like a model reply, sometimes any unicode string. */
const arbText = fc.oneof(
  { weight: 4, arbitrary: fc.array(piece, { maxLength: 120 }).map((xs) => xs.join("")) },
  { weight: 1, arbitrary: fc.string({ unit: "grapheme", maxLength: 300 }) },
);

describe("S4: toSpokenReply", () => {
  it("returns at most 2 sentences of at most 25 words, with no markdown or emoji", () => {
    fc.assert(
      fc.property(arbText, (text) => {
        const out = toSpokenReply(text);
        const sentences = oracleSentences(out);
        expect(sentences.length).toBeLessThanOrEqual(2);
        for (const s of sentences) expect(s.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(25);
        expect(out).not.toMatch(MARKDOWN);
        expect(out).not.toMatch(EMOJI);
        expect(out).not.toMatch(LIST_LINE);
        expect(out).not.toMatch(/\n/);
      }),
      { numRuns: 300 },
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(arbText, (text) => {
        const once = toSpokenReply(text);
        expect(toSpokenReply(once)).toBe(once);
      }),
      { numRuns: 300 },
    );
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { matchesCaller, normalizeName } from "@/lib/conversation/matchCaller";

const NUM_RUNS = 200;
const LETTERS = "abcdefghijklmnopqrstuvwxyzáéíóúñü".split("");
const TOGGLE: Record<string, string> = {
  a: "á", á: "a", e: "é", é: "e", i: "í", í: "i", o: "ó", ó: "o", u: "ú", ú: "u", n: "ñ", ñ: "n", ü: "u",
};

const arbWord = fc.array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 10 }).map((cs) => cs.join(""));
const arbName = fc.array(arbWord, { minLength: 1, maxLength: 3 });
const arbPhone = fc.integer({ min: 600_000_000, max: 799_999_999 }).map((n) => `+34${n}`);

/** A variant that only changes case, toggles accents, or adds spaces. */
const arbVariant = (words: string[]) =>
  fc
    .record({
      chars: fc.array(fc.record({ upper: fc.boolean(), toggle: fc.boolean() }), {
        minLength: words.join("").length,
        maxLength: words.join("").length,
      }),
      gaps: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: words.length, maxLength: words.length }),
      lead: fc.integer({ min: 0, max: 2 }),
      trail: fc.integer({ min: 0, max: 2 }),
    })
    .map(({ chars, gaps, lead, trail }) => {
      let k = 0;
      const out = words.map((w) =>
        [...w]
          .map((ch) => {
            const c = chars[k++];
            const t = c.toggle && TOGGLE[ch] ? TOGGLE[ch] : ch;
            return c.upper ? t.toUpperCase() : t;
          })
          .join(""),
      );
      return " ".repeat(lead) + out.map((w, i) => (i === 0 ? w : " ".repeat(gaps[i]) + w)).join("") + " ".repeat(trail);
    });

// S7. The Booking_Match. Validates 12.1, 12.2, 12.7.
describe("S7: Booking_Match", () => {
  it("(a) case, accent and spacing variants of the name match", () => {
    fc.assert(
      fc.property(
        arbName.chain((words) => fc.tuple(fc.constant(words.join(" ")), arbVariant(words))),
        arbPhone,
        ([name, variant], phone) => {
          expect(matchesCaller({ name: variant, phone }, { customerName: name, customerPhone: phone })).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("(b) a different normalized name never matches, even with the right phone", () => {
    // Near misses: one letter changed, added or dropped, plus unrelated names.
    const arbPair = fc.oneof(
      fc.tuple(arbName.map((w) => w.join(" ")), arbName.map((w) => w.join(" "))),
      arbName.chain((words) =>
        fc
          .tuple(fc.nat(), fc.constantFrom(...LETTERS), fc.constantFrom("replace", "insert", "drop"))
          .map(([pos, ch, op]) => {
            const s = words.join(" ");
            const p = pos % s.length;
            const other =
              op === "replace" ? s.slice(0, p) + ch + s.slice(p + 1) : op === "insert" ? s.slice(0, p) + ch + s.slice(p) : s.slice(0, p) + s.slice(p + 1);
            return [s, other] as [string, string];
          }),
      ),
    );
    fc.assert(
      fc.property(arbPair, arbPhone, ([a, b], phone) => {
        if (normalizeName(a) === normalizeName(b)) return;
        expect(matchesCaller({ name: b, phone }, { customerName: a, customerPhone: phone })).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("(c) different normalized phones never match, whatever the names", () => {
    fc.assert(
      fc.property(arbName, arbPhone, arbPhone, (words, p1, p2) => {
        fc.pre(p1 !== p2);
        const name = words.join(" ");
        expect(matchesCaller({ name, phone: p2 }, { customerName: name, customerPhone: p1 })).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("(d) normalizeName is idempotent", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), arbName.chain((w) => arbVariant(w))), (s) => {
        expect(normalizeName(normalizeName(s))).toBe(normalizeName(s));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { looksLikeName } from "@/lib/conversation/names";

const REAL_NAMES = [
  "Ana",
  "ana",
  "ANA ",
  "María José",
  "María del Carmen Pérez García",
  "José Luis",
  "Jean-Luc",
  "O'Brien",
  "Zoë",
  "Li",
  "Pilar",
  "Dolores",
  "Mar",
  "Concha",
  "John Smith",
  "Marta",
  "Luis",
  "Íñigo",
  "Núria",
  "Ana cariño", // a real name with a word added
];

const NOT_NAMES = [
  "Mi amor", // the owner's real call, 2026-11-13
  "mi amor",
  "Amor",
  "cariño",
  "Cariño",
  "guapa",
  "mi vida",
  "cielo",
  "corazón",
  "Pánfilo", // the playful insult of the same call
  "tonto",
  "idiota",
  "hola",
  "vale",
  "gracias",
  "sí",
  "no",
  "nada",
  "darling",
  "my love",
  "honey",
  "babe",
  "dude",
  "yes",
  "hello",
  "",
  "   ",
  "?",
  "a",
  "R2D2",
  "Ana2",
  "612345678",
  "uno dos tres cuatro cinco seis", // too many words
];

describe("looksLikeName", () => {
  it.each(REAL_NAMES)("accepts %j", (name) => {
    expect(looksLikeName(name)).toBe(true);
  });

  it.each(NOT_NAMES)("refuses %j", (name) => {
    expect(looksLikeName(name)).toBe(false);
  });
});

describe("looksLikeName (property)", () => {
  it("is total, and never accepts a text with a digit, no letters, or more than 5 words", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 80 }), (raw) => {
        const ok = looksLikeName(raw);
        if (/\d/.test(raw)) expect(ok).toBe(false);
        if (!/\p{L}/u.test(raw)) expect(ok).toBe(false);
        if (raw.trim().split(/\s+/).filter(Boolean).length > 5) expect(ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("accepts a word that is not on the list, with any accents or case, and refuses the same endearment in any case", () => {
    const arbCase = (s: string) =>
      fc.array(fc.boolean(), { minLength: s.length, maxLength: s.length }).map((flags) =>
        [...s].map((c, k) => (flags[k] ? c.toUpperCase() : c.toLowerCase())).join(""),
      );
    fc.assert(
      fc.property(arbCase("mi amor"), arbCase("Marta"), arbCase("cariño"), (endearment, name, accented) => {
        expect(looksLikeName(endearment)).toBe(false);
        expect(looksLikeName(accented)).toBe(false);
        expect(looksLikeName(name)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

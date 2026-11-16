import { describe, expect, it } from "vitest";
import {
  editDistance,
  longestSpans,
  findSpans,
  entry,
  pluralForms,
  samePlural,
  tokenize,
  typoAllowance,
  wordMatch,
} from "@/lib/conversation/brain/normalize";
import { normalizeText } from "@/lib/conversation/fields";

/** The Code_Brain's text primitives (front-desk-brain 3.1, 4.1, 4.2). */
describe("tokenize", () => {
  it("writes words as normalizeText does", () => {
    for (const s of ["¿Cuánto cuesta el TINTE de raíz?", "Men’s cut, please!", "mañana sábado", "blow-dry"])
      expect(tokenize(s).map((t) => t.w).join(" ")).toBe(normalizeText(s));
  });

  it("keeps a clock time and a D/M date as one token, but never a phone's digits", () => {
    expect(tokenize("a las 17:30").map((t) => t.w)).toEqual(["a", "las", "17h30"]);
    expect(tokenize("a las 4:00 de la tarde").map((t) => t.w)).toEqual(["a", "las", "4h00", "de", "la", "tarde"]);
    expect(tokenize("17.30").map((t) => t.w)).toEqual(["17h30"]);
    expect(tokenize("el 20/11").map((t) => t.w)).toEqual(["el", "20d11"]);
    expect(tokenize("612.345.678").map((t) => t.w)).toEqual(["612", "345", "678"]);
    expect(tokenize("612 34 56 78").map((t) => t.w)).toEqual(["612", "34", "56", "78"]);
  });

  it("marks where punctuation came, and keeps the surface form", () => {
    const t = tokenize("No, quiero a Ana");
    expect(t.map((x) => x.brk)).toEqual([true, true, false, false]);
    expect(t[3].raw).toBe("Ana");
  });

  it("never throws on odd input", () => {
    for (const s of ["", "   ", "¿¿??", "💇‍♀️", "\u0000", "a".repeat(600)]) expect(() => tokenize(s)).not.toThrow();
  });
});

describe("plural folding (4.1)", () => {
  it("folds a final s, and a final es after a consonant, on words of 4+ letters", () => {
    expect(pluralForms("mechas")).toEqual(["mechas", "mecha"]);
    expect(pluralForms("colores")).toEqual(["colores", "colore", "color"]);
    expect(pluralForms("tres")).toEqual(["tres", "tre"]);
    expect(pluralForms("mes")).toEqual(["mes"]);
    expect(samePlural("fades", "fade")).toBe(true);
    expect(samePlural("mechas", "mecha")).toBe(true);
    expect(samePlural("colores", "color")).toBe(true);
    expect(samePlural("cortes", "corte")).toBe(true);
    expect(samePlural("corte", "corto")).toBe(false);
  });
});

describe("Damerau–Levenshtein with the length rule (4.2)", () => {
  it("counts insertions, deletions, substitutions and adjacent swaps as one each", () => {
    expect(editDistance("mechas", "mehcas")).toBe(1);
    expect(editDistance("mechas", "mecha")).toBe(1);
    expect(editDistance("mechas", "mechass")).toBe(1);
    expect(editDistance("mechas", "mexhas")).toBe(1);
    expect(editDistance("tiene", "tinte")).toBe(2);
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
  });

  it("allows no typo up to 4 letters, one from 5 to 8, two from 9", () => {
    expect([4, 5, 8, 9, 12].map((n) => typoAllowance("a".repeat(n)))).toEqual([0, 1, 1, 2, 2]);
    expect(typoAllowance("12345")).toBe(0);
  });

  it("never takes a typo for a protected word or a short said word", () => {
    const none = () => false;
    expect(wordMatch("mehcas", "mechas", none)).toBe("typo");
    expect(wordMatch("mehcas", "mechas", (w) => w === "mehcas")).toBeNull();
    expect(wordMatch("moco", "mono", none)).toBeNull();
    expect(wordMatch("degradao", "degradado", none)).toBe("typo");
    expect(wordMatch("dgradao", "degradado", none)).toBe("typo");
    expect(wordMatch("dgrado", "degradado", none)).toBeNull();
  });
});

describe("spans", () => {
  it("keeps the longest span, as written over through a plural", () => {
    const entries = [entry("barba", "b")!, entry("arreglo de barba", "ab")!, entry("cortes", "cat")!, entry("corte", "c")!];
    const pick = (s: string) => longestSpans(findSpans(tokenize(s), entries, () => false)).map((x) => x.entry.value);
    expect(pick("un arreglo de barba")).toEqual(["ab"]);
    expect(pick("un corte")).toEqual(["c"]);
    expect(pick("cortes")).toEqual(["cat"]);
  });
});

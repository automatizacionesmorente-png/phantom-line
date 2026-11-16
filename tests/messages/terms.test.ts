import { describe, expect, it } from "vitest";
import { findTerm, normalizeForMatch, wordsOf } from "@/lib/messages/terms";

describe("normalizeForMatch and wordsOf", () => {
  it("drops case, accents, punctuation and extra spaces", () => {
    expect(normalizeForMatch("  ¡HOY, por favor!  ")).toBe("hoy por favor");
    expect(normalizeForMatch("Alérgica")).toBe("alergica");
    expect(normalizeForMatch("a las 5:30")).toBe("a las 5 30");
    expect(wordsOf("Hoy a las 5")).toBe(" hoy a las 5 ");
    expect(wordsOf("")).toBe("  ");
  });
});

describe("findTerm (owner-machine 5.9)", () => {
  it('"HOY," matches "hoy"', () => {
    expect(findTerm(["¿Tenéis algo HOY, a última hora?"], ["hoy"])).toBe("hoy");
  });

  it('"Lo antes   posible" matches "lo antes posible"', () => {
    expect(findTerm(["Lo antes   posible, gracias"], ["lo antes posible"])).toBe("lo antes posible");
  });

  it('"alérgica" matches "alergica", and the other way round', () => {
    expect(findTerm(["Soy alergica al tinte"], ["alérgica"])).toBe("alérgica");
    expect(findTerm(["Soy ALÉRGICA al tinte"], ["alergica"])).toBe("alergica");
  });

  it('"hoyo" does not match "hoy"; other near-misses do not match either', () => {
    expect(findTerm(["Hay un hoyo en la acera"], ["hoy"])).toBeNull();
    expect(findTerm(["Mi alergólogo me dijo que sí"], ["alergia", "alérgica", "alérgico"])).toBeNull();
    expect(findTerm(["I am painting the hallway"], ["pain"])).toBeNull();
  });

  it("a multi-word term needs its words in sequence", () => {
    expect(findTerm(["esta mañana no, la tarde"], ["esta tarde"])).toBeNull();
    expect(findTerm(["me\tpica   mucho"], ["me pica"])).toBe("me pica");
  });

  it("returns the first term in list order, as written in the pack", () => {
    expect(findTerm(["es urgente, tengo dolor"], ["dolor", "urgente"])).toBe("dolor");
    expect(findTerm(["nada"], ["dolor", "urgente"])).toBeNull();
    expect(findTerm([], ["dolor"])).toBeNull();
  });

  it("a term with no letters never matches", () => {
    expect(findTerm(["¡¡¡"], ["¡"])).toBeNull();
  });
});

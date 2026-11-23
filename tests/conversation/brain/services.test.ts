import { describe, expect, it } from "vitest";
import { matchServices, withAddOnBases } from "@/lib/conversation/brain/services";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { lolaSeedProfile } from "@/lib/db/seed";
import { lolaProfile } from "../../fixtures/lola";

/** Service matching (front-desk-brain 4.1–4.7, 4.10; design.md "Service matching", "The Rich_Profile"). */
const rich = lolaSeedProfile;
const ids = (text: string, opts: Parameters<typeof matchServices>[2] = {}, shop: ShopProfile = rich) => {
  const m = matchServices(text, shop, opts);
  return m.request.kind === "set" ? m.next : m.request;
};

describe("matchServices on the Rich_Profile", () => {
  it("reads the Real_Call_2026_11_16 as a men's cut plus a fade (4.4 b)", () => {
    expect(ids("Hola Lola quería cortarme el pelo y hacerme un degradado")).toEqual(["corte-hombre", "degradado"]);
  });

  it("adds the base of an Add_On said alone (4.10)", () => {
    expect(ids("un degradado")).toEqual(["corte-hombre", "degradado"]);
    expect(ids("corte degradado")).toEqual(["corte-hombre", "degradado"]);
    expect(ids("quería un fade")).toEqual(["corte-hombre", "degradado"]);
    expect(withAddOnBases(["degradado"], rich)).toEqual(["corte-hombre", "degradado"]);
    expect(withAddOnBases(["degradado"], rich, ["corte-hombre"])).toEqual(["degradado"]);
  });

  it("lets a candidate matched elsewhere absorb a tie (4.4 a)", () => {
    expect(ids("un corte para mi hija")).toEqual(["corte-infantil"]);
    expect(ids("un corte para mi hijo")).toEqual(["corte-infantil"]);
  });

  it("breaks a tie with Goes_With in the same utterance (4.4 b)", () => {
    expect(ids("un corte y barba")).toEqual(["corte-hombre", "barba"]);
    expect(ids("corte y arreglo de barba")).toEqual(["corte-hombre", "arreglo-barba"]);
  });

  it("breaks a tie with the Call's services from an earlier Turn (4.4 c)", () => {
    expect(ids("un corte", { current: ["barba"] })).toEqual(["corte-hombre"]);
  });

  it("asks which cut when nothing decides it (4.4)", () => {
    expect(ids("un corte")).toEqual({
      kind: "choice",
      candidates: ["corte-mujer", "corte-hombre", "corte-infantil"],
      with: [],
    });
    expect(ids("I'd like a haircut")).toMatchObject({ kind: "choice" });
  });

  it("answers an open Service_Choice with a candidate's own words (4.5)", () => {
    const choice = { candidates: ["corte-mujer", "corte-hombre", "corte-infantil"], with: [] };
    for (const [said, id] of [
      ["de hombre", "corte-hombre"],
      ["el de mujer", "corte-mujer"],
      ["para mi hijo", "corte-infantil"],
      ["men's, please", "corte-hombre"],
    ] as const) {
      const m = matchServices(said, rich, { choice });
      expect(m.choiceAnswered, said).toBe(true);
      expect(m.next, said).toEqual([id]);
    }
    const open = matchServices("¿a qué hora abrís?", rich, { choice });
    expect(open.choiceAnswered).toBe(false);
    expect(open.next).toBeNull();
  });

  it("keeps the services said with the choice", () => {
    const choice = { candidates: ["corte-mujer", "corte-hombre", "corte-infantil"], with: ["hidratante"] };
    expect(matchServices("de mujer", rich, { choice }).next).toEqual(["hidratante", "corte-mujer"]);
  });

  it("takes the longest match (4.3)", () => {
    expect(ids("un arreglo de barba")).toEqual(["arreglo-barba"]);
    expect(ids("un tinte de raíz")).toEqual(["tinte-raiz"]);
    expect(ids("tinte")).toEqual(["tinte-completo"]);
  });

  it("ignores case, accents, punctuation and plurals (4.1)", () => {
    expect(ids("¡TINTE DE RAIZ!")).toEqual(["tinte-raiz"]);
    expect(ids("unas mecha")).toEqual(["mechas"]);
    expect(ids("two fades")).toEqual(["corte-hombre", "degradado"]);
    expect(ids("Decoloracion")).toEqual(["decoloracion"]);
  });

  it("tolerates one typo in a 5–8 letter word and two from 9 letters, never in 4 letters (4.2)", () => {
    expect(ids("unas mehcas")).toEqual(["mechas"]); // swap, 6 letters
    expect(ids("un balayaje")).toEqual(["balayage"]); // substitution, 8 letters
    expect(ids("un degradao")).toEqual(["corte-hombre", "degradado"]); // deletion, 9 letters
    expect(ids("una permanete")).toEqual(["permanente"]); // 10 letters
    expect(ids("una decolracon")).toEqual(["decoloracion"]); // two deletions, 12 letters
    expect(ids("una barva")).toEqual(["barba"]); // 5 letters
    expect(ids("un moco")).toEqual({ kind: "none" }); // "moño" has 4 letters: no typo
    expect(ids("un matix")).toEqual(["matiz"]); // 5 letters: one typo
  });

  it("never fuzzy-matches a word that is itself a lexicon word or another alias word", () => {
    // "tiene" is 2 edits from "tinte"; "cortar" is an alias word, never a typo of "corte".
    expect(ids("¿tiene hueco?")).toEqual({ kind: "none" });
    expect(ids("quería cortar")).toMatchObject({ kind: "choice" });
  });

  it("finds a Category request", () => {
    expect(ids("quería hacerme color")).toEqual({ kind: "category", categoryId: "color", with: [] });
    expect(ids("¿qué tratamientos tenéis?")).toEqual({ kind: "category", categoryId: "tratamientos", with: [] });
  });

  it("drops a service right after a negation (4.6)", () => {
    expect(ids("sin barba")).toEqual({ kind: "none" });
    expect(ids("no quiero barba, solo un corte de hombre")).toEqual(["corte-hombre"]);
    expect(ids("nada de mechas, un tinte")).toEqual(["tinte-completo"]);
    // "a haircut for a man" names the men's cut (alias added 23 Nov); the beard is still dropped.
    expect(ids("a haircut for a man without a beard shave")).toEqual(["corte-hombre"]);
    // "No," as an answer is not a negation of what follows.
    expect(ids("No, quiero un corte de hombre")).toEqual(["corte-hombre"]);
  });

  it("removes a base and its Add_On together (4.10, 7.8)", () => {
    const m = matchServices("sin el corte", rich, { current: ["corte-hombre", "degradado"] });
    expect(m.removed).toEqual(["corte-hombre", "degradado"]);
    expect(m.removedAddOns).toEqual(["degradado"]);
    expect(m.next).toEqual([]);
    const fade = matchServices("mejor sin el degradado", rich, { current: ["corte-hombre", "degradado"] });
    expect(fade.removed).toEqual(["degradado"]);
    expect(fade.removedAddOns).toEqual([]);
    expect(fade.next).toEqual(["corte-hombre"]);
  });

  it("replaces the Call's services unless an addition word comes first (4.7)", () => {
    expect(ids("un tinte", { current: ["corte-mujer"] })).toEqual(["tinte-completo"]);
    expect(ids("y también un tinte", { current: ["corte-mujer"] })).toEqual(["corte-mujer", "tinte-completo"]);
    expect(ids("además barba", { current: ["corte-hombre"] })).toEqual(["corte-hombre", "barba"]);
    expect(ids("also a beard trim", { current: ["corte-hombre"] })).toEqual(["corte-hombre", "arreglo-barba"]);
    const m = matchServices("y también barba", rich, { current: ["corte-hombre"] });
    expect(m.request).toEqual({ kind: "set", ids: ["barba"], mode: "add" });
  });

  it("keeps at most 3 services and says so", () => {
    const m = matchServices("y también un tratamiento hidratante", rich, { current: ["corte-hombre", "degradado", "barba"] });
    expect(m.tooMany).toBe(true);
    expect(m.next).toEqual(["corte-hombre", "degradado", "barba"]);
    const four = matchServices("corte de mujer, tinte de raíz, mechas y matiz", rich);
    expect(four.tooMany).toBe(true);
    expect(four.next).toEqual(["corte-mujer", "tinte-raiz", "mechas"]);
  });

  it("works on the V1_Profile, which has no Categories and no shared aliases", () => {
    expect(ids("quería un corte y barba", {}, lolaProfile)).toEqual(["haircut", "beard"]);
    expect(ids("un tinte", {}, lolaProfile)).toEqual(["colour"]);
  });
});

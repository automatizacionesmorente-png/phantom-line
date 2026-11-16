import { describe, expect, it } from "vitest";
import { BUILT_IN_TOPICS, IdSchema, ShopProfileSchema, type ShopProfileInput } from "@/lib/conversation/shopProfile";
import { lolaProfile } from "../fixtures/lola";

/**
 * front-desk-brain 4.1 (Requirements 11.1–11.3, 17.2): the Shop_Profile schema's new fields
 * and their refusals. `full` uses every new field; each refusal changes exactly one thing in it.
 */

const full: ShopProfileInput = {
  ...lolaProfile,
  services: [
    {
      id: "corte-hombre",
      name: { es: "Corte de hombre", en: "Men's cut" },
      aliases: ["corte de caballero", "men's cut"],
      durationMin: 30,
      priceCents: 1400,
      spokenName: { es: "un corte de hombre", en: "a men's cut" },
      category: "cortes",
      goesWith: ["degradado"],
    },
    {
      id: "degradado",
      name: { es: "Degradado", en: "Fade" },
      aliases: ["fade", "corte degradado"],
      durationMin: 20,
      priceCents: 400,
      spokenName: { es: "un degradado", en: "a fade" },
      category: "barberia",
      goesWith: ["corte-hombre"],
      addOnTo: ["corte-hombre"],
    },
    {
      id: "mechas",
      name: { es: "Mechas", en: "Highlights" },
      durationMin: 150,
      priceCents: 5500,
      priceFrom: true,
      category: "color",
    },
  ],
  categories: [
    { id: "cortes", name: { es: "cortes", en: "haircuts" }, aliases: ["cortes"] },
    { id: "barberia", name: { es: "barbería", en: "barbering" } },
    { id: "color", name: { es: "color", en: "colour" }, aliases: ["tintes"] },
  ],
  faq: [
    {
      id: "pago",
      aliases: { es: ["pagar con tarjeta", "bizum"], en: ["pay by card", "bizum"] },
      answer: { es: "Puedes pagar con tarjeta, con Bizum o en efectivo.", en: "You can pay by card, Bizum or cash." },
    },
    {
      id: "parking",
      aliases: { es: ["aparcar", "parking"], en: ["parking"] },
      answer: {
        es: "No tenemos aparcamiento propio, pero hay un parking público en la plaza Mayor, muy cerca.",
        en: "We have no parking of our own, but there is a public car park in Plaza Mayor, very close.",
      },
    },
  ],
  voice: { endOfSpeechMs: 600 },
};

const ok = (p: unknown) => ShopProfileSchema.safeParse(p).success;
const messages = (p: unknown) => {
  const r = ShopProfileSchema.safeParse(p);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

type Faq = NonNullable<ShopProfileInput["faq"]>[number];
type Service = ShopProfileInput["services"][number];
const withFaq = (f: Partial<Faq>, index = 0) => ({
  ...full,
  faq: full.faq!.map((e, k) => (k === index ? { ...e, ...f } : e)),
});
const withAnswer = (es: string) => withFaq({ answer: { es, en: full.faq![0].answer.en } });
const withService = (index: number, s: Partial<Service>) => ({
  ...full,
  services: full.services.map((e, k) => (k === index ? { ...e, ...s } : e)),
});

describe("ShopProfileSchema: what parses", () => {
  it("the V1_Profile (tests/fixtures/lola.ts) still parses, unchanged", () => {
    const r = ShopProfileSchema.safeParse(lolaProfile);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(lolaProfile);
  });

  it("a profile with every new field parses and keeps them", () => {
    const r = ShopProfileSchema.safeParse(full);
    expect(r.error?.issues ?? []).toEqual([]);
    expect(r.data?.categories).toHaveLength(3);
    expect(r.data?.faq?.map((f) => f.id)).toEqual(["pago", "parking"]);
    expect(r.data?.services[1].addOnTo).toEqual(["corte-hombre"]);
    expect(r.data?.services[2].priceFrom).toBe(true);
    expect(r.data?.voice?.endOfSpeechMs).toBe(600);
  });

  it("the same alias in one entry's Spanish and English lists is fine ('parking', 'bizum')", () => {
    expect(ok(full)).toBe(true);
  });

  it("endOfSpeechMs 300 and 1500 are the bounds, and a voice override still sits beside it", () => {
    expect(ok({ ...full, voice: { endOfSpeechMs: 300 } })).toBe(true);
    expect(ok({ ...full, voice: { endOfSpeechMs: 1500, es: { style: "Tranquila." } } })).toBe(true);
  });

  it("the id pattern accepts every id stored today", () => {
    for (const id of ["haircut", "colour", "beard", "chair-1", "corte-hombre", "tinte-raiz", "a1"]) {
      expect(IdSchema.safeParse(id).success, id).toBe(true);
    }
    for (const s of lolaProfile.services) expect(IdSchema.safeParse(s.id).success, s.id).toBe(true);
  });
});

describe("ShopProfileSchema: each refusal", () => {
  it("an FAQ answer with a digit", () => {
    expect(ok(withAnswer("Puedes pagar con tarjeta, con Bizum o en efectivo desde 5 euros."))).toBe(false);
  });

  it("an FAQ answer of 3 sentences", () => {
    expect(ok(withAnswer("Con tarjeta. Con Bizum. En efectivo."))).toBe(false);
    expect(ok(withAnswer("Con tarjeta. Con Bizum o en efectivo."))).toBe(true);
  });

  it("an FAQ answer sentence of 26 words (25 passes)", () => {
    const words = (n: number) => `${Array.from({ length: n }, () => "palabra").join(" ")}.`;
    expect(ok(withAnswer(words(25)))).toBe(true);
    expect(ok(withAnswer(words(26)))).toBe(false);
  });

  it("an FAQ answer with markup", () => {
    expect(ok(withAnswer("Puedes pagar con **tarjeta**."))).toBe(false);
    expect(ok(withAnswer("Puedes pagar con [tarjeta]."))).toBe(false);
  });

  it("an FAQ answer with an emoji", () => {
    expect(ok(withAnswer("Puedes pagar con tarjeta 💳."))).toBe(false);
  });

  it("an empty FAQ answer", () => {
    expect(ok(withAnswer("   "))).toBe(false);
  });

  it("an FAQ id that is a built-in Profile_Topic", () => {
    expect([...BUILT_IN_TOPICS].sort()).toEqual(["address", "duration", "hours", "price", "services"]);
    for (const id of BUILT_IN_TOPICS) expect(ok(withFaq({ id })), id).toBe(false);
  });

  it("two FAQ_Entries with the same id", () => {
    expect(ok(withFaq({ id: "pago" }, 1))).toBe(false);
  });

  it("an FAQ alias repeated in another entry, also after normalization", () => {
    const parking = full.faq![1];
    expect(ok(withFaq({ aliases: { es: [...parking.aliases.es, "bizum"], en: parking.aliases.en } }, 1))).toBe(false);
    expect(ok(withFaq({ aliases: { es: [...parking.aliases.es, "BIZUM "], en: parking.aliases.en } }, 1))).toBe(false);
    expect(messages(withFaq({ aliases: { es: ["bizum"], en: parking.aliases.en } }, 1))).toContain(
      'FAQ alias "bizum" is already an alias of "pago"',
    );
  });

  it("an FAQ alias equal to a service alias, a service name or a Category alias", () => {
    const es = (alias: string) => withFaq({ aliases: { es: ["pagar con tarjeta", alias], en: ["pay by card"] } });
    expect(ok(es("corte de caballero"))).toBe(false); // a service alias
    expect(ok(es("Corte Degradado"))).toBe(false); // a service alias, after normalization
    expect(ok(es("degradado"))).toBe(false); // a service name
    expect(ok(es("corte de hombre"))).toBe(false); // a capitalised service name, only equal after normalization
    expect(ok(es("Men’s Cut"))).toBe(false); // the alias "men's cut" with a curly apostrophe, only equal after normalization
    expect(ok(es("tintes"))).toBe(false); // a Category alias
    expect(ok(es("barbería"))).toBe(false); // a Category name
    expect(ok(es("formas de pago"))).toBe(true);
  });

  it("an FAQ with no aliases in a language, or an alias with no letter", () => {
    expect(ok(withFaq({ aliases: { es: [], en: ["pay by card"] } }))).toBe(false);
    expect(ok(withFaq({ aliases: { es: ["¿?"], en: ["pay by card"] } }))).toBe(false);
  });

  it("an unknown category", () => {
    expect(ok(withService(2, { category: "tratamientos" }))).toBe(false);
    expect(messages(withService(2, { category: "tratamientos" }))).toContain('unknown category "tratamientos"');
  });

  it("an unknown goesWith", () => {
    expect(ok(withService(0, { goesWith: ["barba"] }))).toBe(false);
  });

  it("an unknown addOnTo", () => {
    expect(ok(withService(1, { addOnTo: ["corte-mujer"] }))).toBe(false);
  });

  it("an addOnTo pointing at an Add_On", () => {
    // `mechas` an Add_On of `degradado`, which is itself an Add_On of `corte-hombre`.
    expect(ok(withService(2, { addOnTo: ["degradado"] }))).toBe(false);
    expect(messages(withService(2, { addOnTo: ["degradado"] }))).toContain('"degradado" is itself an Add_On');
  });

  it("a service that is its own Add_On", () => {
    expect(ok(withService(2, { addOnTo: ["mechas"] }))).toBe(false);
    expect(messages(withService(2, { addOnTo: ["mechas"] }))).toContain("a service cannot be an Add_On of itself");
  });

  it("an empty addOnTo list", () => {
    expect(ok(withService(1, { addOnTo: [] }))).toBe(false);
  });

  it("a service id with '+', a capital, a leading digit or a space", () => {
    for (const id of ["corte+barba", "Corte", "1corte", "corte hombre", "corte_hombre", ""]) {
      expect(ok(withService(2, { id })), id).toBe(false);
    }
  });

  it("a Category or FAQ id outside the pattern, and two Categories with one id", () => {
    expect(ok({ ...full, categories: [...full.categories!, { id: "Color", name: { es: "x", en: "x" } }] })).toBe(false);
    expect(ok(withFaq({ id: "pago+parking" }))).toBe(false);
    expect(ok({ ...full, categories: [...full.categories!, { id: "color", name: { es: "y", en: "y" } }] })).toBe(false);
  });

  it("endOfSpeechMs 299, 1501 and a fraction", () => {
    expect(ok({ ...full, voice: { endOfSpeechMs: 299 } })).toBe(false);
    expect(ok({ ...full, voice: { endOfSpeechMs: 1501 } })).toBe(false);
    expect(ok({ ...full, voice: { endOfSpeechMs: 600.5 } })).toBe(false);
  });

  it("a non-boolean priceFrom", () => {
    expect(ok(withService(2, { priceFrom: "yes" as unknown as boolean }))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { matchTopic } from "@/lib/conversation/brain/topics";
import { SpokenAnswerSchema } from "@/lib/conversation/shopProfile";
import { UNIVERSAL_FAQ } from "@/lib/conversation/brain/universalFaq";
import { lolaSeedProfile } from "@/lib/db/seed";
import { getSectorPack, type Lang } from "@/lib/sectors";

/** Universal_FAQ: everyday questions answered by code, with no model call and no API token. */
const shop = lolaSeedProfile;
const pack = getSectorPack(shop.sectorPackId);
const read = (text: string, lang: Lang) => matchTopic(text, shop, { lang, pack }).topic;

describe("Universal_FAQ data", () => {
  it("has unique ids that never clash with a built-in topic or a shop FAQ id", () => {
    const ids = UNIVERSAL_FAQ.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith("u-")).toBe(true);
      expect((shop.faq ?? []).some((f) => f.id === id)).toBe(false);
    }
  });

  for (const f of UNIVERSAL_FAQ)
    for (const lang of ["es", "en"] as const)
      it(`${f.id} (${lang}): a valid Spoken_Form answer that states no shop fact`, () => {
        const r = SpokenAnswerSchema.safeParse(f.answer[lang]);
        expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
        expect(f.answer[lang]).not.toMatch(/€|euro|dollar|\bopen\b|abierto|calle|street|parking|aparcamiento/i);
        expect(f.aliases[lang].length).toBeGreaterThanOrEqual(4);
      });
});

describe("matchTopic: Universal_FAQ", () => {
  for (const f of UNIVERSAL_FAQ)
    for (const lang of ["es", "en"] as const)
      for (const a of f.aliases[lang]) {
        // A shop alias with the same words wins; skip those.
        const shopOwns = (shop.faq ?? []).some((s) => s.aliases[lang].some((x) => x.toLowerCase() === a.toLowerCase()));
        if (shopOwns) continue;
        it(`${f.id} (${lang}): ${a}`, () => {
          const frame = lang === "es" ? `Oye, ${a}?` : `Hey, ${a}?`;
          const topic = read(frame, lang);
          expect(topic, frame).toEqual({ kind: "faq", id: f.id });
        });
      }

  it("answers the headline questions with the right entry", () => {
    expect(read("¿eres un robot?", "es")).toEqual({ kind: "faq", id: "u-robot" });
    expect(read("are you a real person?", "en")).toEqual({ kind: "faq", id: "u-robot" });
    expect(read("cuéntame un chiste", "es")).toEqual({ kind: "faq", id: "u-joke" });
    expect(read("tell me a joke", "en")).toEqual({ kind: "faq", id: "u-joke" });
    expect(read("¿cuál es la capital de Francia?", "es")).toEqual({ kind: "faq", id: "u-offtopic" });
    expect(read("what's the capital of France?", "en")).toEqual({ kind: "faq", id: "u-offtopic" });
  });

  it("lets a shop's own FAQ_Entry win over the Universal_FAQ", () => {
    const own = { ...shop, faq: [...(shop.faq ?? []), { id: "bromas", aliases: { es: ["cuentame un chiste"], en: ["tell me a joke"] }, answer: { es: "Aquí no hacemos chistes.", en: "No jokes here." } }] };
    expect(matchTopic("cuéntame un chiste", own, { lang: "es", pack }).topic).toEqual({ kind: "faq", id: "bromas" });
  });

  it("does not hijack a booking request", () => {
    expect(read("quiero pedir cita para un corte mañana", "es")?.kind ?? null).not.toBe("faq");
  });
});

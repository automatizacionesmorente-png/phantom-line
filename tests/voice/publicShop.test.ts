import { describe, expect, it } from "vitest";
import { defaultLang, toPublicShop } from "@/lib/voice/publicShop";
import { lolaProfile } from "../fixtures/lola";

describe("toPublicShop", () => {
  const pub = toPublicShop(lolaProfile);

  it("keeps only what the Call_Page needs", () => {
    expect(Object.keys(pub).sort()).toEqual(["id", "languages", "name", "notices", "speechPhrases"]);
    expect(pub).toMatchObject({ id: "peluqueria-lola", name: "Peluquería Lola", languages: ["es", "en"] });
    const text = JSON.stringify(pub);
    expect(text).not.toContain(lolaProfile.address);
    expect(text).not.toContain("priceCents");
  });

  it("carries the page's notices in both languages from the shop's phrases", () => {
    expect(pub.notices.es.typeInstead).toBe("No te oigo bien, pero puedes escribirme aquí abajo.");
    expect(pub.notices.es.lineCut).toBe("Se ha cortado la línea. Lola tiene tu mensaje y te llamará.");
    expect(pub.notices.en.lineCut).toContain("Lola");
  });

  it("lists the service names for speech biasing, without duplicates", () => {
    expect(pub.speechPhrases.length).toBeGreaterThan(0);
    expect(new Set(pub.speechPhrases).size).toBe(pub.speechPhrases.length);
    for (const s of lolaProfile.services) expect(pub.speechPhrases).toContain(s.name.es);
  });
});

describe("defaultLang", () => {
  it("follows the browser language when the shop speaks it", () => {
    expect(defaultLang("en-US", ["es", "en"])).toBe("en");
    expect(defaultLang("es-ES", ["es", "en"])).toBe("es");
    expect(defaultLang("EN_gb", ["es", "en"])).toBe("en");
  });
  it("falls back to the shop's first language otherwise", () => {
    expect(defaultLang("fr-FR", ["es", "en"])).toBe("es");
    expect(defaultLang(undefined, ["en"])).toBe("en");
    expect(defaultLang("es", ["en"])).toBe("en");
  });
});

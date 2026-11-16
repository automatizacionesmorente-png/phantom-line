import { describe, expect, it } from "vitest";
import {
  CATALOG_LIST_MAX_WORDS,
  catalogItems,
  catalogLine,
  nameByParts,
  serviceView,
} from "@/lib/conversation/catalog";
import { ShopProfileSchema, type ShopProfile } from "@/lib/conversation/shopProfile";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

/** front-desk-brain 4.2 (Requirements 7.5, 7.6, 11.6): names, totals and the catalog line. */

const pack = getSectorPack("hair-salon");

/** Six services in four Categories, one priced "from" and one without a spoken name. */
const salon: ShopProfile = ShopProfileSchema.parse({
  ...lolaProfile,
  services: [
    { id: "corte-mujer", name: { es: "Corte de mujer", en: "Women's cut" }, durationMin: 45, priceCents: 2500, spokenName: { es: "un corte de mujer", en: "a women's cut" }, category: "cortes" },
    { id: "corte-hombre", name: { es: "Corte de hombre", en: "Men's cut" }, durationMin: 30, priceCents: 1400, spokenName: { es: "un corte de hombre", en: "a men's cut" }, category: "cortes", goesWith: ["degradado", "barba"] },
    { id: "degradado", name: { es: "Degradado", en: "Fade" }, durationMin: 20, priceCents: 400, spokenName: { es: "un degradado", en: "a fade" }, category: "barberia", addOnTo: ["corte-hombre"] },
    { id: "barba", name: { es: "Barba", en: "Beard shave" }, durationMin: 25, priceCents: 1000, spokenName: { es: "un afeitado de barba", en: "a beard shave" }, category: "barberia" },
    { id: "mechas", name: { es: "Mechas", en: "Highlights" }, durationMin: 150, priceCents: 5500, spokenName: { es: "unas mechas", en: "highlights" }, category: "color", priceFrom: true },
    { id: "hidratante", name: { es: "Tratamiento hidratante", en: "Hydrating treatment" }, durationMin: 30, priceCents: 1500, category: "tratamientos" },
  ],
  categories: [
    { id: "cortes", name: { es: "cortes", en: "haircuts" } },
    { id: "barberia", name: { es: "barbería", en: "barbering" } },
    { id: "color", name: { es: "color", en: "colour" } },
    { id: "tratamientos", name: { es: "tratamientos", en: "treatments" } },
  ],
});

describe("serviceView", () => {
  it("one service: its own duration, price, name and spoken name", () => {
    const v = serviceView("corte-hombre", salon, pack);
    expect(v).toMatchObject({
      known: true,
      id: "corte-hombre",
      durationMin: 30,
      priceCents: 1400,
      priceFrom: false,
      name: { es: "Corte de hombre", en: "Men's cut" },
      spoken: { es: "un corte de hombre", en: "a men's cut" },
    });
    expect(v.known && v.parts.map((p) => p.id)).toEqual(["corte-hombre"]);
  });

  it("a Combo_Id of 2 parts: summed duration and price, names joined with ' + ', spoken with 'y' / 'and'", () => {
    const v = serviceView("corte-hombre+degradado", salon, pack);
    expect(v).toMatchObject({
      known: true,
      durationMin: 50,
      priceCents: 1800,
      priceFrom: false,
      name: { es: "Corte de hombre + Degradado", en: "Men's cut + Fade" },
      spoken: { es: "un corte de hombre y un degradado", en: "a men's cut and a fade" },
    });
    expect(v.known && v.parts.map((p) => p.id)).toEqual(["corte-hombre", "degradado"]);
  });

  it("a Combo_Id of 3 parts", () => {
    const v = serviceView("corte-hombre+degradado+barba", salon, pack);
    expect(v).toMatchObject({
      known: true,
      durationMin: 75,
      priceCents: 2800,
      name: { es: "Corte de hombre + Degradado + Barba", en: "Men's cut + Fade + Beard shave" },
      spoken: {
        es: "un corte de hombre, un degradado y un afeitado de barba",
        en: "a men's cut, a fade and a beard shave",
      },
    });
  });

  it("priceFrom on one part makes the whole view a starting price", () => {
    expect(serviceView("mechas", salon, pack)).toMatchObject({ priceFrom: true, priceCents: 5500 });
    expect(serviceView("corte-mujer+mechas", salon, pack)).toMatchObject({ priceFrom: true, priceCents: 8000, durationMin: 195 });
  });

  it("a part without a spoken name uses the pack's booking word, as the phrase book always did", () => {
    expect(serviceView("hidratante", salon, pack).spoken).toEqual({
      es: "una cita de Tratamiento hidratante",
      en: "a Hydrating treatment appointment",
    });
    // Without a pack there is no booking word: the plain name.
    expect(serviceView("hidratante", salon).spoken).toEqual({ es: "Tratamiento hidratante", en: "Hydrating treatment" });
  });

  it("an unknown id, or a Combo_Id the Booking_Rules refuse, gives its own id back so no screen is empty", () => {
    for (const id of ["manicura", "degradado+corte-hombre", "barba+barba", "corte-hombre+", "", "corte-mujer+corte-hombre+degradado+barba"]) {
      expect(serviceView(id, salon, pack), id).toEqual({ known: false, id, name: { es: id, en: id }, spoken: { es: id, en: id } });
    }
  });

  it("the V1_Profile's services read exactly as the phrase book read them", () => {
    expect(serviceView("haircut", lolaProfile, pack)).toMatchObject({ name: { es: "corte" }, spoken: { es: "un corte", en: "a haircut" } });
  });
});

describe("nameByParts (the Owner's names, from names only)", () => {
  it("a catalog id, a Combo_Id, and null for an unknown part", () => {
    expect(nameByParts("barba", salon.services, "es")).toBe("Barba");
    expect(nameByParts("corte-hombre+degradado", salon.services, "en")).toBe("Men's cut + Fade");
    expect(nameByParts("corte-hombre+perm", salon.services, "es")).toBeNull();
    expect(nameByParts("perm", salon.services, "es")).toBeNull();
  });
});

describe("catalogItems and catalogLine", () => {
  it("over 5 services with Categories, the catalog names the Categories in one sentence", () => {
    expect(catalogLine(salon, "es")).toBe("Hacemos cortes, barbería, color y tratamientos.");
    expect(catalogLine(salon, "en")).toBe("We do haircuts, barbering, colour and treatments.");
  });

  it("5 services or fewer, or no Categories: the services by name (the V1_Profile is unchanged)", () => {
    expect(catalogItems(lolaProfile, "es")).toBe("corte, tinte y barba");
    expect(catalogItems(lolaProfile, "en")).toBe("haircut, colour and beard");
    const noCategories = { ...salon, categories: undefined };
    expect(catalogItems(noCategories, "es")).toBe(
      "Corte de mujer, Corte de hombre, Degradado, Barba, Mechas y Tratamiento hidratante",
    );
    const five = { ...salon, services: salon.services.slice(0, 5) };
    expect(catalogItems(five, "es")).toBe("Corte de mujer, Corte de hombre, Degradado, Barba y Mechas");
  });

  it("a list that would pass the word budget keeps its first items and ends with 'y más cosas' / 'and more'", () => {
    const long = (n: number) => ({ id: `s${n}`, name: { es: `servicio largo número ${n}`, en: `long service number ${n}` }, durationMin: 30, priceCents: 1000 });
    const shop = { ...salon, categories: undefined, services: Array.from({ length: 9 }, (_, n) => long(n)) };
    for (const lang of ["es", "en"] as const) {
      const items = catalogItems(shop, lang);
      expect(items.split(/\s+/).length).toBeLessThanOrEqual(CATALOG_LIST_MAX_WORDS);
      expect(items.endsWith(lang === "es" ? "y más cosas" : "and more")).toBe(true);
      expect(items.startsWith(lang === "es" ? "servicio largo número 0" : "long service number 0")).toBe(true);
      expect(catalogLine(shop, lang).split(/\s+/).length).toBeLessThanOrEqual(25);
    }
  });

  it("every catalog line is one sentence of at most 25 words, with 12 Categories of long names too", () => {
    const categories = Array.from({ length: 12 }, (_, n) => ({ id: `c${n}`, name: { es: `categoría con nombre ${n}`, en: `category with name ${n}` } }));
    const shop = { ...salon, categories };
    for (const lang of ["es", "en"] as const) {
      const line = catalogLine(shop, lang);
      expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(25);
      expect(line.match(/[.!?]/g)).toHaveLength(1);
    }
  });
});

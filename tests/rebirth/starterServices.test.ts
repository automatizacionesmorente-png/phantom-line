import { describe, expect, it } from "vitest";
import { buildProfile } from "@/lib/rebirth/draft";
import { availableSectors } from "@/lib/rebirth/sectors";
import { ShopProfileSchema } from "@/lib/conversation/shopProfile";
import { getSectorPack } from "@/lib/sectors";
import { brainCall, SAT_1930 } from "../conversation/brainCall";
import type { ShopProfile } from "@/lib/conversation/shopProfile";

// The wizard offers every listed sector, and a shop built from its starters understands callers
// as well as the demo does: kept starter services keep their aliases. (Written by Claude.)
const draftFor = (sectorId: string) => {
  const sector = availableSectors().find((s) => s.id === sectorId)!;
  return {
    sectorId,
    business: { name: "Prueba Uno", address: "Calle Mayor 1", city: "Madrid", timeZone: "Europe/Madrid", languages: ["es", "en"], ownerName: "Ana" },
    team: { members: ["Puesto 1", "Puesto 2"], concurrent: 2 },
    hours: { 2: [{ open: "09:00", close: "20:00" }], 3: [{ open: "09:00", close: "20:00" }], 4: [{ open: "09:00", close: "20:00" }], 5: [{ open: "09:00", close: "20:00" }], 6: [{ open: "10:00", close: "14:00" }] },
    services: sector.starterCatalogue.map((s) => ({ name: s.name.es, nameEn: s.name.en, durationMin: s.durationMin, priceEur: s.priceEur, from: s.from })),
    faq: [],
  };
};

describe("the wizard and the sector packs", () => {
  it("offers all five appointment sectors, each with a starter catalogue", () => {
    const ids = availableSectors().map((s) => s.id);
    expect(ids).toEqual(["hair-salon", "barber-shop", "beauty-centre", "physio-clinic", "dental-clinic"]);
    for (const s of availableSectors()) expect(s.starterCatalogue.length).toBeGreaterThan(3);
  });

  it.each(["hair-salon", "barber-shop", "beauty-centre", "physio-clinic", "dental-clinic"])(
    "%s: the built profile is valid and keeps the starter aliases",
    (id) => {
      const profile = buildProfile(draftFor(id) as never, "prueba-uno");
      const parsed = ShopProfileSchema.safeParse(profile);
      expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
      const starters = getSectorPack(id).starterCatalogue!.services;
      const withAliases = starters.filter((s) => s.aliases?.length);
      for (const s of withAliases) expect(profile.services.find((x) => x.id === s.id)?.aliases).toEqual(s.aliases);
    },
  );

  it("a hair salon made in the wizard understands \"a men's haircut\" on the first turn", () => {
    const shop = ShopProfileSchema.parse(buildProfile(draftFor("hair-salon") as never, "prueba-uno")) as ShopProfile;
    const [t] = brainCall(["Hi, I'd like a men's haircut on Friday afternoon"], { shop, now: SAT_1930, lang: "en" });
    expect(t.reading.services).toMatchObject({ kind: "set" });
  });
});

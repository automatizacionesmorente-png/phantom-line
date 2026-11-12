import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ShopProfileSchema } from "@/lib/conversation/shopProfile";
import { shops } from "@/lib/db/schema";
import { lolaSeedProfile, seedShop } from "@/lib/db/seed";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { insertShop } from "./helpers";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const allShops = () => t.handle.db.select().from(shops);

describe("seedShop (Peluquería Lola)", () => {
  it("stores a profile that passes ShopProfileSchema and matches Requirement 7", async () => {
    const result = await seedShop(t.handle.db);
    expect(result).toEqual({ shopId: "peluqueria-lola", created: true });

    const rows = await allShops();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "peluqueria-lola", name: "Peluquería Lola", sectorPackId: "hair-salon", timeZone: "Europe/Madrid" });

    // The raw jsonb passes the schema, and the repository read (which validates too) returns it.
    const profile = ShopProfileSchema.parse(rows[0].profile);
    expect(await t.repo.getShop("peluqueria-lola")).toEqual(profile);

    expect(profile.name).toBe("Peluquería Lola"); // 7.1
    const day = [
      { open: "10:00", close: "14:00" },
      { open: "17:00", close: "20:00" },
    ];
    expect(profile.hours).toEqual({ 2: day, 3: day, 4: day, 5: day, 6: day }); // 7.2: Tue–Sat
    expect(profile.services.map((s) => [s.id, s.durationMin, s.priceCents])).toEqual([
      ["haircut", 30, 1500],
      ["colour", 90, 4500],
      ["beard", 20, 1000],
    ]); // 7.3
    expect(profile).toMatchObject({ ownerName: "Lola", address: "Calle Mayor 12, Madrid", timeZone: "Europe/Madrid" }); // 7.4
    expect(profile.sectorPackId).toBe("hair-salon"); // 7.5
    expect(profile.resources.map((r) => r.id)).toEqual(["chair-1", "chair-2"]); // 7.7
  });

  it("leaves exactly one shop when run twice", async () => {
    expect(await seedShop(t.handle.db)).toEqual({ shopId: "peluqueria-lola", created: true });
    expect(await seedShop(t.handle.db)).toEqual({ shopId: "peluqueria-lola", created: false });
    const rows = await allShops();
    expect(rows).toHaveLength(1);
    expect(ShopProfileSchema.parse(rows[0].profile)).toEqual(lolaSeedProfile);
  });

  it("updates an existing shop with the same name under its own id instead of duplicating it", async () => {
    await insertShop(t, { ...lolaSeedProfile, id: "lola-old", ownerName: "Someone else" });
    expect(await seedShop(t.handle.db)).toEqual({ shopId: "lola-old", created: false });
    const rows = await allShops();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("lola-old");
    expect(rows[0].profile).toEqual({ ...lolaSeedProfile, id: "lola-old" });
  });

  it("rejects an invalid profile or an unknown sector pack without writing anything", async () => {
    await expect(seedShop(t.handle.db, { ...lolaSeedProfile, services: [] })).rejects.toThrow();
    await expect(seedShop(t.handle.db, { ...lolaSeedProfile, sectorPackId: "no-such-pack" })).rejects.toThrow();
    expect(await allShops()).toHaveLength(0);
  });

  it("is the same profile as the Lola test fixture, so tests and demo never drift apart", () => {
    expect(lolaSeedProfile).toEqual(lolaProfile);
  });
});

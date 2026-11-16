import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { ShopProfileSchema, type ShopProfile } from "@/lib/conversation/shopProfile";
import { shops } from "@/lib/db/schema";
import { lolaSeedProfile, seedOwnerPin, seedShop } from "@/lib/db/seed";
import { DEMO_SHOP_ID } from "@/lib/owner/demo";
import { verifyPin } from "@/lib/owner/pin";
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
    // core-call-loop 7.3 named three services; front-desk-brain 11.4 replaced them with the
    // Rich_Profile's catalog (design.md, "The Rich_Profile", services table): id, minutes, cents.
    expect(profile.services.map((s) => [s.id, s.durationMin, s.priceCents])).toEqual([
      ["corte-mujer", 45, 2500],
      ["corte-hombre", 30, 1400],
      ["degradado", 20, 400],
      ["corte-infantil", 25, 1000],
      ["barba", 25, 1000],
      ["arreglo-barba", 15, 600],
      ["lavar-peinar", 30, 1500],
      ["peinado-evento", 60, 3500],
      ["peinado-novia", 120, 12000],
      ["recogido", 45, 3000],
      ["tinte-raiz", 75, 2800],
      ["tinte-completo", 105, 3800],
      ["mechas", 150, 5500],
      ["balayage", 180, 8500],
      ["matiz", 30, 1500],
      ["decoloracion", 150, 6000],
      ["keratina", 150, 9500],
      ["hidratante", 30, 1500],
      ["permanente", 120, 5000],
    ]); // 11.4
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

  it("keeps everything of the V1_Profile but its catalog, so the demo rules and the voice still hold (11.7)", () => {
    // Was: `expect(lolaSeedProfile).toEqual(lolaProfile)`. The Rich_Profile changes only the
    // catalog (services, Categories, FAQ_Entries); every other field must still be the fixture's.
    const notCatalog = (p: ShopProfile) =>
      Object.fromEntries(Object.entries(p).filter(([k]) => !["services", "categories", "faq"].includes(k)));
    expect(Object.keys(notCatalog(lolaProfile)).sort()).toEqual(
      ["address", "hours", "id", "languages", "name", "ownerName", "resources", "sectorPackId", "speechRate", "timeZone"],
    );
    expect(notCatalog(lolaSeedProfile)).toEqual(notCatalog(lolaProfile));
    expect(lolaProfile.categories).toBeUndefined();
    expect(lolaProfile.faq).toBeUndefined();
  });

  it("takes its id from DEMO_SHOP_ID", () => {
    expect(lolaSeedProfile.id).toBe(DEMO_SHOP_ID);
  });
});

describe("seedOwnerPin (owner-machine 2.6)", () => {
  const pinRow = async () => {
    const [row] = await t.handle.db
      .select({ hash: shops.ownerPinHash, at: shops.ownerPinSetAt })
      .from(shops)
      .where(eq(shops.id, DEMO_SHOP_ID));
    return row;
  };
  const AT = Temporal.Instant.from("2026-11-15T10:00:00Z");

  it.each([
    ["missing", undefined],
    ["missing", ""],
    ["malformed", "12345"],
    ["malformed", "1234567"],
    ["malformed", "12a456"],
    ["malformed", " 123456"],
  ] as const)("a %s DEMO_OWNER_PIN (%j) leaves the Shop without a PIN and prints that it did", async (result, pin) => {
    await seedShop(t.handle.db);
    const printed: string[] = [];
    expect(await seedOwnerPin(t.handle.db, DEMO_SHOP_ID, pin, (l) => printed.push(l), AT)).toBe(result);
    expect(await pinRow()).toEqual({ hash: null, at: null });
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatch(/PIN was not set/);
    if (pin) expect(printed[0]).not.toContain(pin.trim());
  });

  it("hashes a valid PIN, and re-seeding with the same PIN keeps the hash and owner_pin_set_at", async () => {
    await seedShop(t.handle.db);
    const printed: string[] = [];
    expect(await seedOwnerPin(t.handle.db, DEMO_SHOP_ID, "482913", (l) => printed.push(l), AT)).toBe("set");
    const first = await pinRow();
    expect(first.hash).toMatch(/^scrypt\$/);
    expect(first.hash).not.toContain("482913");
    expect(first.at?.toISOString()).toBe("2026-11-15T10:00:00.000Z");
    expect(await verifyPin("482913", first.hash!)).toBe(true);

    await seedShop(t.handle.db); // the shop row is updated, the PIN columns are not touched
    const later = Temporal.Instant.from("2026-11-20T10:00:00Z");
    expect(await seedOwnerPin(t.handle.db, DEMO_SHOP_ID, "482913", (l) => printed.push(l), later)).toBe("kept");
    expect(await pinRow()).toEqual(first);
    expect(printed.join("\n")).not.toContain("482913");
  });

  it("a changed PIN is re-hashed with a new owner_pin_set_at, which revokes old sessions (1.8)", async () => {
    await seedShop(t.handle.db);
    await seedOwnerPin(t.handle.db, DEMO_SHOP_ID, "482913", () => {}, AT);
    const later = Temporal.Instant.from("2026-11-20T10:00:00Z");
    expect(await seedOwnerPin(t.handle.db, DEMO_SHOP_ID, "111222", () => {}, later)).toBe("set");
    const row = await pinRow();
    expect(row.at?.toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(await verifyPin("111222", row.hash!)).toBe(true);
    expect(await verifyPin("482913", row.hash!)).toBe(false);
  });

  it("a missing PIN on a re-seed leaves a PIN set earlier as it was", async () => {
    await seedShop(t.handle.db);
    await seedOwnerPin(t.handle.db, DEMO_SHOP_ID, "482913", () => {}, AT);
    const before = await pinRow();
    expect(await seedOwnerPin(t.handle.db, DEMO_SHOP_ID, undefined, () => {}, AT)).toBe("missing");
    expect(await pinRow()).toEqual(before);
  });
});

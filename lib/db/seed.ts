import { eq } from "drizzle-orm";
import { ShopProfileSchema, type ShopProfile, type ShopProfileInput } from "@/lib/conversation/shopProfile";
import { getSectorPack } from "@/lib/sectors";
import type { Db } from "./repository";
import { shops } from "./schema";

/**
 * The demo shop of Requirement 7: Peluquería Lola, Tue–Sat 10:00–14:00 and
 * 17:00–20:00 in Europe/Madrid, three services, two chairs, hair-salon pack.
 * No `server-only` import here: `npm run db:seed` runs this outside Next.js.
 */
const day = [
  { open: "10:00", close: "14:00" },
  { open: "17:00", close: "20:00" },
];

export const lolaSeedProfile: ShopProfile = {
  id: "peluqueria-lola",
  name: "Peluquería Lola",
  ownerName: "Lola",
  address: "Calle Mayor 12, Madrid",
  timeZone: "Europe/Madrid",
  sectorPackId: "hair-salon",
  languages: ["es", "en"],
  hours: { 2: day, 3: day, 4: day, 5: day, 6: day },
  services: [
    {
      id: "haircut",
      name: { es: "corte", en: "haircut" },
      aliases: ["corte de pelo", "cortar el pelo", "cortarme el pelo", "cortarse el pelo", "cortar", "hair cut", "cut"],
      durationMin: 30,
      priceCents: 1500,
      spokenName: { es: "un corte", en: "a haircut" },
    },
    {
      id: "colour",
      name: { es: "tinte", en: "colour" },
      aliases: [
        "color",
        "colorear",
        "teñir",
        "teñirme",
        "teñirse",
        "tintarme",
        "pintar el pelo",
        "pintarme el pelo",
        "pintarse el pelo",
        "mechas",
        "mechitas",
        "reflejos",
        "dye",
        "colouring",
        "coloring",
        "highlights",
        "tint",
      ],
      durationMin: 90,
      priceCents: 4500,
      spokenName: { es: "un tinte", en: "a colour" },
    },
    {
      id: "beard",
      name: { es: "barba", en: "beard" },
      aliases: ["arreglo de barba", "arreglar la barba", "arreglarme la barba", "beard trim"],
      durationMin: 20,
      priceCents: 1000,
      spokenName: { es: "un arreglo de barba", en: "a beard trim" },
    },
  ],
  resources: [
    { id: "chair-1", name: { es: "Sillón 1", en: "Chair 1" } },
    { id: "chair-2", name: { es: "Sillón 2", en: "Chair 2" } },
  ],
  // The voice is the hair-salon pack's (es-es-commercial-3 / Kore), so no `voice` override.
  // Pace option 2 (design.md "Pace", decided in task 3.8): play the neural voice 10 % faster
  // with the pitch kept. Option 1 (pace words in the style) was measured and rejected.
  speechRate: 1.1,
};

export interface SeedResult {
  shopId: string;
  /** true when the shop row was inserted, false when an existing row was updated. */
  created: boolean;
}

/**
 * Inserts the shop, or updates the existing row with the same name (7.6).
 * The profile and its sector pack are validated first, so a broken seed
 * never reaches the database. The id of an existing row is kept, so calls,
 * bookings and messages that point at it stay valid.
 */
export async function seedShop(db: Db, input: ShopProfileInput = lolaSeedProfile): Promise<SeedResult> {
  const profile = ShopProfileSchema.parse(input);
  getSectorPack(profile.sectorPackId); // throws on an unknown pack

  const existing = await db.select({ id: shops.id }).from(shops).where(eq(shops.name, profile.name)).limit(1);
  const shopId = existing[0]?.id ?? profile.id;
  const stored: ShopProfile = { ...profile, id: shopId };

  const rows = await db
    .insert(shops)
    .values({
      id: shopId,
      name: stored.name,
      sectorPackId: stored.sectorPackId,
      timeZone: stored.timeZone,
      profile: stored,
    })
    .onConflictDoUpdate({
      target: shops.name,
      set: { sectorPackId: stored.sectorPackId, timeZone: stored.timeZone, profile: stored },
    })
    .returning({ id: shops.id });

  return { shopId: rows[0].id, created: existing.length === 0 };
}

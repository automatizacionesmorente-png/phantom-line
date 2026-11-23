import { ShopProfileSchema, type ShopProfile } from "@/lib/conversation/shopProfile";
import { getSectorPack } from "@/lib/sectors";

const DAY = [
  { open: "10:00", close: "14:00" },
  { open: "16:00", close: "20:00" },
];

/**
 * A shop built from a pack's starter data only: its catalogue, Categories and FAQ, two resources
 * named from the pack, Monday to Saturday hours. The same thing the onboarding wizard starts from.
 */
export function starterShop(packId: string): ShopProfile {
  const pack = getSectorPack(packId);
  if (!pack.starterCatalogue || !pack.starterFaq) throw new Error(`${packId} has no starter data`);
  const kind = pack.resourceKind;
  return ShopProfileSchema.parse({
    id: `starter-${packId}`,
    name: `Starter ${packId}`,
    ownerName: "Marta",
    address: "Calle Mayor 12, Madrid",
    timeZone: "Europe/Madrid",
    sectorPackId: packId,
    languages: ["es", "en"],
    hours: { 1: DAY, 2: DAY, 3: DAY, 4: DAY, 5: DAY, 6: DAY },
    categories: pack.starterCatalogue.categories,
    services: pack.starterCatalogue.services,
    faq: pack.starterFaq,
    resources: [1, 2].map((n) => ({
      id: `r${n}`,
      name: { es: `${kind.es.one} ${n}`, en: `${kind.en.one} ${n}` },
    })),
  });
}

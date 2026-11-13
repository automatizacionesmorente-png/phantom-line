import type { RuleContext, ShopRules } from "@/lib/booking";
import { toShopRules, type ShopProfile } from "@/lib/conversation/shopProfile";
import { getSectorPack } from "@/lib/sectors";

/** Peluquería Lola as in design.md and Requirement 7: Tue–Sat 10–14 and 17–20, 2 chairs. */
const day = [
  { open: "10:00", close: "14:00" },
  { open: "17:00", close: "20:00" },
];

export const lolaProfile: ShopProfile = {
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
      aliases: ["color", "teñir", "teñirme el pelo", "tinte de pelo", "dye", "hair colour", "hair color"],
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
  speechRate: 1.1,
};

export const lolaRules: ShopRules = toShopRules(lolaProfile);

const hairSalon = getSectorPack("hair-salon");
export const lolaPack: RuleContext["pack"] = { slotStepMin: hairSalon.slotStepMin, rules: hairSalon.rules };

import { ShopProfileSchema } from "@/lib/conversation/shopProfile";
import { barberShop } from "./barberShop";
import { beautyCentre } from "./beautyCentre";
import { dentalClinic } from "./dentalClinic";
import { hairSalon } from "./hairSalon";
import { carWorkshop } from "./carWorkshop";
import { drivingSchool } from "./drivingSchool";
import { physioClinic } from "./physioClinic";
import { psychologyPractice } from "./psychologyPractice";
import { tutoringAcademy } from "./tutoringAcademy";
import { SectorPackDataSchema, type Lang, type SectorPack, type VocabularyKey } from "./types";

/** Every pack. A new sector is a new file plus one line here. */
const PACKS: readonly SectorPack[] = [hairSalon, barberShop, beautyCentre, physioClinic, dentalClinic, carWorkshop, psychologyPractice, tutoringAcademy, drivingSchool];

const OPEN_DAY = [{ open: "09:00", close: "20:00" }];

/** A starter catalogue must be a valid Shop_Profile once an owner adds a shop around it. */
function validateStarter(pack: SectorPack): void {
  if (!pack.starterCatalogue && !pack.starterFaq) return;
  const parsed = ShopProfileSchema.safeParse({
    id: "starter-check",
    name: "Starter check",
    ownerName: "Owner",
    address: "Calle Mayor 1, Madrid",
    timeZone: "Europe/Madrid",
    sectorPackId: pack.id,
    languages: ["es", "en"],
    hours: { 1: OPEN_DAY },
    services: pack.starterCatalogue?.services ?? [],
    categories: pack.starterCatalogue?.categories,
    faq: pack.starterFaq,
    resources: [{ id: "r1", name: { es: `${pack.resourceKind.es.one} 1`, en: `${pack.resourceKind.en.one} 1` } }],
  });
  if (!parsed.success) throw new Error(`Sector pack "${pack.id}" has an invalid starter catalogue: ${parsed.error.message}`);
}

function validate(pack: SectorPack): SectorPack {
  const { rules, ...data } = pack;
  const parsed = SectorPackDataSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Sector pack "${pack.id}" is invalid: ${parsed.error.message}`);
  }
  if (!Array.isArray(rules) || rules.some((r) => typeof r !== "function")) {
    throw new Error(`Sector pack "${pack.id}" has a rule that is not a function`);
  }
  validateStarter(pack);
  return pack;
}

// Validated once, when the module loads: a broken pack fails fast.
const BY_ID: ReadonlyMap<string, SectorPack> = (() => {
  const map = new Map<string, SectorPack>();
  for (const pack of PACKS.map(validate)) {
    if (map.has(pack.id)) throw new Error(`Duplicate sector pack id "${pack.id}"`);
    map.set(pack.id, pack);
  }
  return map;
})();

export function getSectorPack(id: string): SectorPack {
  const pack = BY_ID.get(id);
  if (!pack) throw new Error(`Unknown sector pack "${id}"`);
  return pack;
}

export function allSectorPacks(): readonly SectorPack[] {
  return [...BY_ID.values()];
}

/** Vocabulary lookup: term(hairSalon, "es", "booking") → "cita". */
export function term(pack: SectorPack, lang: Lang, key: VocabularyKey): string {
  return pack.vocabulary[lang][key];
}

/** What the onboarding wizard needs to offer a sector: the id, its name in both languages and what a resource is called. */
export interface SectorPackListing {
  id: string;
  name: Record<Lang, string>;
  resourceKind: SectorPack["resourceKind"];
}

/** Every pack the engine can run today (all are appointment packs), in registry order, for a picker. */
export function listSectorPacks(): SectorPackListing[] {
  return [...BY_ID.values()]
    .filter((p) => p.unit === "appointment")
    .map((p) => ({ id: p.id, name: { ...p.displayName }, resourceKind: structuredClone(p.resourceKind) }));
}

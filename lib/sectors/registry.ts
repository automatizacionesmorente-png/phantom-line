import { hairSalon } from "./hairSalon";
import { SectorPackDataSchema, type Lang, type SectorPack, type VocabularyKey } from "./types";

/** Every pack. A new sector is a new file plus one line here. */
const PACKS: readonly SectorPack[] = [hairSalon];

function validate(pack: SectorPack): SectorPack {
  const { rules, ...data } = pack;
  const parsed = SectorPackDataSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Sector pack "${pack.id}" is invalid: ${parsed.error.message}`);
  }
  if (!Array.isArray(rules) || rules.some((r) => typeof r !== "function")) {
    throw new Error(`Sector pack "${pack.id}" has a rule that is not a function`);
  }
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

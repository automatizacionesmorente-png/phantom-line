/**
 * Names, durations and prices of a service or a Service_Combo, and the catalog said in one
 * sentence (front-desk-brain design, "Names and prices"). Every screen and every template that
 * names a booked service goes through here, so nobody ever sees or hears a raw Combo_Id. Pure;
 * no server imports, so the Machine_Page's browser code may use `nameByParts` too.
 */
import { COMBO_SEPARATOR, resolveParts } from "@/lib/booking/services";
import { joinAnd } from "@/lib/receptionist/format";
import { MAX_WORDS } from "@/lib/receptionist/speech";
import type { Lang, SectorPack } from "@/lib/sectors";
import type { ShopProfile, ShopService } from "./shopProfile";

type Localized = Record<Lang, string>;

/** A catalog service or a valid Service_Combo, resolved against the Shop_Profile. */
export interface KnownServiceView {
  known: true;
  /** The id as given: a catalog id or a canonical Combo_Id. */
  id: string;
  /** The catalog services, in catalog order; one for a plain service. */
  parts: readonly ShopService[];
  /** The sum of the parts. */
  durationMin: number;
  /** The sum of the parts. */
  priceCents: number;
  /** True when any part's price is a starting price ("desde" / "from"). */
  priceFrom: boolean;
  /** For the Owner's screens: "Corte de hombre + Degradado". */
  name: Localized;
  /** For the Receptionist: "un corte de hombre y un degradado". */
  spoken: Localized;
}

/** An id the profile does not have (or a broken Combo_Id): its own id, so no screen is empty. */
export interface UnknownServiceView {
  known: false;
  id: string;
  name: Localized;
  spoken: Localized;
}

export type ServiceView = KnownServiceView | UnknownServiceView;

/** What separates the parts' names on the Owner's screens. */
export const COMBO_NAME_JOINER = " + ";

/**
 * How the Receptionist says one service: its `spokenName`, or the pack's booking word with
 * the name ("una cita de corte" / "a corte appointment"), as the phrase book always did.
 * Without a pack, the plain name.
 */
function spokenPart(s: ShopService, lang: Lang, pack?: Pick<SectorPack, "vocabulary">): string {
  if (s.spokenName) return s.spokenName[lang];
  const name = s.name[lang];
  if (!pack) return name;
  const booking = pack.vocabulary[lang].booking;
  if (lang === "es") return `${/o$/i.test(booking) ? "un" : "una"} ${booking} de ${name}`;
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name} ${booking}`;
}

/**
 * A service id or a Combo_Id as the Receptionist and the Owner name it, with its total
 * duration and price. A Combo_Id is valid only as the Booking_Rules accept it (`resolveParts`:
 * 2–3 different parts in catalog order, at most 480 minutes); anything else is unknown.
 */
export function serviceView(
  id: string,
  shop: Pick<ShopProfile, "services">,
  pack?: Pick<SectorPack, "vocabulary">,
): ServiceView {
  const resolved = resolveParts(id, shop.services);
  if (!resolved) return { known: false, id, name: { es: id, en: id }, spoken: { es: id, en: id } };
  // `resolveParts` returns the objects it was given, so these are the profile's own services.
  const parts = resolved as ShopService[];
  const both = (f: (lang: Lang) => string): Localized => ({ es: f("es"), en: f("en") });
  return {
    known: true,
    id,
    parts,
    durationMin: parts.reduce((sum, s) => sum + s.durationMin, 0),
    priceCents: parts.reduce((sum, s) => sum + s.priceCents, 0),
    priceFrom: parts.some((s) => s.priceFrom === true),
    name: both((lang) => parts.map((s) => s.name[lang]).join(COMBO_NAME_JOINER)),
    spoken: both((lang) => joinAnd(parts.map((s) => spokenPart(s, lang, pack)), lang)),
  };
}

/**
 * The Owner's name for a stored service id, from names only (the Machine_Page does not get
 * durations): a catalog id's name, or a Combo_Id's parts joined with " + ". Null when any part
 * is unknown, so the caller can show the id instead.
 */
export function nameByParts(
  id: string,
  services: readonly { id: string; name: Localized }[],
  lang: Lang,
): string | null {
  const exact = services.find((s) => s.id === id);
  if (exact) return exact.name[lang];
  if (!id.includes(COMBO_SEPARATOR)) return null;
  const names: string[] = [];
  for (const part of id.split(COMBO_SEPARATOR)) {
    const s = services.find((x) => x.id === part);
    if (!s) return null;
    names.push(s.name[lang]);
  }
  return names.join(COMBO_NAME_JOINER);
}

/** Over this many services, a profile with Categories names its Categories instead (11.6). */
export const CATALOG_SERVICES_BY_NAME = 5;
/**
 * The most words the catalog list itself may take, so every template that embeds it stays
 * within 25 words a sentence: "Tenemos {list}, ¿te interesa algo?" adds 4.
 */
export const CATALOG_LIST_MAX_WORDS = MAX_WORDS - 5;

const wordsIn = (s: string) => s.split(/\s+/).filter(Boolean).length;
const MORE: Record<Lang, string> = { es: "más cosas", en: "more" };

/**
 * What the shop does, as a list for a sentence: the Categories' names when the profile has
 * more than 5 services and has Categories, else the services' names ("corte, tinte y barba").
 * A list that would pass `CATALOG_LIST_MAX_WORDS` keeps its first items and ends with
 * "y más cosas" / "and more", so it is never cut mid-name.
 */
export function catalogItems(shop: Pick<ShopProfile, "services" | "categories">, lang: Lang): string {
  const categories = shop.categories ?? [];
  const names =
    shop.services.length > CATALOG_SERVICES_BY_NAME && categories.length > 0
      ? categories.map((c) => c.name[lang])
      : shop.services.map((s) => s.name[lang]);
  const all = joinAnd(names, lang);
  if (wordsIn(all) <= CATALOG_LIST_MAX_WORDS) return all;
  for (let count = names.length - 1; count >= 1; count--) {
    const shorter = joinAnd([...names.slice(0, count), MORE[lang]], lang);
    if (wordsIn(shorter) <= CATALOG_LIST_MAX_WORDS) return shorter;
  }
  return joinAnd([names[0], MORE[lang]], lang);
}

/** The catalog in one sentence of at most 25 words (11.6): "Hacemos cortes, barbería, peinados, color y tratamientos." */
export function catalogLine(shop: Pick<ShopProfile, "services" | "categories">, lang: Lang): string {
  return lang === "es" ? `Hacemos ${catalogItems(shop, lang)}.` : `We do ${catalogItems(shop, lang)}.`;
}

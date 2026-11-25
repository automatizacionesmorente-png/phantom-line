/**
 * What the Machine_Page's browser code may know about a Shop (owner-machine design, "The
 * Machine_Page"): its name, languages and zone to format, the Service and Resource names,
 * the pack's vocabulary (for "cita" and the urgency basis text), the opening hours and slot
 * step (the booking book's grid), and whether it is the Demo_Shop. Prices, the address, the PIN hash and the voice settings stay on the
 * server. Pure.
 */
import { nameByParts } from "@/lib/conversation/catalog";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { Lang, SectorPack } from "@/lib/sectors";
import { isDemoShop } from "./demo";

type Localized = Record<Lang, string>;

/** The PIN_Gate needs only this: no Message, Booking, Counter or light state (1.2). */
export interface GateShop {
  id: string;
  name: string;
  languages: Lang[];
  demo: boolean;
  /** A trial shop from the /nacer wizard (shows the "Prueba" badge). */
  trial?: boolean;
}

export interface MachineShop extends GateShop {
  ownerName: string;
  timeZone: string;
  unit: SectorPack["unit"];
  vocabulary: SectorPack["vocabulary"];
  services: { id: string; name: Localized; category?: string; priceCents?: number }[];
  resources: { id: string; name: Localized }[];
  /** Opening hours by ISO weekday (1 Monday … 7 Sunday) and the pack's slot step, for the booking book's grid. */
  hours: Partial<Record<number, { open: string; close: string }[]>>;
  slotStepMin: number;
}

export function toGateShop(shop: ShopProfile, trial = false): GateShop {
  return { id: shop.id, name: shop.name, languages: [...shop.languages], demo: isDemoShop(shop.id), ...(trial ? { trial } : {}) };
}

export function toMachineShop(shop: ShopProfile, pack: SectorPack, trial = false): MachineShop {
  return {
    ...toGateShop(shop, trial),
    ownerName: shop.ownerName,
    timeZone: shop.timeZone,
    unit: pack.unit,
    vocabulary: pack.vocabulary,
    services: shop.services.map((s) => ({
      id: s.id,
      name: { es: s.name.es, en: s.name.en },
      ...(s.category !== undefined ? { category: s.category } : {}),
      ...(s.priceCents !== undefined ? { priceCents: s.priceCents } : {}),
    })),
    resources: shop.resources.map((r) => ({ id: r.id, name: { es: r.name.es, en: r.name.en } })),
    hours: Object.fromEntries(Object.entries(shop.hours).map(([d, v]) => [d, (v ?? []).map((x) => ({ open: x.open, close: x.close }))])),
    slotStepMin: pack.slotStepMin,
  };
}

/**
 * A Service's name in `lang`, a Service_Combo's by its parts ("Corte de hombre + Degradado"),
 * or the id when it left the profile, so a row never renders empty.
 */
export function serviceName(shop: Pick<MachineShop, "services">, id: string, lang: Lang): string {
  return nameByParts(id, shop.services, lang) ?? id;
}

export function resourceName(shop: Pick<MachineShop, "resources">, id: string, lang: Lang): string {
  return shop.resources.find((r) => r.id === id)?.name[lang] ?? id;
}

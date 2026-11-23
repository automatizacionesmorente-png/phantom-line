/**
 * What the Machine_Page's browser code may know about a Shop (owner-machine design, "The
 * Machine_Page"): its name, languages and zone to format, the Service and Resource names,
 * the pack's vocabulary (for "cita" and the urgency basis text), and whether it is the
 * Demo_Shop. Hours, prices, the address, the PIN hash and the voice settings stay on the
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
  services: { id: string; name: Localized }[];
  resources: { id: string; name: Localized }[];
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
    services: shop.services.map((s) => ({ id: s.id, name: { es: s.name.es, en: s.name.en } })),
    resources: shop.resources.map((r) => ({ id: r.id, name: { es: r.name.es, en: r.name.en } })),
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

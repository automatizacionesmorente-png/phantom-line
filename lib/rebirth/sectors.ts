import { getSectorPack, listSectorPacks } from "@/lib/sectors";
import type { Lang } from "@/lib/sectors";

/** A service the wizard offers as a starting point (prices are an estimate the owner must edit). */
export interface StarterService {
  name: Record<Lang, string>;
  durationMin: number;
  priceEur: number;
  from?: boolean;
}

/** A question the receptionist can answer. The answer is the owner's: only an example is shown. */
export interface StarterFaq {
  id: string;
  question: Record<Lang, string>;
  keywords: Record<Lang, string[]>;
  example: Record<Lang, string>;
}

export interface SectorOption {
  id: string;
  name: Record<Lang, string>;
  /** "sillón" / "chair": what a resource is called. */
  resourceKind: Record<Lang, { one: string; many: string }>;
  starterCatalogue: StarterService[];
  starterFaq: StarterFaq[];
}

/** Questions every business gets asked; the sector pack may add its own. */
const COMMON_FAQ: StarterFaq[] = [
  {
    id: "parking",
    question: { es: "Aparcamiento", en: "Parking" },
    keywords: { es: ["aparcar", "parking", "aparcamiento", "dónde dejo el coche"], en: ["parking", "park the car", "car park"] },
    example: { es: "Hay un parking público a dos minutos andando.", en: "There is a public car park two minutes away on foot." },
  },
  {
    id: "pago",
    question: { es: "Formas de pago", en: "Payment methods" },
    keywords: { es: ["pagar con tarjeta", "formas de pago", "efectivo", "aceptáis tarjeta"], en: ["pay by card", "payment", "cash", "do you take cards"] },
    example: { es: "Puedes pagar con tarjeta o en efectivo.", en: "You can pay by card or in cash." },
  },
  {
    id: "cancelacion",
    question: { es: "Política de cancelación", en: "Cancellation policy" },
    keywords: { es: ["política de cancelación", "anular con antelación", "si no puedo ir"], en: ["cancellation policy", "cancel fee", "if I can't make it"] },
    example: { es: "Puedes cambiar o anular tu cita sin coste hasta veinticuatro horas antes.", en: "You can change or cancel free of charge up to twenty-four hours before." },
  },
  {
    id: "accesibilidad",
    question: { es: "Accesibilidad", en: "Accessibility" },
    keywords: { es: ["silla de ruedas", "escalones", "accesible", "carrito"], en: ["wheelchair", "step-free", "accessible", "stroller"] },
    example: { es: "El local está a pie de calle y entra bien una silla de ruedas.", en: "The premises are at street level and a wheelchair fits easily." },
  },
];

const HAIR_SALON_STARTERS: StarterService[] = [
  { name: { es: "Corte de mujer", en: "Women's cut" }, durationMin: 45, priceEur: 25 },
  { name: { es: "Corte de hombre", en: "Men's cut" }, durationMin: 30, priceEur: 14 },
  { name: { es: "Corte infantil", en: "Kids' cut" }, durationMin: 25, priceEur: 10 },
  { name: { es: "Lavar y peinar", en: "Wash and style" }, durationMin: 30, priceEur: 15 },
  { name: { es: "Tinte de raíz", en: "Root colour" }, durationMin: 90, priceEur: 35, from: true },
  { name: { es: "Mechas", en: "Highlights" }, durationMin: 120, priceEur: 60, from: true },
];

/** Sector names and starters kept here until the packs carry their own (see sectorSource). */
const LEGACY: Record<string, { name: Record<Lang, string>; catalogue: StarterService[]; faq: StarterFaq[] }> = {
  "hair-salon": { name: { es: "Peluquería", en: "Hair salon" }, catalogue: HAIR_SALON_STARTERS, faq: COMMON_FAQ },
};

/**
 * MERGE POINT with the sector-packs branch: this is the only place the wizard reads sector
 * data. Today it reads the packs that exist plus the table above. When `listSectorPacks()`
 * (id, name {es,en}, resourceKind, optional starterCatalogue / starterFaq) is merged, replace the
 * body with `return listSectorPacks().map(adapt)` (or return it directly if the shapes match)
 * and delete LEGACY.
 */
function sectorSource(): SectorOption[] {
  return listSectorPacks().map((listing) => {
    const pack = getSectorPack(listing.id);
    const catalogue: StarterService[] = (pack.starterCatalogue?.services ?? []).map((sv) => ({
      name: { es: sv.name.es, en: sv.name.en },
      durationMin: sv.durationMin,
      priceEur: sv.priceCents / 100,
      ...(sv.priceFrom ? { from: true } : {}),
    }));
    return {
      id: listing.id,
      name: listing.name,
      resourceKind: listing.resourceKind,
      starterCatalogue: catalogue.length > 0 ? catalogue : (LEGACY[listing.id]?.catalogue ?? []),
      starterFaq: LEGACY[listing.id]?.faq ?? COMMON_FAQ,
    };
  });
}

/** The sectors the owner can choose in step 1. */
export function availableSectors(): SectorOption[] {
  return sectorSource();
}

export function sectorById(id: string): SectorOption | undefined {
  return availableSectors().find((s) => s.id === id);
}

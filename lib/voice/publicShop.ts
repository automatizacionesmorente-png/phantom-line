import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { Lang } from "@/lib/conversation/types";
import { phrases } from "@/lib/receptionist/phrases";
import { getSectorPack } from "@/lib/sectors";

/**
 * What the Call_Page may know about a Shop: its name, its languages, the
 * service names used to bias speech recognition, and the two notices the
 * page shows by itself (Typed_Mode, line cut). Hours, prices, the address
 * and the resources stay on the server; the receptionist states them.
 * Pure: built on the server from the validated profile.
 */
export interface PublicShop {
  id: string;
  name: string;
  languages: readonly Lang[];
  /** Service names in both languages, for `SpeechRecognition.phrases`. */
  speechPhrases: readonly string[];
  notices: Record<Lang, { typeInstead: string; lineCut: string }>;
}

export function toPublicShop(shop: ShopProfile): PublicShop {
  const pack = getSectorPack(shop.sectorPackId);
  const notices = (lang: Lang) => {
    const p = phrases(lang, pack, shop);
    return { typeInstead: p.typeInstead().text, lineCut: p.lineCut().text };
  };
  const names = shop.services.flatMap((s) => [s.name.es, s.name.en]);
  return {
    id: shop.id,
    name: shop.name,
    languages: [...shop.languages],
    speechPhrases: [...new Set(names)],
    notices: { es: notices("es"), en: notices("en") },
  };
}

/** The conversation language the page starts with: the browser's, when the shop speaks it. */
export function defaultLang(browserLanguage: string | undefined, languages: readonly Lang[]): Lang {
  const base = (browserLanguage ?? "").toLowerCase().split(/[-_]/)[0];
  const match = languages.find((l) => l === base);
  return match ?? languages[0] ?? "es";
}

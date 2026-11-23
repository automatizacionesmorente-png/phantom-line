import type { Lang } from "@/lib/conversation/types";

const BRAND = "Phantom Line";

/** Page titles per route, in the shop's first language (the URL carries no language). Pure. */
export function callTitle(shopName: string, lang: Lang): string {
  return `${lang === "en" ? "Call" : "Llama a"} ${shopName} · ${BRAND}`;
}

export function machineTitle(lang: Lang): string {
  return `${lang === "en" ? "Answering machine" : "Contestador"} · ${BRAND}`;
}

export function notFoundTitle(): string {
  return `Este número no existe / Shop not found · ${BRAND}`;
}

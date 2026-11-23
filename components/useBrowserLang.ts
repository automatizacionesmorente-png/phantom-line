"use client";

import { useState, useSyncExternalStore } from "react";
import type { Lang } from "@/lib/conversation/types";
import { defaultLang } from "@/lib/voice/publicShop";

const noSubscribe = () => () => {};

/**
 * The screen language: the browser's when the shop speaks it, else the shop's first language
 * (as the Call_Page does). The server render and hydration use the first language; the browser
 * one applies right after. A choice made with the switch wins from then on.
 */
export function useBrowserLang(languages: readonly Lang[]): [Lang, (lang: Lang) => void] {
  const [chosen, setChosen] = useState<Lang | null>(null);
  const browser = useSyncExternalStore(
    noSubscribe,
    () => defaultLang(navigator.language, languages),
    () => languages[0] ?? "es",
  );
  return [chosen ?? browser, setChosen];
}

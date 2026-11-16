"use client";

import type { Lang } from "@/lib/conversation/types";

export interface LanguageSwitchProps {
  lang: Lang;
  options: readonly Lang[];
  label: string;
  onChange: (lang: Lang) => void;
}

const NAMES: Record<Lang, { short: string; long: string }> = {
  es: { short: "ES", long: "Español" },
  en: { short: "EN", long: "English" },
};

/** The visible ES / EN switch, usable before and during the Call (1.4, 2.7). */
export function LanguageSwitch({ lang, options, label, onChange }: LanguageSwitchProps) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-border bg-card p-1">
      {options.map((l) => {
        const active = l === lang;
        return (
          <button
            key={l}
            type="button"
            lang={l}
            aria-pressed={active}
            aria-label={NAMES[l].long}
            onClick={() => onChange(l)}
            className={`focus-ring min-h-11 min-w-14 rounded-full px-4 font-inter text-sm font-semibold tracking-wide ${
              active ? "bg-espresso text-card" : "text-text hover:bg-section"
            }`}
          >
            {NAMES[l].short}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import type { Lang } from "@/lib/conversation/types";
import { useBrowserLang } from "../useBrowserLang";
import { GUIDE_COPY, GUIDE_STORAGE_KEY } from "./guideCopy";

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};
const readDismissed = () => {
  try {
    return localStorage.getItem(GUIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

export interface TryItGuideProps {
  /** The step this page is: 1 call, 2 open the machine, 3 watch it. Omit on the landing. */
  current?: 1 | 2 | 3;
  /** The page's own language; omitted, the browser's. */
  lang?: Lang;
}

/**
 * A small, dismissible "Try it in 30 seconds" strip for the judges (BACKLOG 2). Renders
 * nothing on the server and until the browser says it was not dismissed, so a dismissal
 * (kept in localStorage) never flashes back. Shown on the demo pages only.
 */
export function TryItGuide({ current, lang }: TryItGuideProps) {
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  const [browserLang] = useBrowserLang(["es", "en"]);
  if (dismissed) return null;
  const copy = GUIDE_COPY[lang ?? browserLang];

  function dismiss() {
    try {
      localStorage.setItem(GUIDE_STORAGE_KEY, "1");
    } catch {
      // Private mode: the strip still goes away for this page view.
    }
    listeners.forEach((cb) => cb());
  }

  return (
    <aside
      data-try-it-guide=""
      lang={lang ?? browserLang}
      aria-label={copy.title}
      className="relative w-full rounded-2xl border border-gold-dot bg-card px-4 py-3 pr-14 text-left"
    >
      <p className="font-newsreader text-lg font-medium tracking-tight text-ink">{copy.title}</p>
      <ol className="mt-1 flex flex-col gap-1 font-inter text-sm text-text sm:flex-row sm:gap-5">
        {copy.steps.map((text, i) => {
          const active = current === i + 1;
          return (
            <li key={i} aria-current={active ? "step" : undefined} className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  active ? "bg-espresso text-card" : "border border-gold-dot text-gold-text"
                }`}
              >
                {i + 1}
              </span>
              <span className="sr-only">{copy.stepOf(i + 1)}: </span>
              <span className={active ? "font-semibold text-ink" : undefined}>{text}</span>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={dismiss}
        aria-label={copy.dismiss}
        className="focus-ring absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-section"
      >
        <X aria-hidden="true" size={18} />
      </button>
    </aside>
  );
}

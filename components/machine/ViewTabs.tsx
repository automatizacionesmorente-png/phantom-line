"use client";

import { useRef, type KeyboardEvent } from "react";

export type MachineView = "today" | "clients" | "business" | "settings" | "tape";
/** The four tabs of the bar; `tape` is a sub-view opened from Today's messages tile. */
export type TabView = Exclude<MachineView, "tape">;
export const TAB_VIEWS: readonly TabView[] = ["today", "clients", "business", "settings"];
export const MACHINE_VIEWS: readonly MachineView[] = [...TAB_VIEWS, "tape"];
const VIEWS = TAB_VIEWS;

/** Today and the tape keep the big machine header; the other tabs show the slim one, so content starts higher. */
export const isSlimView = (v: MachineView): boolean => v === "clients" || v === "business" || v === "settings";

export const tabId = (base: string, v: MachineView) => `${base}-tab-${v}`;
export const panelId = (base: string, v: MachineView) => `${base}-panel-${v}`;

/**
 * The views of the machine as ARIA tabs (owner-machine 6.6, 13.6): one tab stop, the
 * selected tab; ArrowLeft / ArrowRight (and Home / End) move selection and focus.
 */
export function ViewTabs({
  view,
  onChange,
  labels,
  label,
  idBase,
}: {
  view: MachineView;
  onChange: (v: MachineView) => void;
  labels: Record<TabView, string>;
  label: string;
  idBase: string;
}) {
  const refs = useRef<Record<TabView, HTMLButtonElement | null>>({ today: null, clients: null, business: null, settings: null });

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    // The tape belongs to Today: from the tape the arrows start at the Today tab.
    const at = Math.max(0, VIEWS.indexOf(view === "tape" ? "today" : view));
    let next: TabView | null = null;
    if (e.key === "ArrowRight") next = VIEWS[(at + 1) % VIEWS.length];
    else if (e.key === "ArrowLeft") next = VIEWS[(at - 1 + VIEWS.length) % VIEWS.length];
    else if (e.key === "Home") next = VIEWS[0];
    else if (e.key === "End") next = VIEWS[VIEWS.length - 1];
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="flex w-full rounded-full border border-border bg-card p-1 shadow-[inset_0_1px_2px_rgb(36_29_20/0.05)]">
      {VIEWS.map((v) => {
        const selected = v === view;
        // Reading the tape, Today stays the one tab stop so the bar remains reachable.
        const stop = selected || (view === "tape" && v === "today");
        return (
          <button
            key={v}
            ref={(el) => {
              refs.current[v] = el;
            }}
            id={tabId(idBase, v)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(idBase, v)}
            tabIndex={stop ? 0 : -1}
            onClick={() => onChange(v)}
            onKeyDown={onKeyDown}
            className={`focus-ring min-h-11 flex-1 rounded-full px-4 font-inter text-base font-semibold ${
              selected ? "bg-espresso text-card shadow-sm" : "text-text transition-colors hover:bg-section active:bg-border"
            }`}
          >
            {labels[v]}
          </button>
        );
      })}
    </div>
  );
}

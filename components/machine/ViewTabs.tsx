"use client";

import { useRef, type KeyboardEvent } from "react";

export type MachineView = "tape" | "agenda" | "clients";
const VIEWS: readonly MachineView[] = ["tape", "agenda", "clients"];

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
  labels: Record<MachineView, string>;
  label: string;
  idBase: string;
}) {
  const refs = useRef<Record<MachineView, HTMLButtonElement | null>>({ tape: null, agenda: null, clients: null });

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const at = VIEWS.indexOf(view);
    let next: MachineView | null = null;
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
    <div role="tablist" aria-label={label} className="flex w-full rounded-full border border-border bg-card p-1">
      {VIEWS.map((v) => {
        const selected = v === view;
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
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(v)}
            onKeyDown={onKeyDown}
            className={`focus-ring min-h-11 flex-1 rounded-full px-4 font-inter text-base font-semibold ${
              selected ? "bg-espresso text-card" : "text-text hover:bg-section"
            }`}
          >
            {labels[v]}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useId } from "react";
import { OUTBOX_KINDS, type Automations } from "@/lib/salon/settings";
import type { SettingsCopy } from "./settingsCopy";

/** The five switches, each with its one-line explanation. The review one stays off until a link is saved. */
export function AutomationSwitches({
  value,
  copy,
  hasLink,
  busy,
  onToggle,
}: {
  value: Automations;
  copy: SettingsCopy;
  hasLink: boolean;
  busy: boolean;
  onToggle: (kind: (typeof OUTBOX_KINDS)[number], on: boolean) => void;
}) {
  const id = useId();
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {OUTBOX_KINDS.map((k) => {
        const blocked = k === "review" && !value.review && !hasLink;
        return (
          <li key={k} className="rounded-2xl border border-border bg-card px-3 py-2">
            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                role="switch"
                aria-labelledby={`${id}-${k}`}
                aria-describedby={`${id}-${k}-d`}
                checked={value[k]}
                disabled={busy || blocked}
                onChange={(e) => onToggle(k, e.target.checked)}
                className="focus-ring mt-1 h-5 w-5 shrink-0 accent-[var(--gold-text)]"
              />
              <span className="flex flex-col">
                <span id={`${id}-${k}`} className="font-inter text-base font-semibold text-ink">
                  {copy.automations.label[k]}
                </span>
                <span id={`${id}-${k}-d`} className="font-inter text-sm text-muted">
                  {copy.automations.explain[k]}
                  {blocked ? ` ${copy.review.needsLinkSwitch}` : ""}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

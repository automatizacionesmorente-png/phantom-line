"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { MachineView } from "./ViewTabs";

const EVENT = "phantom-line:view";
const keyOf = (shopId: string) => `pl:view:${shopId}`;

function read(shopId: string): MachineView {
  try {
    return window.sessionStorage.getItem(keyOf(shopId)) === "agenda" ? "agenda" : "tape";
  } catch {
    return "tape";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The last view (Tape or Agenda) for this tab's session (owner-machine 6.6), kept in
 * `sessionStorage`. The server renders the Tape; the stored view applies after hydration.
 */
export function useStoredView(shopId: string): [MachineView, (v: MachineView) => void] {
  const view = useSyncExternalStore(
    subscribe,
    () => read(shopId),
    () => "tape" as const,
  );
  const set = useCallback(
    (v: MachineView) => {
      try {
        window.sessionStorage.setItem(keyOf(shopId), v);
      } catch {
        // Private mode without storage: the view still changes for this page.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [shopId],
  );
  return [view, set];
}

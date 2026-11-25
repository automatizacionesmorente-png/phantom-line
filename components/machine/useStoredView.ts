"use client";

import { useCallback, useSyncExternalStore } from "react";
import { MACHINE_VIEWS, type MachineView } from "./ViewTabs";

const EVENT = "phantom-line:view";
const keyOf = (shopId: string) => `pl:view:${shopId}`;

function read(shopId: string): MachineView {
  try {
    const v = window.sessionStorage.getItem(keyOf(shopId));
    return MACHINE_VIEWS.find((x) => x === v) ?? "today";
  } catch {
    return "today";
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
 * The last view (Today, Clients, My business, Settings or the Tape) for this tab's session (owner-machine 6.6), kept in
 * `sessionStorage`. The server renders Today; the stored view applies after hydration.
 */
export function useStoredView(shopId: string): [MachineView, (v: MachineView) => void] {
  const view = useSyncExternalStore(
    subscribe,
    () => read(shopId),
    () => "today" as const,
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

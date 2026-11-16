"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { ROW_BUTTON, sessionUrl } from "./controlButton";

/** "Lock the machine" (owner-machine 1.9): ends the session cookie and goes back to the PIN_Gate. */
export function LockButton({ shopId, label, onLocked }: { shopId: string; label: string; onLocked: () => void }) {
  const [busy, setBusy] = useState(false);
  async function lock() {
    setBusy(true);
    try {
      await fetch(sessionUrl(shopId), { method: "DELETE", cache: "no-store" });
    } catch {
      // Even offline, the page goes back to the gate; the next load checks the cookie again.
    }
    onLocked();
  }
  return (
    <button type="button" onClick={lock} disabled={busy} className={ROW_BUTTON}>
      <Lock aria-hidden="true" size={16} />
      {label}
    </button>
  );
}

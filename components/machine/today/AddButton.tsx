"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarPlus, Ban, Plus } from "lucide-react";
import { CONTROL_BUTTON, GOLD_GRADIENT } from "../controlButton";
import type { AddCopy } from "./addCopy";

/**
 * The big + button, always visible at the bottom of Today (salon spec 2.1). It opens a two-item
 * menu: a new appointment or a time block. Escape closes the menu and returns focus to the +.
 */
export function AddButton({
  copy,
  bookingWord,
  onNewBooking,
  onBlock,
}: {
  copy: AddCopy;
  bookingWord: string;
  onNewBooking: () => void;
  onBlock: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  function choose(go: () => void) {
    setOpen(false);
    go();
  }

  return (
    <div
      className="pointer-events-none sticky bottom-4 z-10 flex flex-col items-end gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      {open && (
        <div
          id={`${id}-menu`}
          role="group"
          aria-label={copy.add.menu}
          className="pointer-events-auto flex flex-col gap-2 rounded-2xl border border-gold-dot bg-card p-2 shadow-[0_12px_30px_rgb(36_29_20/0.2)]"
        >
          <button ref={first} type="button" onClick={() => choose(onNewBooking)} className={CONTROL_BUTTON}>
            <CalendarPlus aria-hidden="true" size={18} />
            {copy.add.newBooking(bookingWord)}
          </button>
          <button type="button" onClick={() => choose(onBlock)} className={CONTROL_BUTTON}>
            <Ban aria-hidden="true" size={18} />
            {copy.add.block}
          </button>
        </div>
      )}
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring pointer-events-auto inline-flex min-h-14 min-w-14 items-center justify-center gap-2 rounded-full px-5 font-inter text-[1.1875rem] font-bold text-ink shadow-[0_8px_20px_rgb(36_29_20/0.28)]"
        style={GOLD_GRADIENT}
      >
        <Plus aria-hidden="true" size={24} className={open ? "rotate-45" : ""} />
        {copy.add.label}
      </button>
    </div>
  );
}

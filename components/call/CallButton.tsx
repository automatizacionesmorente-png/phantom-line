"use client";

export interface CallButtonProps {
  /** `call` and `again` are the gold primary pill; `hangup` is the ink outline pill. */
  mode: "call" | "again" | "hangup";
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/** The one primary control of the Call_Page: "Call →", then "Hang up" during the Call. */
export function CallButton({ mode, label, onClick, disabled }: CallButtonProps) {
  const base =
    "inline-flex min-h-14 min-w-44 items-center justify-center gap-3 rounded-full px-8 py-3 font-inter text-lg font-semibold " +
    "motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 disabled:cursor-not-allowed disabled:opacity-60";
  if (mode === "hangup") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`${base} border-2 border-ink bg-card text-ink hover:bg-section`}
      >
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} bg-(image:--gold-gradient) text-ink shadow-[0_10px_30px_-12px_rgb(36_29_20/0.45)] motion-safe:hover:-translate-y-0.5`}
    >
      {label}
      <span aria-hidden="true">→</span>
    </button>
  );
}

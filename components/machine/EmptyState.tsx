import type { ReactNode } from "react";

/** A tasteful empty list: a dashed card with a small cassette mark and one line of text. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      data-empty-state=""
      className="flex items-center gap-3 rounded-2xl border border-dashed border-gold-dot bg-card/60 px-4 py-4 font-inter text-base text-muted"
    >
      <svg aria-hidden="true" width="28" height="20" viewBox="0 0 28 20" fill="none" className="shrink-0 text-gold-dot">
        <rect x="1" y="1" width="26" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="9" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="19" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <p className="m-0">{children}</p>
    </div>
  );
}

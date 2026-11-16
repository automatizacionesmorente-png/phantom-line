/** The machine's tape keys: ink outline pills, at least 44 × 44 px (owner-machine 6.7), gold focus ring. */
export const CONTROL_BUTTON =
  "focus-ring inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border-2 border-ink bg-card px-4 font-inter text-base font-semibold uppercase tracking-[0.06em] text-ink hover:bg-section disabled:border-border disabled:text-muted disabled:hover:bg-card";

/** Smaller row actions in the Agenda: still 44 px tall. */
export const ROW_BUTTON =
  "focus-ring inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-ink bg-card px-3.5 font-inter text-sm font-semibold text-ink hover:bg-section disabled:text-muted";

/**
 * The gold pill of design.md, with ink text. Ink on the darkest gradient stop (#9E731F) is
 * 4.4:1, under 4.5:1 for normal text, so the label is 19 px bold: large text, 3:1
 * (tests/design/contrast.test.ts checks every stop).
 */
export const PRIMARY_BUTTON =
  "focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-7 font-inter text-[1.1875rem] font-bold text-ink shadow-[0_6px_16px_rgb(36_29_20/0.18)] disabled:opacity-70";
export const GOLD_GRADIENT = { backgroundImage: "var(--gold-gradient)" } as const;

export const sessionUrl = (shopId: string) => `/api/machine/${encodeURIComponent(shopId)}/session`;

import { GOLD_GRADIENT } from "../controlButton";

export interface BarItem {
  key: string;
  label: string;
  cents: number;
  /** The amount as text (already formatted), and an optional second note. */
  valueText: string;
  note?: string;
}

/**
 * Ranked horizontal bars in plain CSS (no chart library): the widest bar is the largest figure. Each
 * row is a list item with its label and amount as text, so a screen reader needs no picture.
 */
export function Bars({ items, label, title }: { items: BarItem[]; label: string; title?: string }) {
  const max = Math.max(1, ...items.map((i) => i.cents));
  return (
    <ul aria-label={label} title={title} className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((i) => (
        <li key={i.key} className="flex flex-col gap-1">
          <div className={`flex items-baseline justify-between gap-3 font-inter text-sm ${i.cents > 0 ? "text-ink" : "text-muted"}`}>
            <span className="min-w-0 break-words">{i.label}</span>
            <span className="shrink-0 font-newsreader text-base font-semibold tabular-nums">
              {i.valueText}
              {i.note && <span className="ml-1.5 font-inter text-sm font-normal text-muted">{i.note}</span>}
            </span>
          </div>
          {i.cents > 0 ? (
            <div aria-hidden="true" className="h-2.5 w-full overflow-hidden rounded-full bg-border/70 shadow-[inset_0_1px_1px_rgb(36_29_20/0.08)]">
              <div
                data-bar=""
                className="h-full rounded-full"
                style={{ width: `${Math.max(2, Math.round((i.cents / max) * 100))}%`, ...GOLD_GRADIENT }}
              />
            </div>
          ) : (
            <div aria-hidden="true" data-empty-bar="" className="h-2.5 w-full border-b border-dashed border-border" />
          )}
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { ExpenseItem } from "@/lib/salon/month";
import type { Lang } from "@/lib/sectors";
import { ROW_BUTTON } from "../controlButton";
import { formatRevenue } from "../weekCopy";
import { dayShort, type BusinessCopy } from "./businessCopy";

/** The month's expenses: one-off rows and the monthly ones, each with a 44 px delete that asks first. */
export function ExpensesList({
  items,
  lang,
  copy,
  onDelete,
}: {
  items: ExpenseItem[];
  lang: Lang;
  copy: BusinessCopy;
  /** Returns whether it worked. */
  onDelete: (id: string) => Promise<boolean>;
}) {
  const t = copy.expenses;
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (items.length === 0) return <p className="font-inter text-base text-muted">{t.empty}</p>;

  async function confirm(id: string) {
    setBusy(true);
    setError(false);
    const ok = await onDelete(id);
    setBusy(false);
    if (ok) setAsking(null);
    else setError(true);
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((e) => (
        <li key={e.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="break-words font-inter text-base font-semibold text-ink">{e.concept}</span>
              <span className="font-inter text-sm text-muted">
                {copy.categories[e.category]} · {dayShort(e.day, lang)}
                {e.recurring && ` · ${t.monthly}`}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-newsreader text-xl text-ink">{formatRevenue(e.amountCents, lang)}</span>
              <button
                type="button"
                aria-label={t.delete(e.concept)}
                onClick={() => {
                  setAsking(e.id);
                  setError(false);
                }}
                className={`${ROW_BUTTON} print:hidden`}
              >
                <Trash2 aria-hidden="true" size={18} />
              </button>
            </div>
          </div>
          {asking === e.id && (
            <div role="group" aria-label={t.delete(e.concept)} className="flex flex-wrap items-center gap-2 print:hidden">
              <p className="m-0 font-inter text-sm font-semibold text-light-text">{e.recurring ? t.confirmMonthly : t.confirm}</p>
              <button type="button" disabled={busy} onClick={() => void confirm(e.id)} className={ROW_BUTTON}>
                {t.yes}
              </button>
              <button type="button" disabled={busy} onClick={() => setAsking(null)} className={ROW_BUTTON}>
                {t.no}
              </button>
              {error && (
                <p role="alert" className="m-0 w-full font-inter text-sm text-light-text">
                  {t.deleteFailed}
                </p>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

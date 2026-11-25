import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Lang } from "@/lib/sectors";
import { CONTROL_BUTTON } from "../controlButton";
import { monthLabel, type BusinessCopy } from "./businessCopy";

/** The month picker: previous and next buttons around the month's name (24 months back, 1 ahead). */
export function MonthHeader({
  month,
  lang,
  copy,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  month: string;
  lang: Lang;
  copy: BusinessCopy;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div role="group" aria-label={copy.month.nav} className="flex items-center justify-between gap-2 print:hidden">
      <button type="button" onClick={onPrev} disabled={!canPrev} aria-label={copy.month.prev} className={CONTROL_BUTTON}>
        <ChevronLeft aria-hidden="true" size={20} />
      </button>
      <h3 aria-live="polite" className="m-0 text-center font-newsreader text-2xl font-medium tracking-tight text-ink">
        {monthLabel(month, lang)}
      </h3>
      <button type="button" onClick={onNext} disabled={!canNext} aria-label={copy.month.next} className={CONTROL_BUTTON}>
        <ChevronRight aria-hidden="true" size={20} />
      </button>
    </div>
  );
}

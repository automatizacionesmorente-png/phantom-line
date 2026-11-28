import type { Lang } from "@/lib/sectors";
import { formatRevenue } from "../weekCopy";
import type { TodayCopy } from "./todayCopy";

/**
 * The four big numbers (salon spec 2.1): appointments today, free slots, expected takings
 * (cancelled bookings left out) and new messages, which is the way into the Tape.
 */
export function KpiRow({
  copy,
  lang,
  bookingWord,
  appointments,
  freeSlots,
  takingsCents,
  newMessages,
  onOpenTape,
}: {
  copy: TodayCopy;
  lang: Lang;
  bookingWord: string;
  appointments: number;
  freeSlots: number;
  takingsCents: number;
  newMessages: number;
  onOpenTape: () => void;
}) {
  const tile = "flex min-h-11 flex-col justify-between gap-1 pl-card px-3 py-2.5 text-left";
  const label = "font-inter text-sm text-muted";
  const num = "pl-num text-3xl leading-none text-ink";
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <div data-kpi="appointments" className={tile}>
        <span className={label}>{copy.kpi.appointments(bookingWord)}</span>
        <span className={num}>{appointments}</span>
      </div>
      <div data-kpi="free" className={tile}>
        <span className={label}>{copy.kpi.free}</span>
        <span className={num}>{freeSlots}</span>
      </div>
      <div data-kpi="takings" className={tile}>
        <span className={label}>{copy.kpi.takings}</span>
        <span className={num}>{formatRevenue(takingsCents, lang)}</span>
      </div>
      <button
        type="button"
        data-kpi="messages"
        data-messages-tile=""
        onClick={onOpenTape}
        className={`focus-ring ${tile} hover:bg-section`}
      >
        <span className={`${label} font-semibold`}>{copy.kpi.messages}</span>
        <span className={`${num} text-gold-text`}>{newMessages}</span>
      </button>
    </div>
  );
}

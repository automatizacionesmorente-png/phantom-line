import { Temporal } from "temporal-polyfill";
import type { AgendaDayDto, AgendaItem } from "@/lib/owner/api";
import { formatClock } from "@/lib/owner/format";
import { serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import type { TodayCopy } from "./todayCopy";

/**
 * Seven days with their number of bookings (salon spec 2.1). Tapping a day selects it. In the
 * week view (`expanded`) each day also lists its bookings, and tapping one opens its sheet.
 */
export function WeekStrip({
  days,
  selected,
  today,
  expanded,
  shop,
  lang,
  copy,
  bookingWord,
  onSelect,
  onBooking,
}: {
  days: readonly AgendaDayDto[];
  selected: string;
  today: string;
  expanded: boolean;
  shop: MachineShop;
  lang: Lang;
  copy: TodayCopy;
  bookingWord: string;
  onSelect: (date: string) => void;
  onBooking: (item: AgendaItem) => void;
}) {
  const weekday = new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" });
  const active = (d: AgendaDayDto) => d.items.filter((i) => i.status !== "cancelled");
  return (
    <ol className={expanded ? "flex flex-col gap-2" : "grid grid-cols-7 gap-1.5"}>
      {days.slice(0, 7).map((d) => {
        const date = Temporal.PlainDate.from(d.date);
        const n = active(d).length;
        const name = `${weekday.format(new Date(Date.UTC(date.year, date.month - 1, date.day)))} ${date.day}`;
        return (
          <li key={d.date} className="min-w-0">
            <button
              type="button"
              data-week-day={d.date}
              aria-pressed={d.date === selected}
              aria-label={`${name}, ${copy.weekCount(n, bookingWord)}`}
              onClick={() => onSelect(d.date)}
              className={`focus-ring ${d.date === selected ? "" : "pl-chip"} flex min-h-11 w-full ${expanded ? "flex-row items-center justify-between px-4" : "flex-col items-center justify-center px-1"} rounded-2xl border py-1.5 font-inter ${
                d.date === selected ? "border-ink bg-espresso text-card" : "border-border bg-card text-ink"
              }`}
            >
              <span className="text-sm font-semibold capitalize">{d.date === today ? copy.nav.today : name}</span>
              <span className={`pl-num text-xl ${d.date === selected ? "text-card" : "text-gold-text"}`}>{n}</span>
            </button>
            {expanded && n > 0 && (
              <ul className="mt-1 flex flex-col gap-1 pl-3">
                {active(d).map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => onBooking(i)}
                      className="focus-ring flex min-h-11 w-full items-baseline gap-3 rounded-xl px-3 text-left font-inter text-base text-ink hover:bg-section"
                    >
                      <span className="font-newsreader text-xl">{formatClock(Temporal.Instant.from(i.start), shop.timeZone, lang)}</span>
                      <span className="font-semibold">{i.customerName}</span>
                      <span className="truncate text-muted">{serviceName(shop, i.serviceId, lang)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

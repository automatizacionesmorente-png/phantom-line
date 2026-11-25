import { TriangleAlert } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import type { AgendaItem } from "@/lib/owner/api";
import { formatClock } from "@/lib/owner/format";
import { resourceName, serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { BlockDto } from "@/lib/salon/api";
import type { DayLayout } from "@/lib/salon/dayLayout";
import type { Lang } from "@/lib/sectors";
import { formatRevenue } from "../weekCopy";
import type { TodayCopy } from "./todayCopy";

/** Pixels per hour: a 30 minute booking is 44 px, the tap target minimum. */
const PX_PER_HOUR = 88;

/** Six tints over the colour tokens, text always ink. */
const TINTS = [
  "border-gold-text bg-gold-dot/35",
  "border-olive bg-olive/15",
  "border-light-text bg-light/15",
  "border-espresso bg-espresso/10",
  "border-gold bg-gold/15",
  "border-muted bg-border",
] as const;

/** A fixed tint for the usual category ids; any other category rotates through the six by a stable hash. */
const KNOWN: Record<string, number> = { cut: 0, color: 1, colour: 1, treatment: 2, styling: 3, beard: 4, nails: 5 };
export function tintFor(category: string | undefined): string {
  if (!category) return TINTS[0];
  const known = KNOWN[category];
  if (known !== undefined) return TINTS[known];
  let h = 0;
  for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export interface FreeGap {
  resourceId: string;
  /** ISO instant the gap starts: the booking dialog opens at this time. */
  start: string;
  end: string;
}

/**
 * The day as a booking book (salon spec 2.1): one column per worker, a coloured block for each
 * appointment, dashed free gaps, blocked time hatched, and a red line at the current time.
 */
export function DayBook({
  layout,
  shop,
  lang,
  copy,
  allergy,
  onBooking,
  onFreeGap,
}: {
  layout: DayLayout<AgendaItem, BlockDto>;
  shop: MachineShop;
  lang: Lang;
  copy: TodayCopy;
  allergy: ReadonlySet<string>;
  onBooking: (item: AgendaItem) => void;
  onFreeGap?: (gap: FreeGap) => void;
}) {
  const clock = (iso: string) => formatClock(Temporal.Instant.from(iso), shop.timeZone, lang);
  const height = ((layout.endMin - layout.startMin) / 60) * PX_PER_HOUR;
  const firstHour = Math.ceil(layout.startMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h * 60 <= layout.endMin; h++) hours.push(h);
  const pct = (m: number) => ((m - layout.startMin) / (layout.endMin - layout.startMin)) * 100;
  const cols = layout.columns.length;
  const tint = (item: AgendaItem) => tintFor(shop.services.find((s) => s.id === item.serviceId)?.category);

  return (
    <div className="flex rounded-2xl border border-border bg-card">
      <div className="w-11 shrink-0 pt-9" aria-hidden="true">
        <div className="relative" style={{ height }}>
          {hours.map((h) => (
            <span key={h} className="absolute right-1.5 -translate-y-1/2 font-inter text-xs text-muted" style={{ top: `${pct(h * 60)}%` }}>
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="relative">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(9rem, 1fr))`, minWidth: `${cols * 9}rem` }}>
            {layout.columns.map((col) => (
              <div key={col.resourceId} data-column={col.resourceId} className="min-w-0 border-l border-border">
                <h3 className="flex h-9 items-center justify-center truncate px-2 font-inter text-sm font-semibold text-ink">
                  {resourceName(shop, col.resourceId, lang)}
                </h3>
                <div className="relative" style={{ height }}>
                  {hours.map((h) => (
                    <div
                      key={h}
                      aria-hidden="true"
                      className="absolute inset-x-0 border-t border-border"
                      style={{ top: `${pct(h * 60)}%` }}
                    />
                  ))}
                  {col.entries.map((e, n) => {
                    const pos = { top: `${e.topPct}%`, height: `${e.heightPct}%` };
                    const range = `${clock(e.start)}-${clock(e.end)}`;
                    if (e.kind === "free") {
                      const label = copy.gap(clock(e.start), clock(e.end));
                      const cls = "absolute inset-x-1 rounded-lg border-2 border-dashed border-border";
                      return onFreeGap ? (
                        <button
                          key={`f${n}`}
                          type="button"
                          data-free=""
                          aria-label={label}
                          style={pos}
                          onClick={() => onFreeGap({ resourceId: col.resourceId, start: e.start, end: e.end })}
                          className={`focus-ring ${cls} hover:bg-section`}
                        />
                      ) : (
                        <div key={`f${n}`} data-free="" role="img" aria-label={label} style={pos} className={cls} />
                      );
                    }
                    if (e.kind === "block") {
                      return (
                        <div
                          key={`k${n}`}
                          data-block={e.block!.id}
                          style={pos}
                          className="absolute inset-x-1 overflow-hidden rounded-lg border border-border bg-section px-2 py-1 font-inter text-xs text-muted [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgb(107_102_94/0.15)_6px_7px)]"
                        >
                          <span className="font-semibold">{e.block!.reason || copy.blocked}</span> · {range}
                        </div>
                      );
                    }
                    const item = e.item!;
                    const has = allergy.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-booking={item.id}
                        style={pos}
                        aria-label={`${range}, ${item.customerName}, ${serviceName(shop, item.serviceId, lang)}${has ? `, ${copy.allergy}` : ""}`}
                        onClick={() => onBooking(item)}
                        className={`focus-ring absolute inset-x-1 flex flex-col overflow-hidden rounded-lg border-l-4 px-2 py-1 text-left font-inter text-ink ${tint(item)} ${
                          item.state === "no_show" ? "opacity-60" : ""
                        }`}
                      >
                        <span className="flex items-center gap-1 text-sm font-semibold leading-tight">
                          <span className="truncate">{item.customerName}</span>
                          {has && <TriangleAlert data-allergy="" aria-hidden="true" size={14} className="shrink-0 text-light-text" />}
                        </span>
                        <span className="truncate text-xs leading-tight">
                          {clock(e.start)} · {serviceName(shop, item.serviceId, lang)}
                          {item.priceCents !== null && ` · ${formatRevenue(item.priceCents, lang)}`}
                        </span>
                        {item.state !== "confirmed" && (
                          <span className="truncate text-xs font-semibold leading-tight">{copy.sheet.state[item.state]}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {layout.nowPct !== null && (
            <div
              data-now-line=""
              role="img"
              aria-label={copy.nowLine}
              className="pointer-events-none absolute inset-x-0 h-0.5 bg-light-text"
              style={{ top: `calc(2.25rem + ${(layout.nowPct / 100) * height}px)` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

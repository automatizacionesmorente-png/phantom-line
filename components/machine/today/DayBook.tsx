import { Check, TriangleAlert } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import type { AgendaItem } from "@/lib/owner/api";
import { formatClock } from "@/lib/owner/format";
import { resourceName, serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { BlockDto } from "@/lib/salon/api";
import type { DayLayout } from "@/lib/salon/dayLayout";
import type { Lang } from "@/lib/sectors";
import { formatRevenue } from "../weekCopy";
import { isCompact, PX_PER_HOUR, STATE_STYLE, tintFor } from "./dayBookStyle";
import type { TodayCopy } from "./todayCopy";

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
  const tint = (item: AgendaItem) => tintFor(shop.services.find((s) => s.id === item.serviceId)?.category).cls;

  return (
    <div className="flex rounded-2xl border border-border bg-card shadow-[0_2px_10px_rgb(36_29_20/0.06)]">
      <div className="w-11 shrink-0 pt-9" aria-hidden="true">
        <div className="relative" style={{ height }}>
          {hours.map((h) => (
            <span key={h} className="absolute right-1.5 -translate-y-1/2 font-inter text-xs text-muted" style={{ top: `${pct(h * 60)}%` }}>
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto md:overflow-x-clip">
        <div className="relative">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(9rem, 1fr))`, minWidth: `${cols * 9}rem` }}>
            {layout.columns.map((col) => (
              <div key={col.resourceId} data-column={col.resourceId} className="min-w-0 border-l border-border">
                <h3 className="sticky top-0 z-10 flex h-9 items-center justify-center truncate border-b border-border bg-card px-2 font-inter text-sm font-semibold text-ink">
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
                    const st = STATE_STYLE[item.state];
                    const compact = isCompact(e.startMin, e.endMin);
                    const stateLabel = copy.sheet.state[item.state];
                    const chip =
                      st.chip !== null && (
                        <span data-state={item.state} className={st.chip}>
                          {st.icon === "check" && <Check aria-hidden="true" size={11} strokeWidth={3} />}
                          {compact && st.icon !== null ? <span className="sr-only">{stateLabel}</span> : stateLabel}
                        </span>
                      );
                    const name = (
                      <span className={`truncate ${st.strike ? "line-through decoration-1" : ""}`}>{item.customerName}</span>
                    );
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-booking={item.id}
                        data-compact={compact ? "" : undefined}
                        style={pos}
                        aria-label={`${range}, ${item.customerName}, ${serviceName(shop, item.serviceId, lang)}${item.state !== "confirmed" ? `, ${stateLabel}` : ""}${has ? `, ${copy.allergy}` : ""}`}
                        onClick={() => onBooking(item)}
                        className={`focus-ring absolute inset-x-1 flex flex-col justify-center overflow-hidden rounded-lg border-l-4 px-2 py-0.5 text-left font-inter text-ink transition-[filter,box-shadow] hover:brightness-95 active:brightness-90 ${tint(item)} ${
                          item.state === "no_show" ? "opacity-70" : ""
                        }`}
                      >
                        <span className="flex items-center gap-1 text-sm font-semibold leading-tight">
                          {name}
                          {compact && <span className="shrink-0 text-xs font-normal tabular-nums">{clock(e.start)}</span>}
                          {has && <TriangleAlert data-allergy="" aria-hidden="true" size={14} className="shrink-0 text-light-text" />}
                          <span className="ml-auto" />
                          {chip}
                        </span>
                        {!compact && (
                          <span className="truncate text-xs leading-tight tabular-nums">
                            {clock(e.start)} · {serviceName(shop, item.serviceId, lang)}
                            {item.priceCents !== null && ` · ${formatRevenue(item.priceCents, lang)}`}
                          </span>
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

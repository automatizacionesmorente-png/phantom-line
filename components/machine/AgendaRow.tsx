import { CalendarClock, Check, X } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import type { AgendaItem } from "@/lib/owner/api";
import type { OwnerBookingAction } from "@/lib/owner/agenda";
import { formatClock } from "@/lib/owner/format";
import { resourceName, serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import { ChannelLabel } from "./ChannelLabel";
import { ROW_BUTTON } from "./controlButton";
import type { MachineCopy } from "./machineCopy";
import { whenOf } from "./TapeCard";

const ICON = { confirm: Check, move: CalendarClock, cancel: X } as const;

const STATUS_STYLE = {
  booked: "border border-gold-text/40 bg-card text-gold-text",
  confirmed: "bg-espresso text-card",
  cancelled: "border border-border bg-section text-muted line-through",
} as const;

/**
 * One Booking in the Agenda (owner-machine 9.2, 9.5, 10.1): local time, customer, what was
 * booked in the pack's words, Resource, Agenda_Status as text, Channel, who last changed it
 * from the machine, and the one-tap actions the server allows for it now.
 */
export function AgendaRow({
  item,
  shop,
  lang,
  copy,
  busy,
  notice,
  onAction,
}: {
  item: AgendaItem;
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  busy: boolean;
  notice: string | null;
  onAction: (item: AgendaItem, action: OwnerBookingAction) => void;
}) {
  const start = Temporal.Instant.from(item.start);
  const cancelled = item.status === "cancelled";
  const last = item.lastOwnerAction;
  return (
    <li data-booking={item.id} className="flex flex-col gap-2 rounded-[18px] border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`font-newsreader text-2xl text-ink ${cancelled ? "text-muted" : ""}`}>
          {formatClock(start, shop.timeZone, lang)}
        </span>
        <span className="font-inter text-base font-semibold text-ink break-words">{item.customerName}</span>
        <span
          className={`ml-auto inline-flex items-center rounded-full px-2.5 py-0.5 font-inter text-sm font-semibold ${STATUS_STYLE[item.status]}`}
        >
          {copy.agenda.status[item.status]}
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-inter text-base text-text">
        <span>{serviceName(shop, item.serviceId, lang)}</span>
        <span className="text-muted">· {resourceName(shop, item.resourceId, lang)}</span>
        <ChannelLabel channel={item.channel} labels={copy.channel} />
      </p>
      {(last || item.cancelledBy === "caller") && (
        <p className="font-inter text-sm text-muted">
          {last
            ? `${copy.agenda.by[last.action]} ${last.label} · ${whenOf(last.at, shop, lang, copy)}`
            : copy.agenda.cancelledByCaller}
        </p>
      )}
      {item.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {item.actions.map((action) => {
            const Icon = ICON[action];
            return (
              <button
                key={action}
                type="button"
                disabled={busy}
                onClick={() => onAction(item, action)}
                className={ROW_BUTTON}
              >
                <Icon aria-hidden="true" size={16} />
                {copy.agenda.actions[action]}
              </button>
            );
          })}
        </div>
      )}
      {notice && (
        <p role="alert" className="font-inter text-sm font-semibold text-light-text">
          {notice}
        </p>
      )}
    </li>
  );
}

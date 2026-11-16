import { Temporal } from "temporal-polyfill";
import type { AgendaDayDto, AgendaItem } from "@/lib/owner/api";
import type { OwnerBookingAction } from "@/lib/owner/agenda";
import { formatDayHeading } from "@/lib/owner/format";
import type { MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import { AgendaRow } from "./AgendaRow";
import type { MachineCopy } from "./machineCopy";

/** One local day of the Agenda, with its heading even when empty (owner-machine 9.1). */
export function AgendaDay({
  day,
  isToday,
  shop,
  lang,
  copy,
  busyId,
  notice,
  onAction,
}: {
  day: AgendaDayDto;
  isToday: boolean;
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  busyId: string | null;
  notice: { id: string; text: string } | null;
  onAction: (item: AgendaItem, action: OwnerBookingAction) => void;
}) {
  const heading = formatDayHeading(Temporal.PlainDate.from(day.date), lang);
  return (
    <section aria-label={heading} data-day={day.date} className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 font-newsreader text-xl font-medium text-ink">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-dot" aria-hidden="true" />
        {isToday ? `${copy.agenda.today} · ${heading}` : heading}
      </h3>
      {day.items.length === 0 ? (
        <p className="font-inter text-base text-muted">{copy.agenda.nothing(shop.vocabulary[lang].booking)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {day.items.map((item) => (
            <AgendaRow
              key={item.id}
              item={item}
              shop={shop}
              lang={lang}
              copy={copy}
              busy={busyId === item.id}
              notice={notice?.id === item.id ? notice.text : null}
              onAction={onAction}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import type { AgendaDayDto, AgendaItem } from "@/lib/owner/api";
import type { OwnerBookingAction } from "@/lib/owner/agenda";
import type { MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import { AgendaDay } from "./AgendaDay";
import { postBookingAction } from "./bookingApi";
import { CancelDialog } from "./CancelDialog";
import type { MachineCopy } from "./machineCopy";
import { MoveDialog, type DialogOutcome } from "./MoveDialog";

/**
 * The Agenda view (owner-machine 9, 10): today and the next 7 local days, and the one-tap
 * actions. Confirm posts at once; move and cancel open their modal dialogs. Every answer
 * replaces the row with the server's version of it (`onItem`), so the page never guesses.
 */
export function AgendaView({
  days,
  now,
  shop,
  lang,
  copy,
  onItem,
  onLocked,
}: {
  days: readonly AgendaDayDto[];
  now: string;
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  onItem: (item: AgendaItem) => void;
  onLocked: () => void;
}) {
  const [moving, setMoving] = useState<AgendaItem | null>(null);
  const [cancelling, setCancelling] = useState<AgendaItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const today = Temporal.Instant.from(now).toZonedDateTimeISO(shop.timeZone).toPlainDate().toString();

  function outcomeFor(id: string) {
    return (o: DialogOutcome) => {
      if (o.kind === "locked") return onLocked();
      if (o.kind === "not_allowed") return setNotice({ id, text: copy.errors.notAllowed });
      onItem(o.booking);
      setNotice(o.kind === "stale" ? { id, text: copy.errors.stale } : null);
    };
  }

  async function confirm(item: AgendaItem) {
    setBusyId(item.id);
    setNotice(null);
    const a = await postBookingAction(shop.id, item.id, { action: "confirm", revision: item.revision });
    setBusyId(null);
    if (a.ok) return onItem(a.body.booking);
    if (a.status === 401) return onLocked();
    if (a.body?.error === "stale") {
      onItem(a.body.booking);
      return setNotice({ id: item.id, text: copy.errors.stale });
    }
    setNotice({ id: item.id, text: a.body?.error === "not_allowed" ? copy.errors.notAllowed : copy.errors.failed });
  }

  function onAction(item: AgendaItem, action: OwnerBookingAction) {
    setNotice(null);
    if (action === "confirm") void confirm(item);
    else if (action === "move") setMoving(item);
    else setCancelling(item);
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="sr-only">{copy.agenda.label}</h2>
      {days.map((day) => (
        <AgendaDay
          key={day.date}
          day={day}
          isToday={day.date === today}
          shop={shop}
          lang={lang}
          copy={copy}
          busyId={busyId}
          notice={notice}
          onAction={onAction}
        />
      ))}
      {moving && (
        <MoveDialog
          key={`${moving.id}:${moving.revision}`}
          booking={moving}
          shop={shop}
          now={now}
          lang={lang}
          copy={copy}
          onClose={() => setMoving(null)}
          onOutcome={outcomeFor(moving.id)}
        />
      )}
      {cancelling && (
        <CancelDialog
          key={`${cancelling.id}:${cancelling.revision}`}
          booking={cancelling}
          shop={shop}
          lang={lang}
          copy={copy}
          onClose={() => setCancelling(null)}
          onOutcome={outcomeFor(cancelling.id)}
        />
      )}
    </div>
  );
}

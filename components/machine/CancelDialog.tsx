"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import type { AgendaItem } from "@/lib/owner/api";
import { formatClock, formatDayHeading } from "@/lib/owner/format";
import { serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import { postBookingAction } from "./bookingApi";
import { CONTROL_BUTTON } from "./controlButton";
import type { MachineCopy } from "./machineCopy";
import { finish, type DialogOutcome } from "./MoveDialog";
import { openDialog, closeDialog } from "./openDialog";

/**
 * One confirmation before cancelling (owner-machine 10.8, 13.6): "Cancel Ana's haircut on
 * Friday the 13th at 7:30 pm?". The server marks it cancelled by the Owner and records who.
 * Mount it with a `key` per Booking: it opens itself as a modal.
 */
export function CancelDialog({
  booking,
  shop,
  lang,
  copy,
  onClose,
  onOutcome,
}: {
  booking: AgendaItem;
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  onClose: () => void;
  onOutcome: (o: DialogOutcome) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const outcome = useRef(onOutcome);
  const start = Temporal.Instant.from(booking.start);
  const day = formatDayHeading(start.toZonedDateTimeISO(shop.timeZone).toPlainDate(), lang);
  const question = copy.cancel.question(
    booking.customerName,
    serviceName(shop, booking.serviceId, lang),
    day,
    formatClock(start, shop.timeZone, lang),
  );

  useEffect(() => {
    outcome.current = onOutcome;
  }, [onOutcome]);

  useEffect(() => {
    if (ref.current) openDialog(ref.current);
  }, []);

  async function confirmCancel() {
    if (busy) return;
    setBusy(true);
    setError("");
    const a = await postBookingAction(shop.id, booking.id, { action: "cancel", revision: booking.revision });
    setBusy(false);
    if (a.ok) return finish(ref, outcome, { kind: "done", booking: a.body.booking });
    if (a.status === 401) return finish(ref, outcome, { kind: "locked" });
    if (a.body?.error === "stale") return finish(ref, outcome, { kind: "stale", booking: a.body.booking });
    if (a.body?.error === "not_allowed") return finish(ref, outcome, { kind: "not_allowed" });
    setError(copy.errors.failed);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-q`}
      onClose={onClose}
      className="m-auto w-[min(100%-1.5rem,28rem)] rounded-[24px] border border-gold-dot bg-card p-0 text-text shadow-[0_24px_60px_rgb(36_29_20/0.25)] backdrop:bg-espresso/30"
    >
      <div lang={lang} className="flex flex-col gap-4 p-5">
        <h2 id={`${id}-q`} className="font-newsreader text-2xl font-medium text-ink">
          {question}
        </h2>
        <p role="alert" className="min-h-6 font-inter text-base font-semibold text-light-text">
          {error}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => closeDialog(ref.current)} className={CONTROL_BUTTON}>
            {copy.cancel.no}
          </button>
          <button
            type="button"
            onClick={confirmCancel}
            disabled={busy}
            className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full bg-light-text px-5 font-inter text-base font-semibold text-card disabled:opacity-70"
          >
            {busy ? copy.agenda.working : copy.cancel.yes}
          </button>
        </div>
      </div>
    </dialog>
  );
}

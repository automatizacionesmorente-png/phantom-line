"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { CalendarClock } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import type { AgendaItem, SlotDto } from "@/lib/owner/api";
import { formatClock, formatDayHeading } from "@/lib/owner/format";
import { serviceName, type MachineShop } from "@/lib/owner/machineShop";
import { moveDays } from "@/lib/owner/move";
import type { Lang } from "@/lib/sectors";
import { getMoveSlots, postBookingAction } from "./bookingApi";
import { CONTROL_BUTTON, GOLD_GRADIENT, PRIMARY_BUTTON } from "./controlButton";
import { rejectionText, type MachineCopy } from "./machineCopy";
import { closeDialog, openDialog } from "./openDialog";

export type DialogOutcome =
  | { kind: "done"; booking: AgendaItem }
  | { kind: "stale"; booking: AgendaItem }
  | { kind: "not_allowed" }
  | { kind: "locked" };

/** Report the outcome, then close the modal, so focus goes back to the opener before it unmounts. */
export function finish(
  dialog: RefObject<HTMLDialogElement | null>,
  report: RefObject<(o: DialogOutcome) => void>,
  o: DialogOutcome,
): void {
  report.current(o);
  closeDialog(dialog.current);
}

/**
 * Move a Booking (owner-machine 10.3–10.6, 10.9, 13.6): a day within the next 14 days, and
 * only the Move_Slots the server returns for it. The server re-checks the Booking_Rules and
 * the no-overlap constraint on submit; a rejected or taken time shows why and the fresh
 * slots, in place. Mount it with a `key` per Booking: it opens itself as a modal.
 */
export function MoveDialog({
  booking,
  shop,
  now,
  lang,
  copy,
  onClose,
  onOutcome,
}: {
  booking: AgendaItem;
  shop: MachineShop;
  /** The snapshot's server time, so the day list matches the server's 14 days. */
  now: string;
  lang: Lang;
  copy: MachineCopy;
  onClose: () => void;
  onOutcome: (o: DialogOutcome) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const days = moveDays(Temporal.Instant.from(now), shop.timeZone).map((d) => d.toString());
  const bookedDay = Temporal.Instant.from(booking.start).toZonedDateTimeISO(shop.timeZone).toPlainDate().toString();
  const [date, setDate] = useState(days.includes(bookedDay) ? bookedDay : days[0]);
  const [slots, setSlots] = useState<SlotDto[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const outcome = useRef(onOutcome);
  const service = serviceName(shop, booking.serviceId, lang);

  useEffect(() => {
    outcome.current = onOutcome;
  }, [onOutcome]);

  useEffect(() => {
    if (ref.current) openDialog(ref.current);
  }, []);

  useEffect(() => {
    let alive = true;
    void getMoveSlots(shop.id, booking.id, date).then((a) => {
      if (!alive) return;
      if (a.ok) return setSlots(a.body.slots);
      if (a.status === 401) return finish(ref, outcome, { kind: "locked" });
      if (a.body?.error === "not_allowed") return finish(ref, outcome, { kind: "not_allowed" });
      setSlots([]);
      setError(copy.errors.failed);
    });
    return () => {
      alive = false;
    };
  }, [shop.id, booking.id, date, copy]);

  function pickDay(next: string) {
    setDate(next);
    setSlots(null);
    setChoice(null);
    setError("");
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (choice === null || busy) return;
    setBusy(true);
    setError("");
    const a = await postBookingAction(shop.id, booking.id, { action: "move", revision: booking.revision, start: choice });
    setBusy(false);
    if (a.ok) return finish(ref, outcome, { kind: "done", booking: a.body.booking });
    if (a.status === 401) return finish(ref, outcome, { kind: "locked" });
    const body = a.body;
    if (body?.error === "stale") return finish(ref, outcome, { kind: "stale", booking: body.booking });
    if (body?.error === "not_allowed") return finish(ref, outcome, { kind: "not_allowed" });
    if (body?.error === "rejected" || body?.error === "taken") {
      setSlots(body.slots);
      setChoice(null);
      setError(body.error === "taken" ? copy.errors.taken : rejectionText(copy, body.reason));
      return;
    }
    setError(copy.errors.failed);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      className="m-auto w-[min(100%-1.5rem,30rem)] rounded-[24px] border border-gold-dot bg-card p-0 text-text shadow-[0_24px_60px_rgb(36_29_20/0.25)] backdrop:bg-espresso/30"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 p-5" lang={lang}>
        <h2 id={`${id}-title`} className="flex items-center gap-2 font-newsreader text-2xl font-medium text-ink">
          <CalendarClock aria-hidden="true" size={22} className="text-gold-text" />
          {copy.move.title(booking.customerName, service)}
        </h2>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-day`} className="font-inter text-base font-semibold text-ink">
            {copy.move.day}
          </label>
          <select
            id={`${id}-day`}
            value={date}
            onChange={(e) => pickDay(e.target.value)}
            className="focus-ring min-h-11 rounded-2xl border border-border bg-card px-3 font-inter text-base text-text"
          >
            {days.map((d, k) => (
              <option key={d} value={d}>
                {k === 0 ? `${copy.agenda.today} · ` : ""}
                {formatDayHeading(Temporal.PlainDate.from(d), lang)}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 font-inter text-base font-semibold text-ink">{copy.move.times}</legend>
          {slots === null ? (
            <p className="font-inter text-base text-muted">{copy.move.loading}</p>
          ) : slots.length === 0 ? (
            <p className="font-inter text-base text-muted">{copy.move.noSlots}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => (
                <label
                  key={s.start}
                  className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full border font-inter text-base font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-gold ${
                    choice === s.start ? "border-ink bg-espresso text-card" : "border-border bg-section text-ink"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${id}-slot`}
                    value={s.start}
                    checked={choice === s.start}
                    onChange={() => setChoice(s.start)}
                    className="focus-ring sr-only"
                  />
                  {formatClock(Temporal.Instant.from(s.start), shop.timeZone, lang)}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <p role="alert" className="min-h-6 font-inter text-base font-semibold text-light-text">
          {error}
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => closeDialog(ref.current)} className={CONTROL_BUTTON}>
            {copy.move.close}
          </button>
          <button type="submit" disabled={choice === null || busy} className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
            {busy ? copy.agenda.working : copy.move.submit}
          </button>
        </div>
      </form>
    </dialog>
  );
}

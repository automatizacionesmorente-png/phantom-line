"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarClock, Check, UserRound, Wallet, X, UserX } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import type { AgendaItem } from "@/lib/owner/api";
import type { OwnerBookingAction } from "@/lib/owner/agenda";
import { formatClock, formatDayHeading } from "@/lib/owner/format";
import { resourceName, serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import { CONTROL_BUTTON, ROW_BUTTON } from "../controlButton";
import { openDialog, closeDialog } from "../openDialog";
import { formatRevenue } from "../weekCopy";
import type { MachineCopy } from "../machineCopy";
import { getVisitNote, postVisitNote } from "./todayApi";
import type { TodayCopy } from "./todayCopy";

/** What the clients book knows about the client of a booking. */
export interface BookingClient {
  clientId: string;
  note: string;
  /** "No vino" can be set (or undone) on this finished booking. */
  canMarkNoShow: boolean;
  noShow: boolean;
}

const ICON = { confirm: Check, move: CalendarClock, cancel: X } as const;

/**
 * The sheet of one appointment (salon spec 2.1): what it is, the client's note, and the actions:
 * confirm, move, cancel, no-show, Cobrar (when the pay dialog is wired), the visit note and the
 * client's card. Mount it with a `key` per booking: it opens itself as a modal.
 */
export function BookingSheet({
  item,
  shop,
  lang,
  copy,
  today,
  client,
  busy,
  notice,
  onClose,
  onAction,
  onNoShow,
  onPay,
  onOpenClient,
  onLocked,
}: {
  item: AgendaItem;
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  today: TodayCopy;
  client: BookingClient | undefined;
  busy: boolean;
  notice: string | null;
  onClose: () => void;
  onAction: (item: AgendaItem, action: OwnerBookingAction) => void;
  onNoShow: (item: AgendaItem, client: BookingClient, noShow: boolean) => void;
  onPay?: (item: AgendaItem) => void;
  onOpenClient?: (clientId: string) => void;
  onLocked: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const s = today.sheet;
  const [note, setNote] = useState("");
  const [noteLoaded, setNoteLoaded] = useState(!item.hasVisitNote);
  const [noteMsg, setNoteMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (ref.current) openDialog(ref.current);
  }, []);

  useEffect(() => {
    if (!item.hasVisitNote) return;
    let live = true;
    void getVisitNote(shop.id, item.id).then((a) => {
      if (!live) return;
      if (a.ok) setNote(a.body.note);
      else if (a.status === 401) onLocked();
      setNoteLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [shop.id, item.id, item.hasVisitNote, onLocked]);

  async function saveNote() {
    setSaving(true);
    setNoteMsg(null);
    const a = await postVisitNote(shop.id, item.id, note);
    setSaving(false);
    if (a.ok) return setNoteMsg({ text: s.noteSaved, bad: false });
    if (a.status === 401) return onLocked();
    setNoteMsg({ text: s.failed, bad: true });
  }

  const start = Temporal.Instant.from(item.start);
  const zoned = start.toZonedDateTimeISO(shop.timeZone);
  const cancelled = item.status === "cancelled";
  const canPay = onPay !== undefined && !cancelled && item.paidCents === null && item.state !== "no_show";

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      onClose={onClose}
      className="m-auto w-[min(100%-1.5rem,30rem)] rounded-[24px] border border-gold-dot bg-card p-0 text-text shadow-[0_24px_60px_rgb(36_29_20/0.25)] backdrop:bg-espresso/30"
    >
      <div lang={lang} className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto p-5">
        <div className="flex flex-col gap-1">
          <h2 id={`${id}-t`} className="font-newsreader text-2xl font-medium text-ink break-words">
            {item.customerName}
          </h2>
          <p className="font-inter text-base text-text">
            {serviceName(shop, item.serviceId, lang)} · {resourceName(shop, item.resourceId, lang)}
          </p>
          <p className="font-inter text-base text-muted">
            {formatDayHeading(zoned.toPlainDate(), lang)} · {formatClock(start, shop.timeZone, lang)}-
            {formatClock(Temporal.Instant.from(item.end), shop.timeZone, lang)}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 font-inter text-base">
            <span className="font-semibold text-ink">{s.state[item.state]}</span>
            {item.priceCents !== null && (
              <span className="text-muted">
                {s.price}: {formatRevenue(item.paidCents ?? item.priceCents, lang)}
              </span>
            )}
          </p>
        </div>

        {client && client.note.trim() !== "" && (
          <p className="rounded-xl border border-light-text/40 bg-section p-3 font-inter text-base text-ink">
            <span className="font-semibold">{s.clientNote}: </span>
            {client.note}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {item.actions.map((action) => {
            const Icon = ICON[action];
            return (
              <button key={action} type="button" disabled={busy} onClick={() => onAction(item, action)} className={ROW_BUTTON}>
                <Icon aria-hidden="true" size={16} />
                {copy.agenda.actions[action]}
              </button>
            );
          })}
          {client && !cancelled && (client.noShow || client.canMarkNoShow) && (
            <button type="button" disabled={busy} onClick={() => onNoShow(item, client, !client.noShow)} className={ROW_BUTTON}>
              <UserX aria-hidden="true" size={16} />
              {client.noShow ? s.undoNoShow : s.noShow}
            </button>
          )}
          {canPay && (
            <button type="button" disabled={busy} onClick={() => onPay(item)} className={ROW_BUTTON}>
              <Wallet aria-hidden="true" size={16} />
              {s.pay}
            </button>
          )}
          {client && onOpenClient && (
            <button type="button" onClick={() => onOpenClient(client.clientId)} className={ROW_BUTTON}>
              <UserRound aria-hidden="true" size={16} />
              {s.openClient}
            </button>
          )}
        </div>

        {notice && (
          <p role="alert" className="font-inter text-sm font-semibold text-light-text">
            {notice}
          </p>
        )}

        {!cancelled && (
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-n`} className="font-inter text-sm font-semibold text-ink">
              {s.visitNote}
            </label>
            <textarea
              id={`${id}-n`}
              value={note}
              maxLength={500}
              rows={3}
              disabled={!noteLoaded}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteMsg(null);
              }}
              className="focus-ring w-full rounded-xl border border-border bg-bg p-3 font-inter text-base text-ink"
            />
            <div className="flex items-center gap-3">
              <button type="button" disabled={saving || !noteLoaded} onClick={() => void saveNote()} className={ROW_BUTTON}>
                {s.saveNote}
              </button>
              {noteMsg && (
                <p role={noteMsg.bad ? "alert" : "status"} className={`font-inter text-sm font-semibold ${noteMsg.bad ? "text-light-text" : "text-muted"}`}>
                  {noteMsg.text}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={() => closeDialog(ref.current)} className={CONTROL_BUTTON}>
            {s.close}
          </button>
        </div>
      </div>
    </dialog>
  );
}

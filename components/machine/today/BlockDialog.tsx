"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Ban } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import type { AgendaItem, MachineErrorBody } from "@/lib/owner/api";
import { formatClock, formatDayHeading } from "@/lib/owner/format";
import { resourceName, serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { CreateBlockResponse } from "@/lib/salon/api";
import type { Lang } from "@/lib/sectors";
import { CONTROL_BUTTON, GOLD_GRADIENT, PRIMARY_BUTTON } from "../controlButton";
import { closeDialog, openDialog } from "../openDialog";
import { postBlock } from "../salonApi";
import type { AddCopy } from "./addCopy";
import { localInstant, localParts, nextSlot } from "./addHelpers";

type Chip = "rest" | "doctor" | "holidays" | "other";
const CHIPS: Chip[] = ["rest", "doctor", "holidays", "other"];

function refusal(copy: AddCopy, status: number, body: MachineErrorBody | null): string {
  const e = copy.block.errors;
  if (status === 409 && body?.error === "limit_reached") return e.limit_reached;
  if (body?.error === "invalid_request") {
    const paths = body.issues.map((i) => i.path.join("."));
    if (paths.includes("start")) return e.too_far;
    if (paths.includes("end")) return e.too_long;
    return e.invalid_request;
  }
  return copy.common.failed;
}

/**
 * Block time for one worker or the whole shop (salon spec 2.1, 9.4): from and to with whole-day
 * quick picks, and reason chips. The block stands even over bookings, so when the server returns
 * the ones under it (at most 50, with a `truncated` flag) the dialog stays open to warn about them.
 */
export function BlockDialog({
  shop,
  lang,
  copy,
  bookingWord,
  now,
  onClose,
  onChanged,
  onLocked,
}: {
  shop: MachineShop;
  lang: Lang;
  copy: AddCopy;
  bookingWord: string;
  now: string;
  onClose: () => void;
  onChanged: () => void;
  onLocked: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const t = copy.block;
  const from0 = nextSlot(now, shop.timeZone, shop.slotStepMin);
  const to0 = localParts(Temporal.Instant.from(now).add({ hours: 2 }).toString(), shop.timeZone);
  const [who, setWho] = useState<string>("");
  const [fromDate, setFromDate] = useState(from0.date);
  const [fromTime, setFromTime] = useState(from0.time);
  const [toDate, setToDate] = useState(to0.date);
  const [toTime, setToTime] = useState(to0.time);
  const [chip, setChip] = useState<Chip | null>(null);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreateBlockResponse | null>(null);
  const locked = useRef(onLocked);

  useEffect(() => {
    locked.current = onLocked;
  }, [onLocked]);

  useEffect(() => {
    if (ref.current) openDialog(ref.current);
  }, []);

  /** Midnight to midnight of the shop's today (+ `plusDays`). */
  function wholeDay(plusDays: number) {
    const day = Temporal.Instant.from(now).toZonedDateTimeISO(shop.timeZone).toPlainDate().add({ days: plusDays });
    setFromDate(day.toString());
    setFromTime("00:00");
    setToDate(day.add({ days: 1 }).toString());
    setToTime("00:00");
    setError("");
  }

  const reason = chip === null ? "" : chip === "other" ? custom.trim() : t.reasons[chip];

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const start = localInstant(fromDate, fromTime, shop.timeZone);
    const end = localInstant(toDate, toTime, shop.timeZone);
    if (start === null || end === null || Temporal.Instant.compare(end, start) <= 0) return setError(t.errors.bad_range);
    setBusy(true);
    setError("");
    const a = await postBlock(shop.id, { resourceId: who === "" ? null : who, start: start.toString(), end: end.toString(), reason });
    setBusy(false);
    if (a.ok) {
      onChanged();
      if (a.body.overlapping.length === 0) {
        onClose();
        return closeDialog(ref.current);
      }
      return setResult(a.body);
    }
    if (a.status === 401) return locked.current();
    setError(refusal(copy, a.status, a.body));
  }

  const field = "focus-ring min-h-11 rounded-2xl border border-border bg-card px-3 font-inter text-base text-text";
  const label = "font-inter text-base font-semibold text-ink";
  const title = (
    <h2 id={`${id}-title`} className="flex items-center gap-2 font-newsreader text-2xl font-medium text-ink">
      <Ban aria-hidden="true" size={22} className="text-gold-text" />
      {t.title}
    </h2>
  );
  const shell = "m-auto w-[min(100%-1.5rem,30rem)] rounded-[24px] border border-gold-dot bg-card p-0 text-text shadow-[0_24px_60px_rgb(36_29_20/0.25)] backdrop:bg-espresso/30";

  if (result !== null) {
    const n = result.overlapping.length;
    const line = (b: AgendaItem) => {
      const s = Temporal.Instant.from(b.start);
      const day = formatDayHeading(s.toZonedDateTimeISO(shop.timeZone).toPlainDate(), lang);
      return `${day} ${formatClock(s, shop.timeZone, lang)} · ${b.customerName} · ${serviceName(shop, b.serviceId, lang)} · ${resourceName(shop, b.resourceId, lang)}`;
    };
    return (
      <dialog ref={ref} aria-labelledby={`${id}-title`} onClose={onClose} className={shell}>
        <div className="flex flex-col gap-4 p-5" lang={lang}>
          {title}
          <p className="font-inter text-base text-muted">{t.done}</p>
          <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-light-text bg-section p-3.5">
            <p className="font-inter text-base font-semibold text-light-text">{t.overlapTitle(n, bookingWord, result.truncated)}</p>
            <ul className="flex flex-col gap-1 font-inter text-base text-ink">
              {result.overlapping.map((b) => (
                <li key={b.id}>{line(b)}</li>
              ))}
            </ul>
            {result.truncated && <p className="font-inter text-sm text-muted">{t.overlapMore}</p>}
            <p className="font-inter text-sm text-muted">{t.overlapHint}</p>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => closeDialog(ref.current)} className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
              {t.ok}
            </button>
          </div>
        </div>
      </dialog>
    );
  }

  return (
    <dialog ref={ref} aria-labelledby={`${id}-title`} onClose={onClose} className={shell}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-5" lang={lang}>
        {title}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-who`} className={label}>
            {t.who}
          </label>
          <select id={`${id}-who`} value={who} onChange={(e) => setWho(e.target.value)} className={field}>
            <option value="">{t.wholeShop}</option>
            {shop.resources.map((r) => (
              <option key={r.id} value={r.id}>
                {resourceName(shop, r.id, lang)}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={`${label} mb-1.5`}>{t.quick}</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => wholeDay(0)} className={CONTROL_BUTTON}>
              {t.wholeToday}
            </button>
            <button type="button" onClick={() => wholeDay(1)} className={CONTROL_BUTTON}>
              {t.wholeTomorrow}
            </button>
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-fd`} className={label}>
              {t.from}
            </label>
            <input id={`${id}-fd`} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={field} />
            <input aria-label={`${t.from} · ${copy.common.time}`} type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-td`} className={label}>
              {t.to}
            </label>
            <input id={`${id}-td`} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={field} />
            <input aria-label={`${t.to} · ${copy.common.time}`} type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} className={field} />
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={`${label} mb-1.5`}>{t.reason}</legend>
          <div className="flex flex-wrap gap-2">
            {CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={chip === c}
                onClick={() => setChip(chip === c ? null : c)}
                className={`${CONTROL_BUTTON} normal-case ${chip === c ? "!bg-espresso !text-card" : ""}`}
              >
                {t.reasons[c]}
              </button>
            ))}
          </div>
          {chip === "other" && (
            <input
              type="text"
              aria-label={t.other}
              placeholder={t.other}
              maxLength={80}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className={field}
            />
          )}
        </fieldset>

        <p role="alert" className="min-h-6 font-inter text-base font-semibold text-light-text">
          {error}
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => closeDialog(ref.current)} className={CONTROL_BUTTON}>
            {copy.common.close}
          </button>
          <button type="submit" disabled={busy} className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
            {busy ? t.working : t.submit}
          </button>
        </div>
      </form>
    </dialog>
  );
}

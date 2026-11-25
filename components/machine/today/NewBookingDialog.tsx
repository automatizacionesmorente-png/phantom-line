"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarPlus } from "lucide-react";
import type { ClientDto } from "@/lib/clients/api";
import { formatClock, formatDayHeading } from "@/lib/owner/format";
import { resourceName, serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import type { MachineErrorBody } from "@/lib/owner/api";
import { getClients } from "../clientApi";
import { CONTROL_BUTTON, GOLD_GRADIENT, PRIMARY_BUTTON } from "../controlButton";
import { closeDialog, openDialog } from "../openDialog";
import { formatRevenue } from "../weekCopy";
import { postManualBooking } from "../salonApi";
import type { AddCopy } from "./addCopy";
import { localInstant, localParts, nextSlot } from "./addHelpers";

const SUGGESTIONS = 5;
const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** What the dialog says for a refused manual booking, and whether the time step is the one to fix. */
function refusal(copy: AddCopy, body: MachineErrorBody | null): { text: string; step: 1 | 3 } {
  const e = copy.booking.errors;
  switch (body?.error) {
    case "taken":
      return { text: e.taken, step: 1 };
    case "in_the_past":
      return { text: e.in_the_past, step: 1 };
    case "too_far":
      return { text: e.too_far, step: 1 };
    case "closed":
      return { text: e.closed, step: 1 };
    case "outside_hours":
      return { text: e.outside_hours, step: 1 };
    case "blocked":
      return { text: e.blocked, step: 1 };
    case "invalid_request":
      return { text: e.invalid_request, step: 3 };
    default:
      return { text: copy.common.failed, step: 3 };
  }
}

/**
 * A manual booking in three steps (salon spec 2.1): time and worker (pre-filled from the gap
 * tapped), service (big buttons with the price), client (search the book or type a name and an
 * optional phone). The server decides every rule; a 409 says the slot was just taken and
 * reloads the agenda. Mount it with a `key`: it opens itself as a modal.
 */
export function NewBookingDialog({
  shop,
  lang,
  copy,
  bookingWord,
  now,
  initial,
  onClose,
  onChanged,
  onLocked,
}: {
  shop: MachineShop;
  lang: Lang;
  copy: AddCopy;
  bookingWord: string;
  now: string;
  /** The gap that was tapped, or nothing (the + button): the next free step of the clock. */
  initial: { resourceId: string; start: string } | null;
  onClose: () => void;
  /** The booking was written, or the slot was found taken: reload the agenda. */
  onChanged: () => void;
  onLocked: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const t = copy.booking;
  const start = initial ? localParts(initial.start, shop.timeZone) : nextSlot(now, shop.timeZone, shop.slotStepMin);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [resourceId, setResourceId] = useState(initial?.resourceId ?? shop.resources[0]?.id ?? "");
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(onLocked);

  useEffect(() => {
    locked.current = onLocked;
  }, [onLocked]);

  useEffect(() => {
    if (ref.current) openDialog(ref.current);
  }, []);

  // The client book, read once when the third step opens, for the search.
  const wantClients = step === 3;
  useEffect(() => {
    if (!wantClients) return;
    let live = true;
    void getClients(shop.id).then((a) => {
      if (!live) return;
      if (a.ok) setClients(a.body.clients);
      else if (a.status === 401) locked.current();
    });
    return () => {
      live = false;
    };
  }, [wantClients, shop.id]);

  const startAt = localInstant(date, time, shop.timeZone);
  const matches = useMemo(() => {
    const q = norm(name.trim());
    if (q === "") return [];
    return clients.filter((c) => norm(c.name).includes(q) || c.phone.replace(/\s/g, "").includes(q.replace(/\s/g, ""))).slice(0, SUGGESTIONS);
  }, [clients, name]);
  const showMatches = matches.length > 0 && !matches.some((c) => c.name === name);

  function toStep2() {
    if (startAt === null) return setError(t.errors.bad_time);
    setError("");
    setStep(2);
  }

  function pickService(sid: string) {
    setServiceId(sid);
    setStep(3);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || startAt === null || serviceId === null || name.trim() === "") return;
    setBusy(true);
    setError("");
    const a = await postManualBooking(shop.id, {
      resourceId,
      serviceId,
      start: startAt.toString(),
      name: name.trim(),
      ...(phone.trim() !== "" ? { phone: phone.trim() } : {}),
    });
    setBusy(false);
    if (a.ok) {
      onChanged();
      onClose();
      return closeDialog(ref.current);
    }
    if (a.status === 401) return locked.current();
    const r = refusal(copy, a.body);
    setError(r.text);
    setStep(r.step);
    if (a.body?.error === "taken") onChanged();
  }

  const stepName = t.steps[step - 1];
  const when = startAt ? `${formatDayHeading(startAt.toZonedDateTimeISO(shop.timeZone).toPlainDate(), lang)} ${formatClock(startAt, shop.timeZone, lang)}` : "";
  const field = "focus-ring min-h-11 rounded-2xl border border-border bg-card px-3 font-inter text-base text-text";
  const label = "font-inter text-base font-semibold text-ink";

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      className="m-auto w-[min(100%-1.5rem,30rem)] rounded-[24px] border border-gold-dot bg-card p-0 text-text shadow-[0_24px_60px_rgb(36_29_20/0.25)] backdrop:bg-espresso/30"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 p-5" lang={lang}>
        <h2 id={`${id}-title`} className="flex items-center gap-2 font-newsreader text-2xl font-medium text-ink">
          <CalendarPlus aria-hidden="true" size={22} className="text-gold-text" />
          {t.title(bookingWord)}
        </h2>
        <p className="font-inter text-sm font-semibold uppercase tracking-[0.08em] text-muted">{copy.booking.step(step, 3, stepName)}</p>

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-worker`} className={label}>
                {copy.common.worker}
              </label>
              <select id={`${id}-worker`} value={resourceId} onChange={(e) => setResourceId(e.target.value)} className={field}>
                {shop.resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {resourceName(shop, r.id, lang)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-date`} className={label}>
                  {copy.common.day}
                </label>
                <input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-time`} className={label}>
                  {copy.common.time}
                </label>
                <input
                  id={`${id}-time`}
                  type="time"
                  step={shop.slotStepMin * 60}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={field}
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <fieldset className="flex flex-col gap-2">
            <legend className={`${label} mb-1.5`}>{t.service}</legend>
            {shop.services.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={serviceId === s.id}
                onClick={() => pickService(s.id)}
                className="focus-ring flex min-h-14 items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-card px-4 text-left font-inter text-base font-semibold text-ink hover:bg-section"
              >
                <span>{serviceName(shop, s.id, lang)}</span>
                {s.priceCents !== undefined && <span className="text-gold-text">{formatRevenue(s.priceCents, lang)}</span>}
              </button>
            ))}
          </fieldset>
        )}

        {step === 3 && serviceId !== null && (
          <div className="flex flex-col gap-3">
            <p className="font-inter text-base text-muted">{t.summary(when, resourceName(shop, resourceId, lang), serviceName(shop, serviceId, lang))}</p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-name`} className={label}>
                {t.client}
              </label>
              <input
                id={`${id}-name`}
                type="text"
                value={name}
                maxLength={60}
                autoComplete="off"
                placeholder={t.clientHint}
                onChange={(e) => setName(e.target.value)}
                className={field}
              />
              {showMatches && (
                <ul className="flex flex-col gap-1.5">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setName(c.name);
                          setPhone(c.phone);
                        }}
                        className="focus-ring flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-border bg-section px-3 text-left font-inter text-base text-ink hover:bg-card"
                      >
                        <span className="font-semibold">{c.name}</span>
                        <span className="text-muted">{c.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-phone`} className={label}>
                {t.phone}
              </label>
              <input
                id={`${id}-phone`}
                type="tel"
                inputMode="tel"
                value={phone}
                maxLength={20}
                autoComplete="off"
                onChange={(e) => setPhone(e.target.value)}
                aria-describedby={`${id}-phone-hint`}
                className={field}
              />
              <p id={`${id}-phone-hint`} className="font-inter text-sm text-muted">
                {t.phoneHint}
              </p>
            </div>
          </div>
        )}

        <p role="alert" className="min-h-6 font-inter text-base font-semibold text-light-text">
          {error}
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          {step === 1 ? (
            <button type="button" onClick={() => closeDialog(ref.current)} className={CONTROL_BUTTON}>
              {copy.common.close}
            </button>
          ) : (
            <button type="button" onClick={() => { setError(""); setStep((step - 1) as 1 | 2); }} className={CONTROL_BUTTON}>
              {copy.common.back}
            </button>
          )}
          {step === 1 && (
            <button type="button" onClick={toStep2} className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
              {copy.common.next}
            </button>
          )}
          {step === 3 && (
            <button type="submit" disabled={busy || name.trim() === ""} className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
              {busy ? t.working : t.submit}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

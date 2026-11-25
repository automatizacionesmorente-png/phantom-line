"use client";

import { useEffect, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { NOTE_MAX, type ClientDto, type ClientsResponse } from "@/lib/clients/api";
import { formatClock } from "@/lib/owner/format";
import { serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import { postClientAction } from "./clientApi";
import { ROW_BUTTON } from "./controlButton";
import { formatRevenue } from "./weekCopy";
import type { MachineCopy } from "./machineCopy";

export const dayOf = (iso: string, timeZone: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(Temporal.Instant.from(iso).epochMilliseconds));

/**
 * One Client of the customer book: the summary line, and on request the usual services, the
 * visit history with "No vino", and the Owner's private note. Every answer from the server
 * replaces the whole book (`onBook`), so the page never guesses what changed.
 */
export function ClientCard({
  client,
  shop,
  lang,
  copy,
  onBook,
  onLocked,
  autoOpen = false,
  onOpened,
}: {
  client: ClientDto;
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  onBook: (book: ClientsResponse) => void;
  onLocked: () => void;
  /** Open the card on its own (the booking's "Ver ficha"); `onOpened` fires once it is open. */
  autoOpen?: boolean;
  onOpened?: () => void;
}) {
  const c = copy.clients;
  const [open, setOpen] = useState(false);
  const [latched, setLatched] = useState(false);
  if (autoOpen && !latched) {
    setLatched(true);
    setOpen(true);
  }
  const root = useRef<HTMLLIElement>(null);
  const [day, setDay] = useState(client.birthday ? String(Number(client.birthday.slice(3))) : "");
  const [month, setMonth] = useState(client.birthday ? String(Number(client.birthday.slice(0, 2))) : "");
  const [fields, setFields] = useState<Record<string, string>>(client.fields);
  const defs = shop.clientFields ?? [];
  const noteLabel = shop.visitNoteLabel?.[lang];
  useEffect(() => {
    if (!autoOpen) return;
    root.current?.scrollIntoView?.({ block: "start" });
    onOpened?.();
  }, [autoOpen, onOpened]);
  const [note, setNote] = useState(client.note);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const panelId = `client-${client.id}`;

  async function run(key: string, req: Parameters<typeof postClientAction>[2], okText: string | null) {
    setBusy(key);
    setMessage(null);
    const a = await postClientAction(shop.id, client.id, req);
    setBusy(null);
    if (a.ok) {
      onBook(a.body);
      setMessage(okText);
      return;
    }
    if (a.status === 401) return onLocked();
    setMessage(a.body?.error === "not_allowed" ? copy.errors.notAllowed : c.failed);
  }

  const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function saveBirthday(d: string, m: string) {
    setDay(d);
    setMonth(m);
    if (d === "" && m === "") return void run("birthday", { action: "birthday", birthday: null }, c.savedField);
    if (d === "" || m === "" || Number(d) > DAYS[Number(m) - 1]) return;
    const mm = m.padStart(2, "0");
    void run("birthday", { action: "birthday", birthday: `${mm}-${d.padStart(2, "0")}` }, c.savedField);
  }

  return (
    <li ref={root} data-client={client.id} className="flex flex-col gap-2 rounded-[18px] border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-newsreader text-xl font-medium text-ink break-words">{client.name}</h3>
        <span className="font-inter text-sm text-muted">{client.phone}</span>
      </div>
      {client.note !== "" && (
        <p
          data-important
          className="rounded-[12px] border border-gold bg-section px-3 py-2 font-inter text-base font-semibold text-ink break-words"
        >
          <span className="sr-only">{c.note}: </span>
          {client.note}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-inter text-base text-text">
        <span>{c.visits(client.totalVisits)}</span>
        <span>{client.lastVisit ? c.lastVisit(dayOf(client.lastVisit, shop.timeZone, lang)) : c.noVisitsYet}</span>
        <span>{c.spent(formatRevenue(client.spentCents, lang))}</span>
        {client.noShows > 0 && <span className="font-semibold text-gold-text">{c.noShows(client.noShows)}</span>}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`${ROW_BUTTON} self-start`}
      >
        {open ? c.close : c.open}
        <span className="sr-only"> {client.name}</span>
      </button>

      {open && (
        <div id={panelId} className="flex flex-col gap-3 border-t border-dashed border-border pt-3">
          {client.usualServices.length > 0 && (
            <p className="font-inter text-base text-text">
              <span className="font-semibold text-ink">{c.usual}: </span>
              {client.usualServices.map((u) => `${serviceName(shop, u.serviceId, lang)} (${u.count})`).join(", ")}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <span className="font-inter text-base font-semibold text-ink">{c.birthday}</span>
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2 font-inter text-sm text-muted">
                {c.birthdayDay}
                <select
                  value={day}
                  disabled={busy !== null}
                  onChange={(e) => saveBirthday(e.target.value, month)}
                  className="focus-ring min-h-11 rounded-[14px] border border-border bg-section px-2 font-inter text-base text-ink"
                >
                  <option value="">{c.birthdayNone}</option>
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 font-inter text-sm text-muted">
                {c.birthdayMonth}
                <select
                  value={month}
                  disabled={busy !== null}
                  onChange={(e) => saveBirthday(day, e.target.value)}
                  className="focus-ring min-h-11 rounded-[14px] border border-border bg-section px-2 font-inter text-base text-ink"
                >
                  <option value="">{c.birthdayNone}</option>
                  {c.months.map((m, i) => (
                    <option key={m} value={String(i + 1)}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              role="switch"
              aria-checked={client.promoConsentAt !== null}
              aria-describedby={`${panelId}-consent`}
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "consent",
                  {
                    action: "consent",
                    consent: client.promoConsentAt === null,
                  },
                  null,
                )
              }
              className={`${ROW_BUTTON} self-start ${client.promoConsentAt !== null ? "bg-section" : ""}`}
            >
              {c.consent}
            </button>
            <p id={`${panelId}-consent`} className="font-inter text-sm text-muted">
              {client.promoConsentAt ? c.consentSince(dayOf(client.promoConsentAt, shop.timeZone, lang)) : c.consentOff}.{" "}
              {c.consentHint}
            </p>
          </div>

          {defs.length > 0 && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const out: Record<string, string> = {};
                for (const d of defs) out[d.id] = fields[d.id] ?? "";
                void run("fields", { action: "fields", fields: out }, c.savedField);
              }}
            >
              <h4 className="font-inter text-xs uppercase tracking-[0.18em] text-muted">{c.extra}</h4>
              {defs.map((d) => (
                <div key={d.id} className="flex flex-col gap-1">
                  <label htmlFor={`${panelId}-f-${d.id}`} className="font-inter text-base font-semibold text-ink">
                    {d.label[lang]}
                  </label>
                  <input
                    id={`${panelId}-f-${d.id}`}
                    value={fields[d.id] ?? ""}
                    maxLength={d.maxLength}
                    onChange={(e) => setFields({ ...fields, [d.id]: e.target.value })}
                    className="focus-ring min-h-11 w-full rounded-[14px] border border-border bg-section px-3 font-inter text-base text-ink"
                  />
                </div>
              ))}
              <button type="submit" disabled={busy !== null} className={`${ROW_BUTTON} self-start`}>
                {busy === "fields" ? c.saving : c.saveFields}
              </button>
            </form>
          )}

          <div>
            <h4 className="font-inter text-xs uppercase tracking-[0.18em] text-muted">{c.history}</h4>
            {client.history.length === 0 ? (
              <p className="font-inter text-base text-text">{c.noHistory}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {client.history.map((h) => (
                  <li
                    key={h.bookingId}
                    data-history={h.bookingId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 font-inter text-base text-text"
                  >
                    <span>
                      {dayOf(h.start, shop.timeZone, lang)}, {formatClock(Temporal.Instant.from(h.start), shop.timeZone, lang)}
                    </span>
                    <span>{serviceName(shop, h.serviceId, lang)}</span>
                    <span className="font-semibold text-ink">{c.state[h.state]}</span>
                    <span>{h.paidCents === null ? c.unpaid : c.paid(formatRevenue(h.paidCents, lang))}</span>
                    {noteLabel && h.visitNote !== "" && (
                      <span className="basis-full text-muted break-words">
                        {noteLabel}: {h.visitNote}
                      </span>
                    )}
                    {h.canMarkNoShow && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            h.bookingId,
                            {
                              action: "no_show",
                              bookingId: h.bookingId,
                              noShow: h.state !== "no_show",
                            },
                            null,
                          )
                        }
                        className={ROW_BUTTON}
                      >
                        {h.state === "no_show" ? c.undoNoShow : c.markNoShow}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run("note", { action: "note", note }, c.saved);
            }}
          >
            <label htmlFor={`${panelId}-note`} className="font-inter text-base font-semibold text-ink">
              {c.note}
            </label>
            <textarea
              id={`${panelId}-note`}
              value={note}
              maxLength={NOTE_MAX}
              rows={3}
              placeholder={c.notePlaceholder}
              onChange={(e) => setNote(e.target.value)}
              className="focus-ring w-full rounded-[14px] border border-border bg-section p-3 font-inter text-base text-ink"
            />
            <p className="font-inter text-sm text-muted">{c.noteHint(NOTE_MAX - note.length)}</p>
            <button type="submit" disabled={busy !== null || note === client.note} className={`${ROW_BUTTON} self-start`}>
              {busy === "note" ? c.saving : c.save}
            </button>
          </form>
          {message && (
            <p role="status" className="font-inter text-sm font-semibold text-text">
              {message}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

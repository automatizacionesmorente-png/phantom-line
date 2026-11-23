"use client";

import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import { NOTE_MAX, type ClientDto, type ClientsResponse } from "@/lib/clients/api";
import { formatClock } from "@/lib/owner/format";
import { serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import { postClientAction } from "./clientApi";
import { ROW_BUTTON } from "./controlButton";
import type { MachineCopy } from "./machineCopy";

export const dayOf = (iso: string, timeZone: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric", timeZone }).format(
    new Date(Temporal.Instant.from(iso).epochMilliseconds),
  );

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
}: {
  client: ClientDto;
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  onBook: (book: ClientsResponse) => void;
  onLocked: () => void;
}) {
  const c = copy.clients;
  const [open, setOpen] = useState(false);
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

  return (
    <li data-client={client.id} className="flex flex-col gap-2 rounded-[18px] border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-newsreader text-xl font-medium text-ink break-words">{client.name}</h3>
        <span className="font-inter text-sm text-muted">{client.phone}</span>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-inter text-base text-text">
        <span>{c.visits(client.totalVisits)}</span>
        <span>{client.lastVisit ? c.lastVisit(dayOf(client.lastVisit, shop.timeZone, lang)) : c.noVisitsYet}</span>
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

          <div>
            <h4 className="font-inter text-xs uppercase tracking-[0.18em] text-muted">{c.history}</h4>
            {client.history.length === 0 ? (
              <p className="font-inter text-base text-text">{c.noHistory}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {client.history.map((h) => (
                  <li key={h.bookingId} data-history={h.bookingId} className="flex flex-wrap items-center gap-x-3 gap-y-1 font-inter text-base text-text">
                    <span>
                      {dayOf(h.start, shop.timeZone, lang)}, {formatClock(Temporal.Instant.from(h.start), shop.timeZone, lang)}
                    </span>
                    <span>{serviceName(shop, h.serviceId, lang)}</span>
                    <span className="font-semibold text-ink">{c.state[h.state]}</span>
                    {h.canMarkNoShow && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(h.bookingId, { action: "no_show", bookingId: h.bookingId, noShow: h.state !== "no_show" }, null)
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

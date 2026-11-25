"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import type { OutboxItemDto, SettingsResponse } from "@/lib/salon/api";
import type { MachineShop } from "@/lib/owner/machineShop";
import { isReviewUrl, type OutboxKind } from "@/lib/salon/settings";
import type { Lang } from "@/lib/sectors";
import { GOLD_GRADIENT, PRIMARY_BUTTON } from "../controlButton";
import { getOutbox, getSettings, postOutboxAction, postSettings } from "../salonApi";
import { AutomationSwitches } from "./AutomationSwitches";
import { OutboxList } from "./OutboxList";
import { SETTINGS_COPY } from "./settingsCopy";

const RETRY_MS = 20_000;

/**
 * Settings (salon spec 2.4, 9.7, 9.8): the five switches (saved on each tap), the Google review link
 * and the VAT rate (saved with one button), and the outbox of prepared messages. Read only while the
 * tab is the active one.
 */
export function SettingsView({
  shop,
  lang,
  active,
  refreshKey,
  onLocked,
  onCount,
}: {
  shop: MachineShop;
  lang: Lang;
  active: boolean;
  refreshKey: number;
  onLocked: () => void;
  /** The number of prepared messages, for the tab's badge. */
  onCount?: (n: number) => void;
}) {
  const copy = SETTINGS_COPY[lang];
  const id = useId();
  const [saved, setSaved] = useState<SettingsResponse | null>(null);
  const [items, setItems] = useState<OutboxItemDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [link, setLink] = useState("");
  const [vat, setVat] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [switchError, setSwitchError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outboxError, setOutboxError] = useState("");
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!active) return;
    let live = true;
    let retry: number | undefined;
    void Promise.all([getSettings(shop.id), getOutbox(shop.id)]).then(([s, o]) => {
      if (!live) return;
      if (s.status === 401 || o.status === 401) return onLocked();
      if (!s.ok || !o.ok) {
        setFailed(true);
        retry = window.setTimeout(reload, RETRY_MS);
        return;
      }
      setFailed(false);
      setSaved(s.body);
      setLink(s.body.googleReviewUrl ?? "");
      setVat(String(s.body.vatRatePct));
      setItems(o.body.items.filter((m) => m.status === "prepared"));
    });
    return () => {
      live = false;
      window.clearTimeout(retry);
    };
  }, [active, shop.id, refreshKey, tick, onLocked, reload]);

  useEffect(() => {
    if (items) onCount?.(items.length);
  }, [items, onCount]);

  async function save(next: SettingsResponse, onOk?: () => void) {
    setBusy(true);
    const a = await postSettings(shop.id, next);
    setBusy(false);
    if (a.status === 401) return onLocked();
    if (a.ok) {
      setSaved(next);
      onOk?.();
      return true;
    }
    return a.body?.error ?? "failed";
  }

  async function toggle(kind: OutboxKind, on: boolean) {
    if (!saved) return;
    setSwitchError("");
    const r = await save({ ...saved, automations: { ...saved.automations, [kind]: on } });
    if (r === true) reload();
    else if (r === "review_needs_link") setSwitchError(copy.review.needsLink);
    else if (r) setSwitchError(copy.automations.saveFailed);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!saved || busy) return;
    setNote(null);
    const url = link.trim();
    if (url !== "" && !isReviewUrl(url)) return setNote({ text: copy.review.invalid, bad: true });
    if (!/^\d{1,2}$/.test(vat.trim()) || Number(vat) > 30) return setNote({ text: copy.vat.invalid, bad: true });
    const googleReviewUrl = url === "" ? null : url;
    // Removing the link switches the review messages off too: the server refuses "on" without one.
    const automations = googleReviewUrl === null ? { ...saved.automations, review: false } : saved.automations;
    const r = await save({ automations, googleReviewUrl, vatRatePct: Number(vat) });
    if (r === true) {
      setNote({ text: copy.review.saved, bad: false });
      reload();
    } else if (r === "review_needs_link") setNote({ text: copy.review.needsLink, bad: true });
    else if (r === "invalid_request") setNote({ text: copy.review.invalid, bad: true });
    else if (r) setNote({ text: copy.automations.saveFailed, bad: true });
  }

  async function act(itemId: string, action: "sent" | "dismissed") {
    setOutboxError("");
    setBusyId(itemId);
    const a = await postOutboxAction(shop.id, itemId, action);
    setBusyId(null);
    if (a.status === 401) return onLocked();
    if (a.ok) setItems((cur) => (cur ? cur.filter((m) => m.id !== itemId) : cur));
    else if (a.body?.error === "not_prepared" || a.body?.error === "outbox_not_found") {
      setOutboxError(copy.outbox.gone);
      setItems((cur) => (cur ? cur.filter((m) => m.id !== itemId) : cur));
    } else setOutboxError(copy.outbox.failed);
  }

  const h3 = "m-0 font-newsreader text-xl font-medium tracking-tight text-ink";
  const field = "focus-ring min-h-11 rounded-2xl border border-border bg-card px-3 font-inter text-base text-text";
  const label = "font-inter text-base font-semibold text-ink";
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-4">
      <h2 id={`${id}-h`} className="font-newsreader text-2xl text-ink">
        {copy.title}
      </h2>
      {failed && <p className="m-0 font-inter text-sm font-semibold text-muted">{copy.failed}</p>}
      {!saved && !failed && <p className="m-0 font-inter text-sm text-muted">{copy.loading}</p>}

      {saved && items && (
        <>
          <section aria-labelledby={`${id}-o`} className="flex flex-col gap-2">
            <h3 id={`${id}-o`} className={h3}>
              {copy.outbox.title}
              {items.length > 0 && <span className="ml-2 font-inter text-sm font-semibold text-gold-text">{copy.outbox.count(items.length)}</span>}
            </h3>
            {outboxError && (
              <p role="alert" className="m-0 font-inter text-sm font-semibold text-light-text">
                {outboxError}
              </p>
            )}
            <OutboxList items={items} copy={copy} busyId={busyId} onSend={(i) => void act(i, "sent")} onDismiss={(i) => void act(i, "dismissed")} />
          </section>

          <section aria-labelledby={`${id}-a`} className="flex flex-col gap-2">
            <h3 id={`${id}-a`} className={h3}>
              {copy.automations.title}
            </h3>
            <p className="m-0 font-inter text-sm text-muted">{copy.automations.hint}</p>
            {switchError && (
              <p role="alert" className="m-0 font-inter text-sm font-semibold text-light-text">
                {switchError}
              </p>
            )}
            <AutomationSwitches value={saved.automations} copy={copy} hasLink={saved.googleReviewUrl !== null} busy={busy} onToggle={(k, on) => void toggle(k, on)} />
          </section>

          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-link`} className={label}>
                {copy.review.label}
              </label>
              <input
                id={`${id}-link`}
                type="url"
                value={link}
                maxLength={300}
                placeholder={copy.review.placeholder}
                aria-describedby={`${id}-link-hint`}
                onChange={(e) => setLink(e.target.value)}
                className={field}
                autoComplete="off"
              />
              <p id={`${id}-link-hint`} className="m-0 font-inter text-sm text-muted">
                {copy.review.hint}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-vat`} className={label}>
                {copy.vat.label}
              </label>
              <input
                id={`${id}-vat`}
                value={vat}
                inputMode="numeric"
                aria-describedby={`${id}-vat-hint`}
                onChange={(e) => setVat(e.target.value)}
                className={`${field} w-28`}
                autoComplete="off"
              />
              <p id={`${id}-vat-hint`} className="m-0 font-inter text-sm text-muted">
                {copy.vat.hint}
              </p>
            </div>
            {note && (
              <p role={note.bad ? "alert" : "status"} className={`m-0 font-inter text-sm font-semibold ${note.bad ? "text-light-text" : "text-gold-text"}`}>
                {note.text}
              </p>
            )}
            <div>
              <button type="submit" disabled={busy} className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
                {busy ? copy.review.saving : copy.review.save}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

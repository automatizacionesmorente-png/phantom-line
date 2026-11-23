"use client";

import { useState } from "react";
import { REBIRTH_COPY } from "@/lib/rebirth/copy";
import { MAX_PASTED_TEXT, MAX_PDF_BYTES } from "@/lib/rebirth/draft";
import type { Extraction } from "@/lib/rebirth/extraction";
import type { FieldErrors } from "@/lib/rebirth/validate";
import { sectorById } from "@/lib/rebirth/sectors";
import { starterServices, type DayRow, type FaqRow, type ServiceRow, type WizardState } from "@/lib/rebirth/state";
import type { Lang } from "@/lib/sectors";
import { extractDocument } from "./api";
import { errorText, FieldError, HINT, INPUT, LABEL, SECONDARY, TextField } from "./ui";

interface Props {
  lang: Lang;
  state: WizardState;
  errors: FieldErrors;
  update: (patch: Partial<WizardState>) => void;
}

const DEFAULT_SESSION = { open: "10:00", close: "14:00" };

/** Applies an extraction to the form: it fills the editable fields, nothing is created. */
export function applyExtraction(state: WizardState, x: Extraction): Partial<WizardState> {
  const patch: Partial<WizardState> = { catalogueFrom: "document" };
  const hours: Record<number, DayRow> = {};
  for (const [day, sessions] of Object.entries(x.hours)) hours[Number(day)] = sessions.map((s) => ({ ...s }));
  if (Object.keys(hours).length > 0) patch.hours = hours;
  if (x.services.length > 0) {
    patch.services = x.services.map<ServiceRow>((s) => ({
      name: s.name,
      nameEn: "",
      durationMin: s.durationMin === null ? "" : String(s.durationMin),
      priceEur: s.priceEur === null ? "" : String(s.priceEur),
      from: s.from,
    }));
  }
  if (x.faq.length > 0) {
    const mine = x.faq.map<FaqRow>((f) => ({ question: f.question, keywords: "", keywordsEn: "", answer: f.answer, answerEn: "" }));
    // Starter rows the document also answers are replaced by the document's; the rest stay.
    const kept = state.faq.filter((r) => r.answer.trim() === "" && !mine.some((m) => m.question.toLowerCase() === r.question.toLowerCase()));
    patch.faq = [...mine, ...kept].slice(0, 20);
  }
  return patch;
}

export function CatalogueStep({ lang, state, errors, update }: Props) {
  const t = REBIRTH_COPY[lang].catalogue;
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const sector = sectorById(state.sectorId);

  async function read() {
    setNote(null);
    if (file && text.trim() !== "") return setNote({ kind: "error", text: t.errors.both });
    if (!file && text.trim() === "") return setNote({ kind: "error", text: t.errors.nothing });
    if (file && file.type !== "application/pdf") return setNote({ kind: "error", text: t.errors.notPdf });
    if (file && file.size > MAX_PDF_BYTES) return setNote({ kind: "error", text: t.errors.tooBig });
    setBusy(true);
    const r = await extractDocument(file ? { file } : { text: text.slice(0, MAX_PASTED_TEXT) });
    setBusy(false);
    if (!r.ok) {
      const map = { too_large: t.errors.tooBig, wrong_type: t.errors.notPdf, rate_limited: t.errors.rateLimited, failed: t.errors.failed, network: t.errors.network };
      return setNote({ kind: "error", text: map[r.error] });
    }
    update(applyExtraction(state, r.extraction));
    const dropped = r.extraction.dropped > 0 ? ` ${t.dropped(r.extraction.dropped)}` : "";
    setNote({ kind: "ok", text: `${t.done(r.extraction.services.length, r.extraction.faq.length)}${dropped}` });
  }

  const setService = (i: number, patch: Partial<ServiceRow>) =>
    update({ services: state.services.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const setDay = (day: number, sessions: DayRow) => update({ hours: { ...state.hours, [day]: sessions } });

  return (
    <div className="flex flex-col gap-8">
      <p className="font-inter text-base text-text">{t.hint}</p>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="up-h" className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-5">
          <h3 id="up-h" className="font-newsreader text-xl font-medium text-ink">
            {t.uploadHeading}
          </h3>
          <label htmlFor="rb-file" className={LABEL}>
            {t.file}
          </label>
          <input
            id="rb-file"
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="focus-ring font-inter text-sm text-text"
          />
          <label htmlFor="rb-text" className={LABEL}>
            {t.text}
          </label>
          <textarea
            id="rb-text"
            rows={4}
            maxLength={MAX_PASTED_TEXT}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={`${INPUT} py-2`}
          />
          <p className={HINT}>{t.untrusted}</p>
          <button type="button" onClick={read} disabled={busy} className={SECONDARY}>
            {busy ? t.reading : t.read}
          </button>
          {note && (
            <p role={note.kind === "error" ? "alert" : "status"} className={`font-inter text-sm font-semibold ${note.kind === "error" ? "text-light-text" : "text-gold-text"}`}>
              {note.text}
            </p>
          )}
        </section>

        <section aria-labelledby="st-h" className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-5">
          <h3 id="st-h" className="font-newsreader text-xl font-medium text-ink">
            {t.starterHeading}
          </h3>
          <p className={HINT}>{t.starterNote}</p>
          <button
            type="button"
            disabled={!sector || sector.starterCatalogue.length === 0}
            onClick={() => sector && update({ services: starterServices(sector), catalogueFrom: "starter" })}
            className={SECONDARY}
          >
            {t.starter}
          </button>
        </section>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-newsreader text-2xl font-medium text-ink">{t.hoursHeading}</legend>
        <FieldError id="hours-error" message={errorText(lang, errors.hours)} />
        {[1, 2, 3, 4, 5, 6, 7].map((day) => {
          const sessions = state.hours[day] ?? [];
          const open = sessions.length > 0;
          return (
            <div key={day} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
              <label className="flex min-h-11 w-40 items-center gap-2 font-inter text-base font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={open}
                  onChange={(e) => setDay(day, e.target.checked ? [{ ...DEFAULT_SESSION }] : [])}
                  className="focus-ring h-5 w-5 accent-[#9E711F]"
                />
                {t.days[day - 1]}
              </label>
              {!open && <span className="font-inter text-sm text-muted">{t.closed}</span>}
              {sessions.map((s, k) => (
                <div key={k} className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`rb-h-${day}-${k}-o`}>{`${t.days[day - 1]} ${t.from}`}</label>
                  <input
                    id={`rb-h-${day}-${k}-o`}
                    type="time"
                    value={s.open}
                    onChange={(e) => setDay(day, sessions.map((x, j) => (j === k ? { ...x, open: e.target.value } : x)))}
                    className={`${INPUT} w-32`}
                  />
                  <span className="font-inter text-sm text-text">{t.to}</span>
                  <label className="sr-only" htmlFor={`rb-h-${day}-${k}-c`}>{`${t.days[day - 1]} ${t.to}`}</label>
                  <input
                    id={`rb-h-${day}-${k}-c`}
                    type="time"
                    value={s.close}
                    onChange={(e) => setDay(day, sessions.map((x, j) => (j === k ? { ...x, close: e.target.value } : x)))}
                    className={`${INPUT} w-32`}
                  />
                  {sessions.length > 1 && (
                    <button type="button" className={SECONDARY} onClick={() => setDay(day, sessions.filter((_, j) => j !== k))}>
                      {t.removeSession}
                    </button>
                  )}
                </div>
              ))}
              {open && sessions.length < 3 && (
                <button
                  type="button"
                  className={SECONDARY}
                  onClick={() => setDay(day, [...sessions, { open: "17:00", close: "20:00" }])}
                >
                  {t.addSession}
                </button>
              )}
            </div>
          );
        })}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="font-newsreader text-2xl font-medium text-ink">{t.servicesHeading}</legend>
        <FieldError id="services-error" message={errorText(lang, errors.services)} />
        {state.services.length === 0 && <p className="font-inter text-base text-muted">{t.empty}</p>}
        {state.services.map((s, i) => (
          <div key={i} role="group" aria-label={t.service(i + 1)} className="grid gap-3 rounded-[20px] border border-border bg-card p-4 sm:grid-cols-2">
            <TextField id={`rb-s-${i}-n`} label={t.serviceName} value={s.name} maxLength={80} onChange={(v) => setService(i, { name: v })} error={errorText(lang, errors[`services.${i}.name`])} />
            <TextField id={`rb-s-${i}-e`} label={t.serviceNameEn} value={s.nameEn} maxLength={80} onChange={(v) => setService(i, { nameEn: v })} error={errorText(lang, errors[`services.${i}.nameEn`])} />
            <TextField id={`rb-s-${i}-d`} label={t.duration} value={s.durationMin} inputMode="numeric" onChange={(v) => setService(i, { durationMin: v })} error={errorText(lang, errors[`services.${i}.durationMin`])} />
            <TextField id={`rb-s-${i}-p`} label={t.price} value={s.priceEur} inputMode="decimal" onChange={(v) => setService(i, { priceEur: v })} error={errorText(lang, errors[`services.${i}.priceEur`])} />
            <label className="flex min-h-11 items-center gap-2 font-inter text-base text-ink">
              <input type="checkbox" checked={s.from} onChange={(e) => setService(i, { from: e.target.checked })} className="focus-ring h-5 w-5 accent-[#9E711F]" />
              {t.priceFrom}
            </label>
            <button type="button" className={SECONDARY} onClick={() => update({ services: state.services.filter((_, k) => k !== i) })}>
              {t.removeService}
            </button>
          </div>
        ))}
        {state.services.length < 40 && (
          <button
            type="button"
            className={SECONDARY}
            onClick={() => update({ services: [...state.services, { name: "", nameEn: "", durationMin: "30", priceEur: "", from: false }] })}
          >
            {t.addService}
          </button>
        )}
      </fieldset>
    </div>
  );
}

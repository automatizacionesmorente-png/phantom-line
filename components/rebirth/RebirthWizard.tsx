"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LanguageSwitch } from "@/components/call/LanguageSwitch";
import { GOLD_GRADIENT, PRIMARY_BUTTON } from "@/components/machine/controlButton";
import { MessageLight } from "@/components/machine/MessageLight";
import { TapeReels } from "@/components/machine/TapeReels";
import { useReducedMotion } from "@/components/machine/useReducedMotion";
import { useBrowserLang } from "@/components/useBrowserLang";
import { REBIRTH_COPY } from "@/lib/rebirth/copy";
import { sectorById, availableSectors } from "@/lib/rebirth/sectors";
import { emptyState, parseSavedState, starterFaq, toDraft, type FaqRow, type WizardState } from "@/lib/rebirth/state";
import { validateStep, type FieldErrors } from "@/lib/rebirth/validate";
import type { Lang } from "@/lib/sectors";
import { createShop } from "./api";
import { CatalogueStep } from "./CatalogueStep";
import { SuccessScreen, type SuccessData } from "./SuccessScreen";
import { errorText, FieldError, INPUT, LABEL, SECONDARY, Section, TextField } from "./ui";

export const STORAGE_KEY = "pl:rebirth-draft";
const TIME_ZONES = ["Europe/Madrid", "Atlantic/Canary", "Europe/Lisbon", "Europe/London", "Europe/Paris", "America/Mexico_City", "America/Bogota", "America/Argentina/Buenos_Aires", "America/New_York"];
const LAST_STEP = 5;

export interface Timing {
  /** The tape rewinds for at least this long (ms); 0 with reduced motion. */
  rewindMs: number;
  /** The light blinks this long before the success screen (ms). */
  blinkMs: number;
}
export const DEFAULT_TIMING: Timing = { rewindMs: 1700, blinkMs: 1100 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Phase = "idle" | "rewinding" | "alive";

/** The /nacer wizard: six validated steps, progress kept in localStorage, one button at the end. */
export function RebirthWizard({ timing = DEFAULT_TIMING }: { timing?: Timing }) {
  const [lang, setLang] = useBrowserLang(["es", "en"]);
  const t = REBIRTH_COPY[lang];
  const reduced = useReducedMotion();
  const [state, setState] = useState<WizardState>(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pin, setPin] = useState({ pin: "", pinAgain: "", acceptTerms: false });
  const [phase, setPhase] = useState<Phase>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessData | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // One-time read of the saved draft after hydration (localStorage does not exist on the server).
    const saved = parseSavedState(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(saved);
      setResumed(saved.step > 0 || saved.name !== "");
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded && success === null) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, loaded, success]);

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));
  const goTo = (step: number) => {
    update({ step });
    setErrors({});
    setSubmitError(null);
    requestAnimationFrame(() => heading.current?.focus());
  };

  function next() {
    const found = validateStep(state.step, state);
    setErrors(found);
    if (Object.keys(found).length === 0) goTo(state.step + 1);
  }

  function pickSector(id: string) {
    const sector = sectorById(id);
    if (!sector) return;
    const changed = id !== state.sectorId;
    update({
      sectorId: id,
      ...(changed ? { services: [], faq: starterFaq(sector), catalogueFrom: "none" as const } : {}),
    });
  }

  async function submit() {
    setSubmitError(null);
    for (let step = 0; step <= LAST_STEP; step++) {
      const found = validateStep(step, state, pin);
      if (Object.keys(found).length > 0) {
        if (step === LAST_STEP) setErrors(found);
        else {
          goTo(step);
          setErrors(found);
          setSubmitError(t.finish.invalid);
        }
        return;
      }
    }
    setPhase("rewinding");
    const [result] = await Promise.all([createShop({ draft: toDraft(state), pin: pin.pin, acceptTerms: true }), sleep(reduced ? 0 : timing.rewindMs)]);
    if (!result.ok) {
      setPhase("idle");
      setSubmitError(
        result.error === "name_taken" ? t.finish.nameTaken : result.error === "rate_limited" ? t.finish.rateLimited : result.error === "invalid" ? t.finish.invalid : t.finish.failed,
      );
      return;
    }
    setPhase("alive");
    if (!reduced) await sleep(timing.blinkMs);
    localStorage.removeItem(STORAGE_KEY);
    setPin({ pin: "", pinAgain: "", acceptTerms: false });
    setSuccess({
      shopName: state.name,
      callUrl: new URL(result.callPath, window.location.origin).toString(),
      machineUrl: new URL(result.machinePath, window.location.origin).toString(),
      expiresAt: result.expiresAt,
    });
  }

  function startOver() {
    localStorage.removeItem(STORAGE_KEY);
    setState(emptyState());
    setResumed(false);
    setErrors({});
  }

  const e = (key: string) => errorText(lang, errors[key]);
  const sectors = availableSectors();

  return (
    <div lang={lang} className="flex flex-1 flex-col items-center bg-bg px-5 py-10 sm:px-6">
      <main className="flex w-full max-w-3xl flex-col gap-8">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="focus-ring font-inter text-sm font-semibold text-gold-text underline">
            {t.back}
          </Link>
          <LanguageSwitch lang={lang} options={["es", "en"]} label={t.langLabel} onChange={setLang as (l: Lang) => void} />
        </div>

        {success ? (
          <SuccessScreen lang={lang} data={success} />
        ) : (
          <>
            <header className="flex flex-col gap-4">
              <p className="flex items-center gap-2 font-inter text-xs uppercase tracking-[0.18em] text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-dot" aria-hidden="true" />
                {t.eyebrow}
              </p>
              <h1 className="font-newsreader text-5xl font-medium tracking-tight text-ink">
                {t.title[0]}
                <span className="text-gold">{t.title[1]}</span>
              </h1>
              <p className="font-inter text-lg text-text">{t.lead}</p>
            </header>

            {resumed && (
              <p role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 font-inter text-sm text-text">
                {t.resumed}
                <button type="button" className="focus-ring font-semibold text-gold-text underline" onClick={startOver}>
                  {t.startOver}
                </button>
              </p>
            )}

            <nav aria-label={t.stepOf(state.step + 1, LAST_STEP + 1)}>
              <ol className="flex flex-wrap gap-2">
                {t.steps.map((label, i) => (
                  <li
                    key={label}
                    aria-current={i === state.step ? "step" : undefined}
                    className={`rounded-full border px-3 py-1 font-inter text-xs font-semibold ${i === state.step ? "border-ink bg-espresso text-card" : "border-border bg-card text-muted"}`}
                  >
                    {i + 1}. {label}
                  </li>
                ))}
              </ol>
            </nav>
            <p className="font-inter text-sm text-muted" aria-live="polite">
              {t.stepOf(state.step + 1, LAST_STEP + 1)}
            </p>

            <form
              noValidate
              onSubmit={(ev) => {
                ev.preventDefault();
                if (state.step < LAST_STEP) next();
                else void submit();
              }}
              className="flex flex-col gap-6"
            >
              <h2 ref={heading} tabIndex={-1} className="sr-only">
                {t.steps[state.step]}
              </h2>

              {state.step === 0 && (
                <Section heading={t.sector.heading} hint={t.sector.hint}>
                  <div role="radiogroup" aria-label={t.sector.heading} className="grid gap-3 sm:grid-cols-2">
                    {sectors.map((s) => {
                      const on = s.id === state.sectorId;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => pickSector(s.id)}
                          className={`focus-ring flex min-h-24 flex-col items-start gap-1 rounded-[20px] border-2 p-5 text-left ${on ? "border-ink bg-section" : "border-border bg-card hover:bg-section"}`}
                        >
                          <span className="font-newsreader text-2xl font-medium text-ink">{s.name[lang]}</span>
                          <span className="font-inter text-sm text-muted">{t.sector.resources(s.resourceKind[lang].many)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <FieldError id="sector-error" message={e("sectorId")} />
                </Section>
              )}

              {state.step === 1 && (
                <Section heading={t.business.heading}>
                  <TextField id="rb-name" label={t.business.name} value={state.name} maxLength={80} autoComplete="organization" onChange={(v) => update({ name: v })} error={e("business.name")} />
                  <TextField id="rb-address" label={t.business.address} value={state.address} maxLength={120} autoComplete="street-address" onChange={(v) => update({ address: v })} error={e("business.address")} />
                  <TextField id="rb-city" label={t.business.city} value={state.city} maxLength={60} autoComplete="address-level2" onChange={(v) => update({ city: v })} error={e("business.city")} />
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="rb-tz" className={LABEL}>
                      {t.business.timeZone}
                    </label>
                    <select id="rb-tz" value={state.timeZone} onChange={(ev) => update({ timeZone: ev.target.value })} className={INPUT} aria-invalid={e("business.timeZone") ? true : undefined}>
                      {[...new Set([state.timeZone, ...TIME_ZONES])].map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                    <FieldError id="rb-tz-error" message={e("business.timeZone")} />
                  </div>
                  <fieldset className="flex flex-col gap-2">
                    <legend className={LABEL}>{t.business.languages}</legend>
                    {(["es", "en"] as const).map((l) => (
                      <label key={l} className="flex min-h-11 items-center gap-2 font-inter text-base text-ink">
                        <input
                          type="checkbox"
                          checked={state.languages.includes(l)}
                          onChange={(ev) => update({ languages: (["es", "en"] as const).filter((x) => (x === l ? ev.target.checked : state.languages.includes(x))) })}
                          className="focus-ring h-5 w-5 accent-[#9E711F]"
                        />
                        {t.business[l]}
                      </label>
                    ))}
                    <FieldError id="rb-lang-error" message={e("business.languages")} />
                  </fieldset>
                  <TextField id="rb-owner" label={t.business.ownerName} hint={t.business.ownerHint} value={state.ownerName} maxLength={40} autoComplete="given-name" onChange={(v) => update({ ownerName: v })} error={e("business.ownerName")} />
                  <TextField id="rb-web" label={t.business.website} hint={t.business.websiteHint} type="url" inputMode="url" value={state.website} maxLength={200} autoComplete="url" onChange={(v) => update({ website: v })} error={e("business.website")} />
                </Section>
              )}

              {state.step === 2 && (
                <Section heading={t.team.heading} hint={t.team.hint}>
                  {state.members.map((m, i) => (
                    <div key={i} className="flex items-end gap-2">
                      <div className="flex-1">
                        <TextField id={`rb-m-${i}`} label={t.team.member(i + 1)} value={m} maxLength={40} onChange={(v) => update({ members: state.members.map((x, k) => (k === i ? v : x)) })} error={e(`team.members.${i}`) ?? (i === 0 ? e("team.members") : undefined)} />
                      </div>
                      {state.members.length > 1 && (
                        <button type="button" className={SECONDARY} onClick={() => update({ members: state.members.filter((_, k) => k !== i) })}>
                          {t.team.remove}
                        </button>
                      )}
                    </div>
                  ))}
                  {state.members.length < 8 && (
                    <div>
                      <button type="button" className={SECONDARY} onClick={() => update({ members: [...state.members, ""] })}>
                        {t.team.add}
                      </button>
                    </div>
                  )}
                  <TextField id="rb-conc" label={t.team.concurrent} hint={t.team.concurrentHint} inputMode="numeric" value={state.concurrent} maxLength={1} onChange={(v) => update({ concurrent: v })} error={e("team.concurrent")} />
                </Section>
              )}

              {state.step === 3 && (
                <Section heading={t.catalogue.heading}>
                  <CatalogueStep lang={lang} state={state} errors={errors} update={update} />
                </Section>
              )}

              {state.step === 4 && (
                <Section heading={t.faq.heading} hint={t.faq.hint}>
                  <FieldError id="faq-error" message={e("faq")} />
                  {state.faq.map((r, i) => {
                    const set = (patch: Partial<FaqRow>) => update({ faq: state.faq.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
                    const both = state.languages.includes("en");
                    return (
                      <div key={i} role="group" aria-label={t.faq.row(i + 1)} className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4">
                        <TextField id={`rb-q-${i}`} label={t.faq.question} value={r.question} maxLength={120} onChange={(v) => set({ question: v })} error={e(`faq.${i}.question`)} />
                        <TextField id={`rb-k-${i}`} label={t.faq.keywords} value={r.keywords} maxLength={400} onChange={(v) => set({ keywords: v })} error={e(`faq.${i}.keywords`)} />
                        <TextField id={`rb-a-${i}`} label={t.faq.answer} hint={r.example ? `${r.example}` : t.faq.skip} value={r.answer} maxLength={300} placeholder={r.example} onChange={(v) => set({ answer: v })} error={e(`faq.${i}.answer`)} />
                        {both && (
                          <>
                            <TextField id={`rb-ke-${i}`} label={t.faq.keywordsEn} value={r.keywordsEn} maxLength={400} onChange={(v) => set({ keywordsEn: v })} />
                            <TextField id={`rb-ae-${i}`} label={t.faq.answerEn} value={r.answerEn} maxLength={300} onChange={(v) => set({ answerEn: v })} error={e(`faq.${i}.answerEn`)} />
                          </>
                        )}
                        <div>
                          <button type="button" className={SECONDARY} onClick={() => update({ faq: state.faq.filter((_, k) => k !== i) })}>
                            {t.faq.remove}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {state.faq.length < 20 && (
                    <div>
                      <button type="button" className={SECONDARY} onClick={() => update({ faq: [...state.faq, { question: "", keywords: "", keywordsEn: "", answer: "", answerEn: "" }] })}>
                        {t.faq.add}
                      </button>
                    </div>
                  )}
                </Section>
              )}

              {state.step === 5 && (
                <Section heading={t.finish.heading}>
                  <TextField id="rb-pin" label={t.finish.pin} hint={t.finish.pinHint} type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pin.pin} onChange={(v) => setPin({ ...pin, pin: v.replace(/\D/g, "") })} error={errorText(lang, errors.pin)} />
                  <TextField id="rb-pin2" label={t.finish.pinAgain} type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pin.pinAgain} onChange={(v) => setPin({ ...pin, pinAgain: v.replace(/\D/g, "") })} error={errorText(lang, errors.pinAgain)} />
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-start gap-3 font-inter text-base text-ink">
                      <input
                        type="checkbox"
                        checked={pin.acceptTerms}
                        onChange={(ev) => setPin({ ...pin, acceptTerms: ev.target.checked })}
                        aria-invalid={errors.acceptTerms ? true : undefined}
                        className="focus-ring mt-1 h-5 w-5 shrink-0 accent-[#9E711F]"
                      />
                      {t.finish.terms}
                    </label>
                    <FieldError id="rb-terms-error" message={errorText(lang, errors.acceptTerms)} />
                  </div>
                  <p className="font-inter text-base text-text">{t.finish.ready}</p>
                  <RebirthStage phase={phase} label={t.finish} reduced={reduced} />
                </Section>
              )}

              {submitError && (
                <p role="alert" className="font-inter text-base font-semibold text-light-text">
                  {submitError}
                </p>
              )}
              {Object.keys(errors).length > 0 && state.step < LAST_STEP && (
                <p role="alert" className="font-inter text-sm font-semibold text-light-text">
                  {t.fixErrors}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                {state.step > 0 ? (
                  <button type="button" className={SECONDARY} onClick={() => goTo(state.step - 1)} disabled={phase !== "idle"}>
                    {t.previous}
                  </button>
                ) : (
                  <span />
                )}
                {state.step < LAST_STEP ? (
                  <button type="submit" className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
                    {t.next}
                  </button>
                ) : (
                  <button
                    type="submit"
                    data-rebirth-button=""
                    disabled={phase !== "idle"}
                    className="focus-ring inline-flex min-h-16 items-center justify-center gap-3 rounded-full px-10 font-newsreader text-3xl font-medium text-ink shadow-[0_10px_26px_rgb(36_29_20/0.22)] disabled:opacity-70"
                    style={GOLD_GRADIENT}
                  >
                    {t.finish.button}
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

/**
 * The little ceremony: the tape rewinds (the reels turn backwards), then the red light starts to
 * blink. With reduced motion nothing moves: the reels stay still and the light is steady; the
 * state is also said in text (a live region).
 */
export function RebirthStage({ phase, label, reduced }: { phase: Phase; label: { rewinding: string; alive: string }; reduced: boolean }) {
  if (phase === "idle") return null;
  const rewinding = phase === "rewinding";
  return (
    <div data-stage={phase} className={`flex items-center justify-center gap-5 rounded-[20px] border border-gold-dot bg-section p-5 ${rewinding ? "rewind-reels" : ""}`}>
      <TapeReels spinning={rewinding && !reduced} />
      <MessageLight state={rewinding ? "off" : "blinking"} reducedMotion={reduced} />
      <p role="status" className="font-newsreader text-xl text-ink">
        {rewinding ? label.rewinding : label.alive}
      </p>
    </div>
  );
}

"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { GateShop } from "@/lib/owner/machineShop";
import { LanguageSwitch } from "@/components/call/LanguageSwitch";
import { TryItGuide } from "@/components/guide/TryItGuide";
import { useBrowserLang } from "../useBrowserLang";
import { GOLD_GRADIENT, PRIMARY_BUTTON, sessionUrl } from "./controlButton";
import { TrialBadge } from "@/components/TrialBadge";
import { DemoNotice } from "./DemoNotice";
import { MACHINE_COPY } from "./machineCopy";

const PIN = /^\d{6}$/;
const LABEL_MAX = 30;

/**
 * The PIN_Gate (owner-machine 1.1, 1.2, 1.5): the shop name, the PIN, an optional name, and
 * "Open the machine". Nothing about Calls, Messages, Bookings, the Counter or the light. The
 * PIN is checked on the server; a right PIN sets the session cookie and `router.refresh()`
 * shows the machine without a full reload (1.4).
 */
export function PinGate({ shop }: { shop: GateShop }) {
  const [lang, setLang] = useBrowserLang(shop.languages);
  const copy = MACHINE_COPY[lang].gate;
  const router = useRouter();
  const id = useId();
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (!PIN.test(pin)) {
      setError(copy.wrongPin);
      setPin("");
      return;
    }
    setBusy(true);
    setError("");
    let status = 0;
    try {
      const res = await fetch(sessionUrl(shop.id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(name.trim() === "" ? { pin } : { pin, label: name.slice(0, LABEL_MAX) }),
        cache: "no-store",
      });
      status = res.status;
    } catch {
      status = 0;
    }
    if (status === 204) {
      router.refresh();
      return;
    }
    setBusy(false);
    // 1.5: the same words for every wrong PIN; the name stays, the PIN is cleared.
    setPin("");
    setError(status === 401 ? copy.wrongPin : status === 429 ? copy.tooMany : status === 409 ? copy.notSetUp : copy.cantOpen);
  }

  return (
    <section lang={lang} className="flex w-full max-w-md flex-col items-center gap-5 text-center">
      {shop.demo && <TryItGuide current={2} lang={lang} />}
      <p className="flex items-center gap-2 font-inter text-xs uppercase tracking-[0.18em] text-muted">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-dot" aria-hidden="true" />
        {MACHINE_COPY[lang].eyebrow}
      </p>
      <h1 className="font-newsreader text-4xl font-medium tracking-tight text-ink break-words sm:text-5xl">
        {copy.headingBefore} <span className="text-gold">{shop.name}</span>
      </h1>
      {shop.demo && <DemoNotice lang={lang} />}
      {shop.trial === true && <TrialBadge lang={lang} />}
      <LanguageSwitch lang={lang} options={shop.languages} label={MACHINE_COPY[lang].languageLabel} onChange={setLang} />

      <form
        onSubmit={submit}
        noValidate
        className="flex w-full flex-col gap-4 rounded-[28px] border border-gold-dot bg-section p-5 text-left shadow-[0_18px_40px_rgb(36_29_20/0.14)] sm:p-7"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-pin`} className="font-inter text-base font-semibold text-ink">
            {copy.pinLabel}
          </label>
          <input
            id={`${id}-pin`}
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            pattern="\d{6}"
            maxLength={6}
            required
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-describedby={`${id}-pin-hint`}
            aria-invalid={error !== "" ? true : undefined}
            className="focus-ring min-h-12 w-full rounded-2xl border border-border bg-card px-4 font-newsreader text-2xl tracking-[0.4em] text-ink"
          />
          <p id={`${id}-pin-hint`} className="font-inter text-sm text-muted">
            {copy.pinHint}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="font-inter text-base font-semibold text-ink">
            {copy.nameLabel}
          </label>
          <input
            id={`${id}-name`}
            name="label"
            type="text"
            autoComplete="nickname"
            maxLength={LABEL_MAX}
            placeholder={copy.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="focus-ring min-h-12 w-full rounded-2xl border border-border bg-card px-4 font-inter text-base text-text placeholder:text-muted"
          />
        </div>
        <button type="submit" disabled={busy} className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
          {busy ? copy.opening : copy.open}
          <ArrowRight aria-hidden="true" size={20} />
        </button>
        <p role="alert" className="min-h-6 font-inter text-base font-semibold text-light-text">
          {error}
        </p>
      </form>
    </section>
  );
}

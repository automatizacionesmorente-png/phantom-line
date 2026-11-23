"use client";

import { useState, type FormEvent } from "react";
import { GOLD_GRADIENT, PRIMARY_BUTTON } from "@/components/machine/controlButton";
import type { Lang } from "@/lib/conversation/types";
import { COPY } from "./copy";

type Status = "idle" | "sending" | "done" | { error: "invalid" | "consent" | "rateLimited" | "unavailable" };

const FIELD =
  "focus-ring mt-1 block min-h-11 w-full rounded-xl border border-border bg-card px-3 font-inter text-base text-ink";

/** The waitlist form. The server validates again; the consent box is also checked here for a clear message. */
export function WaitlistForm({ lang }: { lang: Lang }) {
  const t = COPY[lang].form;
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (data.get("consent") !== "on") {
      setStatus({ error: "consent" });
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shopName: String(data.get("shopName") ?? ""),
          city: String(data.get("city") ?? ""),
          email: String(data.get("email") ?? ""),
          language: lang,
          consent: true,
        }),
      });
      if (res.ok) {
        form.reset();
        setStatus("done");
      } else {
        setStatus({ error: res.status === 400 ? "invalid" : res.status === 429 ? "rateLimited" : "unavailable" });
      }
    } catch {
      setStatus({ error: "unavailable" });
    }
  }

  if (status === "done") {
    return (
      <p role="status" className="font-newsreader text-2xl text-ink">
        {t.thanks}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 text-left">
      <label className="font-inter text-sm font-semibold text-ink">
        {t.shopName}
        <input name="shopName" type="text" required maxLength={80} autoComplete="organization" className={FIELD} />
      </label>
      <label className="font-inter text-sm font-semibold text-ink">
        {t.city}
        <input name="city" type="text" required maxLength={60} autoComplete="address-level2" className={FIELD} />
      </label>
      <label className="font-inter text-sm font-semibold text-ink">
        {t.email}
        <input name="email" type="email" required maxLength={254} autoComplete="email" className={FIELD} />
      </label>
      <label className="flex items-start gap-3 font-inter text-sm text-text">
        <input name="consent" type="checkbox" required className="focus-ring mt-0.5 h-5 w-5 shrink-0 accent-[#82591A]" />
        <span>{t.consent}</span>
      </label>
      <p className="font-inter text-sm text-muted">{t.privacy}</p>
      {typeof status === "object" && (
        <p role="alert" className="font-inter text-sm font-semibold text-light-text">
          {t.errors[status.error]}
        </p>
      )}
      <button type="submit" disabled={status === "sending"} className={`${PRIMARY_BUTTON} self-start`} style={GOLD_GRADIENT}>
        {status === "sending" ? t.sending : t.submit}
      </button>
    </form>
  );
}

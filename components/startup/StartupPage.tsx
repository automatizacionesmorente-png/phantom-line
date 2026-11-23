"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LanguageSwitch } from "@/components/call/LanguageSwitch";
import { GOLD_GRADIENT, PRIMARY_BUTTON } from "@/components/machine/controlButton";
import type { Lang } from "@/lib/conversation/types";
import { COPY, langFromBrowser } from "./copy";
import { WaitlistForm } from "./WaitlistForm";

const H2 = "font-newsreader text-3xl font-medium tracking-tight text-ink";

/** The /startup page: English first render, then the browser language, with an ES / EN switch. */
export function StartupPage() {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    // One-time read of the browser language after hydration; a manual choice wins afterwards.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLang(langFromBrowser(navigator.language));
  }, []);
  const t = COPY[lang];

  return (
    <div lang={lang} className="flex flex-1 flex-col items-center bg-bg px-5 py-10 sm:px-6">
      <main className="flex w-full max-w-3xl flex-col gap-14">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="focus-ring font-inter text-sm font-semibold text-gold-text underline">
            {t.nav.back}
          </Link>
          <LanguageSwitch lang={lang} options={["es", "en"]} label={t.nav.langLabel} onChange={setLang} />
        </div>

        <header className="flex flex-col gap-5">
          <p className="flex items-center gap-2 font-inter text-xs uppercase tracking-[0.18em] text-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-dot" aria-hidden="true" />
            {t.eyebrow}
          </p>
          <h1 className="font-newsreader text-5xl font-medium tracking-tight text-ink">
            {t.title[0]}
            <span className="text-gold">{t.title[1]}</span>
          </h1>
          <p className="font-inter text-xl text-text">{t.lead}</p>
          <p className="font-inter text-base font-semibold text-ink">{t.founder}</p>
          <div className="flex flex-col items-start gap-2">
            <Link href="/nacer" className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
              {t.cta.label}
            </Link>
            <p className="font-inter text-sm text-muted">{t.cta.hint}</p>
          </div>
        </header>

        <section aria-labelledby="problem" className="flex flex-col gap-5">
          <h2 id="problem" className={H2}>
            {t.problem.heading}
          </h2>
          <p className="font-inter text-base text-text">{t.problem.intro}</p>
          <ul className="grid gap-4 sm:grid-cols-3">
            {t.problem.stats.map((s) => (
              <li key={s.value} className="rounded-[20px] border border-border bg-card p-5">
                <p className="font-newsreader text-4xl text-gold">{s.value}</p>
                <p className="mt-2 font-inter text-sm text-text">{s.text}</p>
              </li>
            ))}
          </ul>
          <p className="font-inter text-sm text-muted">
            {t.problem.note}{" "}
            {t.problem.sources.map((s, i) => (
              <span key={s.href}>
                {i > 0 && ", "}
                <a href={s.href} className="focus-ring text-gold-text underline" rel="noopener noreferrer">
                  {s.label}
                </a>
              </span>
            ))}
          </p>
        </section>

        <section aria-labelledby="how" className="flex flex-col gap-5">
          <h2 id="how" className={H2}>
            {t.how.heading}
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {t.how.steps.map((s, i) => (
              <li key={s.title} className="rounded-[20px] border border-border bg-section p-5">
                <p className="font-inter text-xs uppercase tracking-[0.18em] text-muted">{i + 1}</p>
                <h3 className="mt-1 font-newsreader text-xl text-ink">{s.title}</h3>
                <p className="mt-2 font-inter text-sm text-text">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="built" className="flex flex-col gap-5">
          <h2 id="built" className={H2}>
            {t.built.heading}
          </h2>
          <ul className="list-disc pl-5 font-inter text-base text-text">
            {t.built.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          <h3 className="font-newsreader text-xl text-ink">{t.built.roadmapHeading}</h3>
          <ul className="list-disc pl-5 font-inter text-base text-text">
            {t.built.roadmap.map((i) => (
              <li key={i}>
                {i} <span className="font-semibold text-muted">({t.built.roadmapTag})</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="pricing" className="flex flex-col gap-5">
          <h2 id="pricing" className={H2}>
            {t.pricing.heading}
          </h2>
          <p className="font-inter text-sm font-semibold text-light-text">{t.pricing.planned}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {t.pricing.tiers.map((tier) => (
              <div key={tier.name} className="rounded-[20px] border border-gold-dot bg-card p-6">
                <h3 className="font-newsreader text-2xl text-ink">{tier.name}</h3>
                <p className="mt-2 font-newsreader text-4xl text-gold">{tier.price}</p>
                <p className="font-inter text-sm text-muted">{tier.period}</p>
                <ul className="mt-4 list-disc pl-5 font-inter text-sm text-text">
                  {tier.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="font-inter text-sm text-muted">{t.pricing.basis}</p>
        </section>

        <section
          aria-labelledby="waitlist"
          className="flex flex-col gap-4 rounded-[28px] border border-gold-dot bg-section px-5 py-8 sm:px-8"
        >
          <h2 id="waitlist" className={H2}>
            {t.form.heading}
          </h2>
          <p className="font-inter text-base text-text">{t.form.intro}</p>
          <WaitlistForm lang={lang} />
        </section>
      </main>
    </div>
  );
}

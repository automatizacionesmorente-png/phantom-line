"use client";

import { useMemo, useState } from "react";
import { MessageLight } from "@/components/machine/MessageLight";
import { PRIMARY_BUTTON, GOLD_GRADIENT } from "@/components/machine/controlButton";
import { TapeReels } from "@/components/machine/TapeReels";
import { REBIRTH_COPY } from "@/lib/rebirth/copy";
import { qrGrid, qrPath } from "@/lib/rebirth/qr";
import { websiteSnippet } from "@/lib/rebirth/snippet";
import type { Lang } from "@/lib/sectors";
import { SECONDARY } from "./ui";

export interface SuccessData {
  shopName: string;
  callUrl: string;
  machineUrl: string;
  expiresAt: string;
}

function CopyButton({ text, lang }: { text: string; lang: Lang }) {
  const t = REBIRTH_COPY[lang].success;
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={SECONDARY}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? t.copied : t.copy}
    </button>
  );
}

/** A QR drawn as SVG elements (no HTML string): the path comes from our own encoder. */
export function QrImage({ text, label }: { text: string; label: string }) {
  const drawing = useMemo(() => {
    try {
      return qrPath(qrGrid(text));
    } catch {
      return null;
    }
  }, [text]);
  if (!drawing) return null;
  return (
    <svg
      data-qr=""
      viewBox={`0 0 ${drawing.side} ${drawing.side}`}
      width="224"
      height="224"
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="rounded-xl border border-border"
    >
      <rect width={drawing.side} height={drawing.side} fill="#FFFDF8" />
      <path d={drawing.d} fill="#14110C" />
    </svg>
  );
}

/** "Ha vuelto a la vida": the links, the QR, the website button and what to do next. The shop's name is rendered as text only. */
export function SuccessScreen({ lang, data }: { lang: Lang; data: SuccessData }) {
  const t = REBIRTH_COPY[lang].success;
  const snippet = websiteSnippet(data.callUrl, t.snippetLabel);
  const date = data.expiresAt ? new Date(data.expiresAt).toLocaleDateString(lang === "es" ? "es-ES" : "en-GB", { dateStyle: "long" }) : "";
  return (
    <section data-success="" aria-labelledby="alive-h" className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-4">
          <TapeReels spinning={false} />
          <MessageLight state="blinking" reducedMotion={false} />
        </div>
        <h1 id="alive-h" className="font-newsreader text-5xl font-medium tracking-tight text-ink">
          {t.heading[0]}
          <span className="text-gold">{t.heading[1]}</span>
        </h1>
        <p className="font-inter text-lg text-text">{t.lead(data.shopName)}</p>
        {date && <p className="font-inter text-sm text-muted">{t.expires(date)}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-[20px] border border-border bg-card p-5">
          <h2 className="font-newsreader text-xl font-medium text-ink">{t.call}</h2>
          <p data-call-url="" className="break-all font-inter text-sm text-text">{data.callUrl}</p>
          <div className="flex flex-wrap gap-2">
            <a href={data.callUrl} className={`${PRIMARY_BUTTON}`} style={GOLD_GRADIENT}>
              {t.open}
            </a>
            <CopyButton text={data.callUrl} lang={lang} />
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-[20px] border border-border bg-card p-5">
          <h2 className="font-newsreader text-xl font-medium text-ink">{t.machine}</h2>
          <p data-machine-url="" className="break-all font-inter text-sm text-text">{data.machineUrl}</p>
          <div className="flex flex-wrap gap-2">
            <a href={data.machineUrl} className={SECONDARY}>
              {t.open}
            </a>
            <CopyButton text={data.machineUrl} lang={lang} />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-[20px] border border-border bg-card p-5">
        <h2 className="font-newsreader text-xl font-medium text-ink">{t.qr}</h2>
        <QrImage text={data.callUrl} label={t.qrAlt} />
      </div>

      <div className="flex flex-col gap-2 rounded-[20px] border border-border bg-card p-5">
        <h2 className="font-newsreader text-xl font-medium text-ink">{t.snippet}</h2>
        <p className="font-inter text-sm text-muted">{t.snippetHint}</p>
        <label htmlFor="rb-snippet" className="sr-only">
          {t.snippet}
        </label>
        <textarea id="rb-snippet" readOnly rows={4} value={snippet} className="focus-ring w-full rounded-xl border border-border bg-bg p-3 font-mono text-xs text-text" />
        <div>
          <CopyButton text={snippet} lang={lang} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-newsreader text-2xl font-medium text-ink">{t.nextHeading}</h2>
        <ul className="list-disc space-y-1 pl-6 font-inter text-base text-text">
          {t.next.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

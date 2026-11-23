"use client";

import { useEffect, useId, useState } from "react";
import type { WeekStats } from "@/lib/owner/weekStats";
import type { Lang } from "@/lib/sectors";
import { formatDuration, formatRevenue, savedFormula, WEEK_COPY } from "./weekCopy";

export interface WeekPanelProps {
  shopId: string;
  lang: Lang;
  /** Changes when the machine's data changed (the Poll's version): the numbers are read again. */
  refreshKey: number;
  onLocked: () => void;
}

const REFRESH_MS = 60_000;

const dayLabel = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-border bg-card px-3 py-2.5">
      <dt className="font-inter text-xs text-muted">{label}</dt>
      <dd className="m-0 font-newsreader text-2xl font-medium tracking-tight text-ink">{value}</dd>
      {note && <dd className="m-0 font-inter text-xs leading-snug text-muted">{note}</dd>}
    </div>
  );
}

/**
 * "Últimos 7 días" (BACKLOG 17): the last 7 days' real numbers from the shop's own data. A number that
 * cannot be computed (no finished calls, a booked service gone from the catalogue) is not shown.
 */
export function WeekPanel({ shopId, lang, refreshKey, onLocked }: WeekPanelProps) {
  const copy = WEEK_COPY[lang];
  const headingId = useId();
  const [stats, setStats] = useState<WeekStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const load = async () => {
      controller = new AbortController();
      try {
        const res = await fetch(`/api/machine/${encodeURIComponent(shopId)}/week`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!active) return;
        if (res.status === 401) return onLocked();
        if (!res.ok) return setFailed(true);
        setStats((await res.json()) as WeekStats);
        setFailed(false);
      } catch {
        if (active) setFailed(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [shopId, refreshKey, onLocked]);

  if (!stats) {
    return failed ? <p className="font-inter text-sm text-muted">{copy.loadFailed}</p> : null;
  }
  const formula = savedFormula(stats, lang);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={headingId} className="font-newsreader text-xl font-medium tracking-tight text-ink">
          {copy.title}
        </h2>
        <p className="font-inter text-xs text-muted">
          {copy.range(dayLabel(stats.from, lang), dayLabel(stats.to, lang))}
        </p>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={copy.answered} value={String(stats.callsAnswered)} note={copy.answeredNote} />
        <Stat label={copy.bookings} value={String(stats.bookings)} note={copy.bookingsNote} />
        {stats.revenueCents !== null && (
          <Stat
            label={copy.revenue}
            value={`${stats.revenueFrom ? `${copy.from} ` : ""}${formatRevenue(stats.revenueCents, lang)}`}
            note={copy.revenueNote}
          />
        )}
        <Stat label={copy.lost} value={String(stats.lostCalls)} note={copy.lostNote} />
        {stats.timeSavedSeconds !== null && (
          <Stat label={copy.saved} value={formatDuration(stats.timeSavedSeconds, lang)} />
        )}
      </dl>
      {formula && <p className="font-inter text-xs leading-snug text-muted">{formula}</p>}
    </section>
  );
}

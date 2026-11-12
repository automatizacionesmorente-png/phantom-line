"use client";

import { useEffect, useRef } from "react";
import type { NoticeKey, TranscriptEntry } from "@/lib/voice/callLoop";

export interface TranscriptProps {
  entries: readonly TranscriptEntry[];
  interim: string;
  labels: { title: string; you: string; receptionist: string; empty: string };
  notice: (key: NoticeKey) => string;
}

/** Each Turn in order: the caller's line, then the receptionist's reply (1.5). */
export function Transcript({ entries, interim, labels, notice }: TranscriptProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length, interim]);

  return (
    <section aria-label={labels.title} className="w-full rounded-[28px] border border-border bg-card p-4 sm:p-6">
      {entries.length === 0 && interim === "" ? (
        <p className="font-inter text-base text-muted">{labels.empty}</p>
      ) : (
        <ol aria-live="polite" aria-relevant="additions" className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto">
          {entries.map((e, k) => (
            <li key={k} className="ghost-in break-words">
              {e.who === "notice" ? (
                <p className="rounded-2xl border border-gold-dot bg-section px-4 py-2 font-inter text-base text-text">
                  {notice(e.key)}
                </p>
              ) : (
                <p className="font-inter text-base text-text">
                  <span className={`mr-2 font-semibold ${e.who === "caller" ? "text-ink" : "text-gold-text"}`}>
                    {e.who === "caller" ? labels.you : labels.receptionist}:
                  </span>
                  {e.text}
                </p>
              )}
            </li>
          ))}
          {interim !== "" && (
            <li aria-hidden="true" className="break-words font-inter text-base italic text-muted">
              {labels.you}: {interim}
            </li>
          )}
        </ol>
      )}
      <div ref={endRef} />
    </section>
  );
}

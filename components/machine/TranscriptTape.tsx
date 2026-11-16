"use client";

import { useEffect, useRef, useState } from "react";
import type { Line } from "@/lib/conversation/types";
import type { Lang } from "@/lib/sectors";

/** One more line every 900 ms, like a tape (design, "Transcript playback"). */
export const REVEAL_MS = 900;

interface Entry {
  who: "caller" | "receptionist";
  text: string;
}

function entriesOf(lines: readonly Line[]): Entry[] {
  const out: Entry[] = [];
  for (const l of lines) {
    if (l.caller.trim() !== "") out.push({ who: "caller", text: l.caller });
    if (l.receptionist.trim() !== "") out.push({ who: "receptionist", text: l.receptionist });
  }
  return out;
}

/**
 * The Transcript of the Message on screen (owner-machine 7.2, 7.3, 13.4). Every line is in
 * the list from the start; lines not reached yet are only hidden visually (opacity), so a
 * screen reader reads the whole Transcript at once. With reduced motion nothing is hidden
 * and no timer runs. Remount it (a `key`) for another Message.
 */
export function TranscriptTape({
  lines,
  lang,
  labelLang,
  reducedMotion,
  labels,
  onRevealDone,
}: {
  lines: readonly Line[];
  /** The Call's language: the lines are shown as they were said. */
  lang: Lang;
  /** The screen's label language, for "Caller" / "Assistant". */
  labelLang: Lang;
  reducedMotion: boolean;
  labels: { title: string; caller: string; receptionist: string; empty: string };
  onRevealDone: () => void;
}) {
  const entries = entriesOf(lines);
  const total = entries.length;
  const [revealed, setRevealed] = useState(1);
  const done = useRef(onRevealDone);

  useEffect(() => {
    done.current = onRevealDone;
  }, [onRevealDone]);

  useEffect(() => {
    if (reducedMotion) return;
    let shown = 1;
    const timer = setInterval(() => {
      shown += 1;
      setRevealed(shown);
      if (shown >= total) {
        clearInterval(timer);
        done.current();
      }
    }, REVEAL_MS);
    return () => clearInterval(timer);
  }, [reducedMotion, total]);

  if (total === 0) return <p className="font-inter text-base text-muted">{labels.empty}</p>;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-inter text-xs uppercase tracking-[0.18em] text-muted">{labels.title}</h3>
      <ol className="flex flex-col gap-2" lang={lang}>
        {entries.map((e, k) => {
          const hidden = !reducedMotion && k >= revealed;
          return (
            <li
              key={k}
              data-line=""
              className={`rounded-2xl px-3.5 py-2 font-inter text-base ${
                e.who === "caller" ? "self-start bg-section text-text" : "self-end bg-card text-text ring-1 ring-border"
              } ${hidden ? "tape-line-hidden" : reducedMotion ? "" : "ghost-in"}`}
            >
              <span lang={labelLang} className="mr-1.5 font-semibold text-muted">
                {e.who === "caller" ? labels.caller : labels.receptionist}:
              </span>
              {e.text}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { Lang } from "@/lib/sectors";
import { CONTROL_BUTTON } from "./controlButton";

/**
 * COPY REPLY (owner-machine 7.7): copies the Current_Reply with the Clipboard API (HTTPS and
 * localhost). Where it is missing or refused, the reply is shown selected in a read-only
 * text box with "Press Ctrl+C". The result is reported to the page's live region through
 * `onResult`, and also shown as visible text.
 */
export function CopyReplyButton({
  reply,
  replyLang,
  label,
  copiedText,
  fallbackHint,
  disabled,
  onResult,
}: {
  reply: string | null;
  replyLang: Lang | null;
  label: string;
  copiedText: string;
  fallbackHint: string;
  disabled: boolean;
  onResult: (text: string) => void;
}) {
  const [result, setResult] = useState<{ reply: string; kind: "copied" | "manual" } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // The note belongs to the reply it was about; another Message shows none.
  const shown = result !== null && result.reply === reply ? result.kind : null;

  useEffect(() => {
    if (shown === "manual") box.current?.select();
  }, [shown]);

  async function copy() {
    if (reply === null) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(reply);
      setResult({ reply, kind: "copied" });
      onResult(copiedText);
    } catch {
      setResult({ reply, kind: "manual" });
      onResult(fallbackHint);
    }
  }

  return (
    <>
      <button type="button" disabled={disabled || reply === null} onClick={copy} className={CONTROL_BUTTON}>
        <Copy aria-hidden="true" size={18} />
        {label}
      </button>
      {shown === "copied" && (
        <span data-copied="" className="basis-full font-inter text-sm font-semibold text-gold-text">
          {copiedText}
        </span>
      )}
      {shown === "manual" && reply !== null && (
        <span className="flex basis-full flex-col gap-1">
          <span className="font-inter text-sm text-text">{fallbackHint}</span>
          <textarea
            ref={box}
            readOnly
            lang={replyLang ?? undefined}
            aria-label={label}
            value={reply}
            rows={3}
            className="focus-ring w-full rounded-xl border border-border bg-card p-3 font-caveat text-xl text-text"
          />
        </span>
      )}
    </>
  );
}

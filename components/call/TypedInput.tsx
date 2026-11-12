"use client";

import { useState } from "react";
import { MAX_UTTERANCE } from "@/lib/voice/turnRequest";
import { TYPED_INPUT_ID } from "./useCallLoop";

export interface TypedInputProps {
  enabled: boolean;
  label: string;
  placeholder: string;
  sendLabel: string;
  onSend: (text: string) => void;
}

/** The Typed_Mode text field: each line goes to the same Turn_API as a spoken one (2.8). */
export function TypedInput({ enabled, label, placeholder, sendLabel, onSend }: TypedInputProps) {
  const [text, setText] = useState("");
  const canSend = enabled && text.trim() !== "";

  return (
    <form
      className="flex w-full flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSend) return;
        onSend(text);
        setText("");
      }}
    >
      <label htmlFor={TYPED_INPUT_ID} className="sr-only">
        {label}
      </label>
      <input
        id={TYPED_INPUT_ID}
        type="text"
        autoComplete="off"
        enterKeyHint="send"
        maxLength={MAX_UTTERANCE}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        aria-disabled={!enabled}
        className="min-h-12 w-full min-w-0 flex-1 rounded-2xl border border-border bg-card px-4 font-inter text-base text-text placeholder:text-muted"
      />
      <button
        type="submit"
        disabled={!canSend}
        className="min-h-12 rounded-full border-2 border-ink bg-card px-6 font-inter text-base font-semibold text-ink hover:bg-section disabled:cursor-not-allowed disabled:opacity-60"
      >
        {sendLabel}
      </button>
    </form>
  );
}

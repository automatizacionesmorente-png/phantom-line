"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Lang } from "@/lib/conversation/types";
import { createNeuralVoicePort } from "@/lib/voice/neuralVoice";
import { defaultLang } from "@/lib/voice/publicShop";
import { createWebSpeechPort } from "@/lib/voice/speechPort";
import { createCallSession, type CallSession } from "./callSession";

/** The id of the Typed_Mode text field, focused when the reducer asks for it. */
export const TYPED_INPUT_ID = "typed-line";

export interface UseCallLoopOptions {
  shopId: string;
  languages: readonly Lang[];
  /** Service names for speech-recognition biasing. */
  speechPhrases: readonly string[];
}

/**
 * Runs one Call in the browser: the pure `callLoop` reducer, the Web Speech
 * port and `fetch`, through `createCallSession`. The session is created
 * without touching `window` and attached after mount, so server rendering and
 * hydration see the same idle state.
 */
export function useCallLoop({ shopId, languages, speechPhrases }: UseCallLoopOptions) {
  const [session] = useState<CallSession>(() =>
    createCallSession({
      shopId,
      lang: languages[0] ?? "es",
      // The field may appear in the same render that asks for focus: wait one tick.
      focusInput: () => setTimeout(() => document.getElementById(TYPED_INPUT_ID)?.focus(), 0),
    }),
  );
  // Fixed for the life of the page, so a re-render never re-attaches mid-call.
  const [setup] = useState(() => ({ languages, speechPhrases, shopId }));

  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  useEffect(
    () =>
      session.attach({
        // The neural voice speaks when the reply carries a speech hint; the Web Speech port listens,
        // and speaks every reply the neural voice cannot (natural-voice 10.5).
        port: createNeuralVoicePort(window, createWebSpeechPort(window, { phrases: setup.speechPhrases }), {
          shopId: setup.shopId,
          now: () => performance.now(),
        }),
        target: window,
        lang: defaultLang(navigator.language, setup.languages),
      }),
    [session, setup],
  );

  const { dispatch } = session;
  return {
    state: snapshot.loop,
    interim: snapshot.interim,
    pressCall: useCallback(() => dispatch({ type: "PRESS_CALL" }), [dispatch]),
    hangUp: useCallback(() => dispatch({ type: "HANG_UP" }), [dispatch]),
    switchLang: useCallback((lang: Lang) => dispatch({ type: "SWITCH_LANG", lang }), [dispatch]),
    typeInstead: useCallback(() => dispatch({ type: "TYPE_INSTEAD" }), [dispatch]),
    sendTyped: useCallback((text: string) => dispatch({ type: "TYPED", text }), [dispatch]),
    callAgain: useCallback(() => session.reset(), [session]),
  };
}

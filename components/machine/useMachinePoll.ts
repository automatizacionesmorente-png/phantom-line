"use client";

import { useEffect, useRef, useState } from "react";
import type { PollChanged, PollCounts, PollResponse } from "@/lib/owner/api";
import { pollLoop, startPollLoop, type PollEffect, type PollEvent, type PollState } from "@/lib/owner/pollLoop";

/** Each Poll gives up after this long, so Polls never pile up (design, "The Machine_Page"). */
export const POLL_TIMEOUT_MS = 4000;
/** At most one INPUT event per second reaches the loop (design, "Idle slowdown"). */
export const INPUT_THROTTLE_MS = 1000;

export const pollUrl = (shopId: string, since: number) => `/api/machine/${encodeURIComponent(shopId)}?since=${since}`;

export interface MachinePollOptions {
  shopId: string;
  version: number;
  tapeIds: readonly string[];
  /** A full body newer than what the page shows: the Tape and the Agenda (12.3). */
  onApply: (res: PollChanged) => void;
  onCounts?: (counts: PollCounts) => void;
  /** 401: back to the PIN_Gate (12.7). */
  onLocked: () => void;
}

/**
 * Runs the pure `pollLoop` reducer (lib/owner/pollLoop.ts) in the browser: the one timer,
 * `fetch` with a 4-second timeout, `visibilitychange` (12.6), and pointer, touch and key
 * input on the document, throttled to one INPUT a second (12.9). Time enters the loop only
 * through `Date.now()` in the events. Returns whether the "Offline, retrying" note shows.
 */
export function useMachinePoll(opts: MachinePollOptions): { offline: boolean } {
  const [offline, setOffline] = useState(false);
  const callbacks = useRef({ onApply: opts.onApply, onCounts: opts.onCounts, onLocked: opts.onLocked });
  const start = useRef({ version: opts.version, tapeIds: opts.tapeIds });
  const { shopId } = opts;

  useEffect(() => {
    callbacks.current = { onApply: opts.onApply, onCounts: opts.onCounts, onLocked: opts.onLocked };
  }, [opts.onApply, opts.onCounts, opts.onLocked]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastInput = -Infinity;
    let state: PollState;

    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const dispatch = (e: PollEvent) => {
      if (disposed) return;
      const [next, effects] = pollLoop(state, e);
      state = next;
      for (const effect of effects) runEffect(effect);
    };

    const fetchPoll = async (since: number) => {
      let res: Response;
      try {
        res = await fetch(pollUrl(shopId, since), {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
      } catch {
        return dispatch({ type: "FAILED" });
      }
      if (disposed) return;
      if (res.status === 401) return dispatch({ type: "UNAUTHORIZED" });
      if (!res.ok) return dispatch({ type: "FAILED" });
      let body: PollResponse;
      try {
        body = (await res.json()) as PollResponse;
      } catch {
        return dispatch({ type: "FAILED" });
      }
      dispatch({ type: "OK", res: body, at: Date.now() });
    };

    function runEffect(effect: PollEffect): void {
      switch (effect.type) {
        case "fetch":
          void fetchPoll(effect.since);
          return;
        case "schedule":
          clear();
          timer = setTimeout(() => {
            timer = undefined;
            dispatch({ type: "TICK", at: Date.now() });
          }, effect.ms);
          return;
        case "cancel":
          clear();
          return;
        case "apply":
          callbacks.current.onApply(effect.res);
          return;
        case "counts":
          callbacks.current.onCounts?.(effect.counts);
          return;
        case "showOffline":
          setOffline(effect.on);
          return;
        case "toGate":
          callbacks.current.onLocked();
          return;
      }
    }

    const [first, effects] = startPollLoop({
      version: start.current.version,
      tapeIds: start.current.tapeIds,
      at: Date.now(),
      visible: document.visibilityState !== "hidden",
    });
    state = first;
    for (const effect of effects) runEffect(effect);

    const onVisibility = () =>
      dispatch(document.visibilityState === "hidden" ? { type: "HIDDEN" } : { type: "VISIBLE", at: Date.now() });
    const onInput = () => {
      const at = Date.now();
      if (at - lastInput < INPUT_THROTTLE_MS) return;
      lastInput = at;
      dispatch({ type: "INPUT", at });
    };
    const inputEvents = ["pointerdown", "keydown", "touchstart"] as const;
    document.addEventListener("visibilitychange", onVisibility);
    for (const name of inputEvents) document.addEventListener(name, onInput, { passive: true });

    return () => {
      disposed = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
      for (const name of inputEvents) document.removeEventListener(name, onInput);
    };
  }, [shopId]);

  return { offline };
}

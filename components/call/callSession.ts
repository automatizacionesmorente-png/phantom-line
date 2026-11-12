import type { Lang, TurnOutput } from "@/lib/conversation/types";
import { callLoop, initialCallLoop, type CallEffect, type CallEvent, type CallLoopState } from "@/lib/voice/callLoop";
import { createTypedOnlyPort, listenEvent, speakEvent, type SpeechPort } from "@/lib/voice/speechPort";
import type { TurnRequest } from "@/lib/voice/turnRequest";

/**
 * The engine behind `useCallLoop`: it holds the pure `callLoop` reducer's
 * state and runs its effects on a SpeechPort and on `fetch`. It has no React
 * in it, so tests drive it with the fake speech port, a mocked `fetch` and a
 * plain EventTarget standing in for `window`.
 *
 * Lifecycle: created without any browser object (safe during server
 * rendering), then `attach`ed in an effect with the real port and window.
 */
export const TURN_ENDPOINT = "/api/turn";

export interface CallSessionSnapshot {
  loop: CallLoopState;
  /** Interim recognition text, shown greyed while the caller speaks. */
  interim: string;
}

export interface AttachOptions {
  port: SpeechPort;
  /** Receives `pagehide` (the real `window` in the browser). */
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** The language to start with (from `navigator.language`). Applied only while idle. */
  lang?: Lang;
}

export interface CallSessionOptions {
  shopId: string;
  lang: Lang;
  fetch?: typeof fetch;
  endpoint?: string;
  /** The 15-second bound on each Turn request (2.10). */
  timeoutSignal?: (ms: number) => AbortSignal;
  focusInput?: () => void;
}

export interface CallSession {
  getSnapshot(): CallSessionSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(event: CallEvent): void;
  /** Starts a new Call after the previous one ended. */
  reset(): void;
  /** Connects the port and the window; returns the detach function. */
  attach(opts: AttachOptions): () => void;
}

export function createCallSession(opts: CallSessionOptions): CallSession {
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const endpoint = opts.endpoint ?? TURN_ENDPOINT;
  const timeoutSignal = opts.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms));

  let port: SpeechPort = createTypedOnlyPort();
  // Before `attach` nothing is known about the browser: render as if voice works,
  // so the server HTML and the first client render match.
  let snapshot: CallSessionSnapshot = {
    loop: initialCallLoop({ shopId: opts.shopId, lang: opts.lang, recognition: true, synthesis: true }),
    interim: "",
  };
  const listeners = new Set<() => void>();

  function set(next: Partial<CallSessionSnapshot>) {
    snapshot = { ...snapshot, ...next };
    for (const l of listeners) l();
  }

  function dispatch(event: CallEvent) {
    const [loop, effects] = callLoop(snapshot.loop, event);
    if (loop !== snapshot.loop) set({ loop });
    for (const effect of effects) run(effect);
  }

  function run(effect: CallEffect) {
    switch (effect.type) {
      case "listen": {
        const p = port;
        void p
          .listen({ lang: effect.lang, onInterim: (text) => set({ interim: text }) })
          .then((r) => {
            if (snapshot.interim !== "") set({ interim: "" });
            if (p === port) dispatch(listenEvent(r));
          });
        return;
      }
      case "speak": {
        const p = port;
        void p.speak(effect.text, effect.lang).then((r) => {
          if (p === port) dispatch(speakEvent(r));
        });
        return;
      }
      case "post":
        void postTurn(effect.body, effect.timeoutMs);
        return;
      case "stopSpeech":
        port.stop();
        if (snapshot.interim !== "") set({ interim: "" });
        return;
      case "focusInput":
        opts.focusInput?.();
        return;
      case "beaconHangup":
        sendHangup(effect.body);
        return;
    }
  }

  async function postTurn(body: TurnRequest, timeoutMs: number) {
    let out: TurnOutput;
    try {
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: timeoutSignal(timeoutMs),
      });
      if (!res.ok) throw new Error(`turn ${res.status}`);
      out = (await res.json()) as TurnOutput;
    } catch {
      // A timeout, a network failure or an error status all stop the Call with
      // the line-cut notice (2.10). The reducer sends the hang-up when a Call exists.
      dispatch({ type: "CLIENT_TIMEOUT" });
      return;
    }
    dispatch({ type: "REPLY", out });
  }

  /** `keepalive` lets the request outlive the page (tab closed, navigation). */
  function sendHangup(body: Extract<TurnRequest, { kind: "hangup" }>) {
    try {
      void doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* nothing more can be done while the page goes away */
    }
  }

  function fresh(lang: Lang): CallLoopState {
    return initialCallLoop({
      shopId: opts.shopId,
      lang,
      recognition: port.supports.recognition,
      synthesis: port.supports.synthesis,
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch,
    reset() {
      if (snapshot.loop.phase !== "ended") return;
      set({ loop: fresh(snapshot.loop.lang), interim: "" });
    },
    attach({ port: next, target, lang }) {
      port = next;
      if (snapshot.loop.phase === "idle") set({ loop: fresh(lang ?? snapshot.loop.lang), interim: "" });
      const onPageHide = () => dispatch({ type: "HANG_UP" });
      target.addEventListener("pagehide", onPageHide);
      return () => {
        target.removeEventListener("pagehide", onPageHide);
        // Leaving the page in the app (unmount) ends a running Call like closing the tab.
        dispatch({ type: "HANG_UP" });
        next.stop();
        if (port === next) port = createTypedOnlyPort();
      };
    },
  };
}

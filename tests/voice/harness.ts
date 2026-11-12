import { expect } from "vitest";
import type { Lang, Outcome, TurnOutput } from "@/lib/conversation/types";
import {
  callLoop,
  initialCallLoop,
  type CallEffect,
  type CallEvent,
  type CallLoopInit,
  type CallLoopState,
} from "@/lib/voice/callLoop";
import { listenEvent, speakEvent, type SpeechPort } from "@/lib/voice/speechPort";
import { TurnRequestSchema, type TurnRequest } from "@/lib/voice/turnRequest";

/**
 * Runs the pure reducer the way `useCallLoop` will: every effect goes to a
 * SpeechPort (the fake one in tests) or to a scripted server, and their
 * results come back as events. Nothing here touches a browser or the network.
 */
export const CALL_ID = "4f9c2b1e-8a3d-4c6e-9b7a-1d2e3f4a5b6c";

export type ServerAnswer = TurnOutput | "timeout" | "pending";
export type Server = (body: TurnRequest) => ServerAnswer;

export function reply(text: string, opts: { complete?: boolean; language?: Lang; outcome?: Outcome; callId?: string } = {}): TurnOutput {
  const complete = opts.complete ?? false;
  return {
    callId: opts.callId ?? CALL_ID,
    reply: text,
    language: opts.language ?? "es",
    state: { intent: "booking", fields: { name: null, phone: null, service: null, requestedTime: null }, complete },
    complete,
    ...(complete ? { outcome: opts.outcome ?? "booked" } : {}),
  };
}

/** A server that answers the queued replies in order and records every body. */
export function scriptedServer(answers: readonly ServerAnswer[]): Server & { bodies: TurnRequest[] } {
  const queue = [...answers];
  const bodies: TurnRequest[] = [];
  const server = (body: TurnRequest): ServerAnswer => {
    bodies.push(body);
    return queue.shift() ?? "pending";
  };
  return Object.assign(server, { bodies });
}

export interface Harness {
  readonly state: CallLoopState;
  /** Every effect, in order, tagged with the step that emitted it. */
  readonly log: { step: number; effect: CallEffect }[];
  readonly events: CallEvent[];
  readonly beacons: TurnRequest[];
  dispatch(event: CallEvent): void;
  /** Lets every pending promise of the port and the server settle. */
  settle(): Promise<void>;
}

export function createHarness(init: Partial<CallLoopInit> & { port: SpeechPort; server: Server }): Harness {
  let state = initialCallLoop({
    shopId: init.shopId ?? "peluqueria-lola",
    lang: init.lang ?? "es",
    recognition: init.recognition ?? init.port.supports.recognition,
    synthesis: init.synthesis ?? init.port.supports.synthesis,
  });
  const log: { step: number; effect: CallEffect }[] = [];
  const events: CallEvent[] = [];
  const beacons: TurnRequest[] = [];
  let step = 0;

  function dispatch(event: CallEvent) {
    events.push(event);
    const [next, effects] = callLoop(state, event);
    state = next;
    step++;
    for (const effect of effects) {
      log.push({ step, effect });
      run(effect);
    }
  }

  function run(effect: CallEffect) {
    switch (effect.type) {
      case "listen":
        void init.port.listen({ lang: effect.lang }).then((r) => dispatch(listenEvent(r)));
        return;
      case "speak":
        void init.port.speak(effect.text, effect.lang).then((r) => dispatch(speakEvent(r)));
        return;
      case "post": {
        // Every body the browser sends must pass the server's strict schema.
        expect(TurnRequestSchema.safeParse(effect.body).success).toBe(true);
        expect(effect.timeoutMs).toBe(15_000);
        const answer = init.server(effect.body);
        if (answer === "pending") return;
        void Promise.resolve().then(() => dispatch(answer === "timeout" ? { type: "CLIENT_TIMEOUT" } : { type: "REPLY", out: answer }));
        return;
      }
      case "stopSpeech":
        init.port.stop();
        return;
      case "beaconHangup":
        expect(TurnRequestSchema.safeParse(effect.body).success).toBe(true);
        beacons.push(effect.body);
        return;
      case "focusInput":
        return;
    }
  }

  return {
    get state() {
      return state;
    },
    log,
    events,
    beacons,
    dispatch,
    async settle() {
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    },
  };
}

export const effectsOf = (h: Harness, type: CallEffect["type"]) => h.log.filter((l) => l.effect.type === type).map((l) => l.effect);

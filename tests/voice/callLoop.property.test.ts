import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { TurnOutput } from "@/lib/conversation/types";
import {
  callLoop,
  canTypeInstead,
  initialCallLoop,
  type CallEvent,
  type CallPhase,
  type SpeechErrorKind,
} from "@/lib/voice/callLoop";
import { TurnRequestSchema } from "@/lib/voice/turnRequest";
import { CALL_ID, reply } from "./harness";

/**
 * S5 (Requirements 2.11, 2.12): for all event sequences, the Call reaches
 * `ended` only through HANG_UP, CLIENT_TIMEOUT or a REPLY with
 * `complete: true`, and "type instead" is available, and works, in every
 * phase except `ended`. The same run also checks two contracts the hook
 * relies on: recognition is never started in the step that starts speaking
 * (2.9), and every body the browser would send passes the server's schema.
 */
const OTHER_CALL = "0b8e7f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const SPEECH_ERRORS: SpeechErrorKind[] = [
  "no-speech",
  "aborted",
  "audio-capture",
  "network",
  "not-allowed",
  "service-not-allowed",
  "language-not-supported",
  "phrases-not-supported",
  "bad-grammar",
  "unavailable",
  "synthesis-unavailable",
  "synthesis-failed",
];

const arbLang = fc.constantFrom("es" as const, "en" as const);
const arbText = fc.oneof(fc.constantFrom("", "  ", "quiero un corte", "sí", "Ana"), fc.string({ maxLength: 600 }));
const arbReply: fc.Arbitrary<TurnOutput> = fc
  .record({
    text: fc.string({ minLength: 1, maxLength: 60 }),
    complete: fc.boolean(),
    language: arbLang,
    callId: fc.constantFrom(CALL_ID, CALL_ID, CALL_ID, OTHER_CALL),
  })
  .map(({ text, complete, language, callId }) => reply(text, { complete, language, callId }));

const arbEvent: fc.Arbitrary<CallEvent> = fc.oneof(
  { weight: 2, arbitrary: fc.constant<CallEvent>({ type: "PRESS_CALL" }) },
  { weight: 4, arbitrary: arbReply.map<CallEvent>((out) => ({ type: "REPLY", out })) },
  { weight: 4, arbitrary: arbText.map<CallEvent>((text) => ({ type: "RECOGNIZED", text })) },
  { weight: 3, arbitrary: arbText.map<CallEvent>((text) => ({ type: "TYPED", text })) },
  { weight: 4, arbitrary: fc.constant<CallEvent>({ type: "SPOKEN" }) },
  { weight: 4, arbitrary: fc.constantFrom(...SPEECH_ERRORS).map<CallEvent>((kind) => ({ type: "SPEECH_ERROR", kind })) },
  { weight: 2, arbitrary: arbLang.map<CallEvent>((lang) => ({ type: "SWITCH_LANG", lang })) },
  { weight: 2, arbitrary: fc.constant<CallEvent>({ type: "TYPE_INSTEAD" }) },
  { weight: 1, arbitrary: fc.constant<CallEvent>({ type: "HANG_UP" }) },
  { weight: 1, arbitrary: fc.constant<CallEvent>({ type: "CLIENT_TIMEOUT" }) },
);

const arbRun = fc.record({
  lang: arbLang,
  recognition: fc.boolean(),
  synthesis: fc.boolean(),
  events: fc.array(arbEvent, { minLength: 1, maxLength: 60 }),
});

const ENDING = new Set(["HANG_UP", "CLIENT_TIMEOUT", "REPLY"]);

describe("S5: the Call ends only by hang-up, client timeout or a complete reply", () => {
  it("holds for all event sequences, and type instead works in every non-ended phase", () => {
    const seenPhases = new Set<CallPhase>();
    const endedBy = new Set<string>();
    let speechErrorsWhileLive = 0;

    fc.assert(
      fc.property(arbRun, ({ lang, recognition, synthesis, events }) => {
        let state = initialCallLoop({ shopId: "peluqueria-lola", lang, recognition, synthesis });
        for (const event of events) {
          const before = state;
          const [next, effects] = callLoop(state, event);
          seenPhases.add(next.phase);

          if (before.phase === "ended") {
            // Nothing restarts after the end.
            expect(next.phase).toBe("ended");
            expect(effects.every((e) => e.type === "beaconHangup")).toBe(true);
          } else {
            if (event.type === "SPEECH_ERROR") speechErrorsWhileLive++;
            if (next.phase === "ended") {
              expect(ENDING.has(event.type)).toBe(true);
              if (event.type === "REPLY") expect(event.out.complete).toBe(true);
              endedBy.add(event.type);
            }
          }

          // "type instead" is available, and switching keeps the Call alive, in every non-ended phase (2.11).
          expect(canTypeInstead(next)).toBe(next.phase !== "ended");
          if (next.phase !== "ended") {
            const [typed] = callLoop(next, { type: "TYPE_INSTEAD" });
            expect(typed.phase).not.toBe("ended");
            expect(typed.typed).toBe(true);
          }

          // Recognition never starts in the step that starts speaking, and only when the phase is listening (2.9).
          const kinds = effects.map((e) => e.type);
          expect(kinds.includes("speak") && kinds.includes("listen")).toBe(false);
          if (kinds.includes("listen")) expect(next.phase).toBe("listening");

          // Every request the browser would send is accepted by the server's strict schema.
          for (const e of effects) {
            if (e.type === "post" || e.type === "beaconHangup") expect(TurnRequestSchema.safeParse(e.body).success).toBe(true);
          }
          state = next;
        }
      }),
      { numRuns: 500 },
    );

    // The generator really reaches every phase and every way of ending, so the property is not vacuous.
    expect([...seenPhases].sort()).toEqual(["ended", "idle", "listening", "speaking", "starting", "thinking", "typing"]);
    expect([...endedBy].sort()).toEqual(["CLIENT_TIMEOUT", "HANG_UP", "REPLY"]);
    expect(speechErrorsWhileLive).toBeGreaterThan(100);
  });
});

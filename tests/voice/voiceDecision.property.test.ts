import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  initialVoiceDecision,
  TTS_DEADLINE_MS,
  voiceDecision,
  type FailureKind,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceMode,
} from "@/lib/voice/voiceDecision";

/**
 * N12 (natural-voice design.md): the player never stays silent and never speaks twice.
 * For all event sequences (chunks at random times, deadline, errors, stalls, end), the reducer
 * ends in `done` once the world finishes (the stream ends or stalls, the element ends, the
 * browser voice finishes). Neural audio never starts at or after the deadline, and nothing after
 * the deadline or a fallback starts it. The browser voice speaks at most once, after the neural
 * audio was stopped. Exactly one voice speaks the reply, except a stall after the neural audio
 * started, which repeats the whole reply with the browser voice (design.md, step 5). `done`
 * comes only after the voice that spoke has ended. Validates 2.5, 4.1, 4.3, 1.8.
 */
const KINDS: FailureKind[] = ["quota", "rate_limit", "unavailable", "token", "network", "playback_error"];

type Draft =
  | { type: "CHUNK"; ms: number }
  | { type: "ENDED" | "STARTED" | "UNDERRUN" | "PLAYBACK_ENDED" | "DEADLINE" | "STALL_TICK" | "FALLBACK_ENDED" }
  | { type: "ERROR"; kind: FailureKind };

const arbDraft: fc.Arbitrary<Draft> = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: 0, max: 900 }).map<Draft>((ms) => ({ type: "CHUNK", ms })) },
  { weight: 2, arbitrary: fc.constant<Draft>({ type: "ENDED" }) },
  { weight: 2, arbitrary: fc.constant<Draft>({ type: "STARTED" }) },
  { weight: 1, arbitrary: fc.constant<Draft>({ type: "UNDERRUN" }) },
  { weight: 1, arbitrary: fc.constant<Draft>({ type: "PLAYBACK_ENDED" }) },
  { weight: 1, arbitrary: fc.constant<Draft>({ type: "DEADLINE" }) },
  { weight: 3, arbitrary: fc.constant<Draft>({ type: "STALL_TICK" }) },
  { weight: 1, arbitrary: fc.constant<Draft>({ type: "FALLBACK_ENDED" }) },
  { weight: 1, arbitrary: fc.constantFrom(...KINDS).map<Draft>((kind) => ({ type: "ERROR", kind })) },
);
/** Events at non-decreasing times: gaps of 0–1 600 ms, so deadlines and stalls happen often but not always. */
const arbEvents = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 1600 }), arbDraft), { maxLength: 30 })
  .map((xs) => {
    let at = 0;
    return xs.map(([gap, d]) => ({ ...d, at: (at += gap) }) as VoiceEvent);
  });
const arbRun = fc.record({ mode: fc.constantFrom<VoiceMode>("stream", "element"), events: arbEvents });

/** What the world does at the end: the stream closes, time passes, the element and the browser voice finish. */
function drain(lastAt: number): VoiceEvent[] {
  const far = lastAt + 100_000;
  return [
    { type: "ENDED", at: lastAt },
    { type: "STALL_TICK", at: far },
    { type: "PLAYBACK_ENDED", at: far + 1 },
    { type: "FALLBACK_ENDED", at: far + 2 },
  ];
}

describe("N12: the player never stays silent and never speaks twice", () => {
  it("holds for all event sequences in both modes", { timeout: 120_000 }, () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(arbRun, ({ mode, events }) => {
        let state = initialVoiceDecision(mode);
        const all = [...events, ...drain(events.at(-1)?.at ?? 0)];
        const effects: { at: number; e: VoiceEffect }[] = [];
        let startedAt: number | null = null;
        let acceptedMs = 0;
        let fallbackEndedSeen = false;
        let playbackEndedSeen = false;
        let endedSeen = false;

        for (const event of all) {
          const before = state;
          const [next, out] = voiceDecision(state, event);
          for (const e of out) effects.push({ at: event.at, e });

          if (!before.neuralStarted && next.neuralStarted) {
            // Neural audio starts only before the deadline, never after a fallback.
            expect(event.at).toBeLessThan(TTS_DEADLINE_MS);
            expect(before.fallback).toBeNull();
            startedAt = event.at;
          }
          if (event.type === "CHUNK" && (before.phase === "waiting" || before.phase === "buffering" || before.phase === "playing") && !before.sourceEnded && next.phase !== "fallback") {
            if (mode === "stream" && event.ms > 0 && !(before.phase !== "playing" && event.at >= TTS_DEADLINE_MS)) acceptedMs += event.ms;
          }
          if (event.type === "ENDED") endedSeen = true;
          if (before.phase === "fallback" && event.type === "FALLBACK_ENDED") fallbackEndedSeen = true;
          if (event.type === "PLAYBACK_ENDED") playbackEndedSeen = true;

          // A fallback always stops the neural audio first, in the same step.
          const kinds = out.map((e) => e.type);
          if (kinds.includes("fallback")) expect(kinds.indexOf("stopNeural")).toBeGreaterThanOrEqual(0);
          if (kinds.includes("fallback")) expect(kinds.indexOf("stopNeural")).toBeLessThan(kinds.indexOf("fallback"));

          if (next.phase === "done" && before.phase !== "done") {
            if (next.doneBy === "browser") expect(fallbackEndedSeen).toBe(true);
            if (next.doneBy === "neural") {
              expect(startedAt).not.toBeNull();
              if (mode === "stream") {
                // Everything the stream delivered has had time to play.
                expect(endedSeen).toBe(true);
                expect(event.at - startedAt!).toBeGreaterThanOrEqual(acceptedMs);
              } else {
                expect(playbackEndedSeen).toBe(true);
              }
            }
          }
          state = next;
        }

        // It ends, and exactly one `finish`, as the last effect.
        expect(state.phase).toBe("done");
        const types = effects.map((x) => x.e.type);
        expect(types.filter((t) => t === "finish")).toHaveLength(1);
        expect(types.at(-1)).toBe("finish");
        // Never silent: some voice spoke.
        expect(state.neuralStarted || state.fallback !== null).toBe(true);
        // Never twice: at most one start, one fallback, one report.
        expect(types.filter((t) => t === "play").length).toBeLessThanOrEqual(1);
        expect(types.filter((t) => t === "fallback").length).toBeLessThanOrEqual(1);
        expect(types.filter((t) => t === "report").length).toBeLessThanOrEqual(1);
        if (mode === "element") expect(types.includes("play")).toBe(false);
        // Both voices only when the neural audio stalled or failed after it started.
        if (state.neuralStarted && state.fallback !== null) expect(["stall", "playback_error"]).toContain(state.fallback);
        if (state.doneBy === "neural") expect(state.fallback).toBeNull();
        // quotaOut exactly on a quota answer; a report exactly for the reasons the browser decided.
        expect(types.includes("quotaOut")).toBe(state.fallback === "quota");
        const reported = ["deadline", "stall", "playback_error", "network"].includes(state.fallback ?? "");
        expect(types.includes("report")).toBe(reported);
        // Nothing starts the neural audio after the deadline or a fallback.
        const playAt = effects.find((x) => x.e.type === "play")?.at;
        const fallbackAt = effects.find((x) => x.e.type === "fallback")?.at;
        if (playAt !== undefined) expect(playAt).toBeLessThan(TTS_DEADLINE_MS);
        if (playAt !== undefined && fallbackAt !== undefined) expect(types.indexOf("play")).toBeLessThan(types.indexOf("fallback"));

        seen.add(`${mode}:${state.doneBy}:${state.fallback ?? "none"}`);
      }),
      { numRuns: 1000 },
    );

    // The generator reaches the interesting outcomes, so the property is not vacuous.
    for (const mode of ["stream", "element"]) {
      expect(seen).toContain(`${mode}:neural:none`);
      expect(seen).toContain(`${mode}:browser:deadline`);
      expect(seen).toContain(`${mode}:browser:stall`);
      expect(seen).toContain(`${mode}:browser:quota`);
    }
    expect(seen).toContain("stream:browser:network");
    expect(seen).toContain("element:browser:playback_error");
  });
});

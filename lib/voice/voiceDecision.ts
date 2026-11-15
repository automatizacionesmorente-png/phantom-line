/**
 * The player's decisions for one reply, as a pure reducer (natural-voice design.md, "Browser:
 * the VoicePort", steps 2 to 5). The browser code in `neuralVoice.ts` only runs the effects and
 * feeds back events with the time `at` in ms since the reply's audio was asked for.
 *
 * Two modes:
 * - `stream`: live PCM from POST /api/speech. `CHUNK` carries the milliseconds of *output* audio
 *   (after time-stretching), so the 300 ms start buffer and the stall rule count what the caller
 *   will hear. Playback starts once 300 ms are buffered, or the stream has ended.
 * - `element`: a cached line in an `<audio>` element, which buffers by itself. `STARTED` is its
 *   `playing` event, `UNDERRUN` its `waiting` event, `PLAYBACK_ENDED` its `ended` event.
 *
 * Rules (property N12):
 * - no neural audio starts at or after `TTS_DEADLINE_MS`; a reply with no audio by then is spoken
 *   by the browser voice, and audio for it that arrives later is dropped;
 * - the browser voice speaks a reply at most once, and the neural audio is stopped first;
 * - a stall (no audio to play for more than `STALL_LIMIT_MS` before the stream ended) stops the
 *   neural audio and speaks the whole reply with the browser voice (repeating the start is better
 *   than silence);
 * - the reply is `done` only after the voice that spoke it has finished.
 */

export const TTS_DEADLINE_MS = 2500;
/** Output audio buffered before live playback starts. */
export const START_BUFFER_MS = 300;
export const STALL_LIMIT_MS = 3000;

export type VoiceMode = "stream" | "element";

/**
 * Why the neural voice failed. `quota`, `rate_limit`, `unavailable` and `token` come from the
 * TTS_API's status, which the server already logged; `network` and `playback_error` are seen
 * only by the browser.
 */
export type FailureKind = "quota" | "rate_limit" | "unavailable" | "token" | "network" | "playback_error";
export type FallbackReason = FailureKind | "deadline" | "stall";
/** The reasons the browser reports itself (the `report` body's enum). */
export type ReportReason = "deadline" | "stall" | "playback_error" | "network";

export type VoicePhase = "waiting" | "buffering" | "playing" | "fallback" | "done";

export interface VoiceDecisionState {
  mode: VoiceMode;
  phase: VoicePhase;
  /** Output audio received while buffering, in ms. */
  queuedMs: number;
  /** Stream mode while playing: when the scheduled audio ends, on the reply's clock. */
  scheduledUntil: number;
  /** Element mode while playing: since when the element has been waiting for data. */
  waitingSince: number | null;
  /** No more audio will arrive (the stream closed). */
  sourceEnded: boolean;
  neuralStarted: boolean;
  fallback: FallbackReason | null;
  doneBy: "neural" | "browser" | null;
}

export type VoiceEvent =
  | { type: "CHUNK"; at: number; ms: number }
  | { type: "ENDED"; at: number }
  | { type: "STARTED"; at: number }
  | { type: "UNDERRUN"; at: number }
  | { type: "PLAYBACK_ENDED"; at: number }
  | { type: "DEADLINE"; at: number }
  | { type: "ERROR"; at: number; kind: FailureKind }
  | { type: "STALL_TICK"; at: number }
  | { type: "FALLBACK_ENDED"; at: number };

export type VoiceEffect =
  /** Stream mode: start playing the buffered audio now; later chunks are scheduled as they come. */
  | { type: "play" }
  /** Stop the neural audio and abort its request. */
  | { type: "stopNeural" }
  /** Speak the whole reply with the browser voice, at rate 1.0. */
  | { type: "fallback"; reason: FallbackReason }
  /** One small `report` request to the TTS_API, for a fallback the browser decided. */
  | { type: "report"; reason: ReportReason; latencyMs: number }
  /** A 429 quota answer: no more TTS requests for the rest of the Call (4.4). */
  | { type: "quotaOut" }
  /** The reply has been spoken; the call loop may listen again (1.8). */
  | { type: "finish"; by: "neural" | "browser" };

export function initialVoiceDecision(mode: VoiceMode): VoiceDecisionState {
  return {
    mode,
    phase: "waiting",
    queuedMs: 0,
    scheduledUntil: 0,
    waitingSince: null,
    sourceEnded: false,
    neuralStarted: false,
    fallback: null,
    doneBy: null,
  };
}

type Step = [VoiceDecisionState, VoiceEffect[]];

const REPORTED: Partial<Record<FallbackReason, ReportReason>> = {
  deadline: "deadline",
  stall: "stall",
  playback_error: "playback_error",
  network: "network",
};

export function voiceDecision(state: VoiceDecisionState, event: VoiceEvent): Step {
  switch (state.phase) {
    case "done":
      return [state, []];
    case "fallback":
      if (event.type === "FALLBACK_ENDED") return [{ ...state, phase: "done", doneBy: "browser" }, [{ type: "finish", by: "browser" }]];
      return [state, []]; // late audio, ends and errors for this reply are dropped
    case "waiting":
    case "buffering":
      return beforeStart(state, event);
    case "playing":
      return state.mode === "stream" ? playingStream(state, event) : playingElement(state, event);
  }
}

function toFallback(state: VoiceDecisionState, reason: FallbackReason, at: number, stopFirst: boolean): Step {
  const effects: VoiceEffect[] = [];
  if (stopFirst) effects.push({ type: "stopNeural" });
  if (reason === "quota") effects.push({ type: "quotaOut" });
  effects.push({ type: "fallback", reason });
  const report = REPORTED[reason];
  if (report) effects.push({ type: "report", reason: report, latencyMs: Math.max(0, Math.min(60_000, Math.round(at))) });
  return [{ ...state, phase: "fallback", fallback: reason }, effects];
}

function beforeStart(state: VoiceDecisionState, event: VoiceEvent): Step {
  // The deadline holds for every event: nothing neural starts at or after it.
  if (event.at >= TTS_DEADLINE_MS && event.type !== "FALLBACK_ENDED") return toFallback(state, "deadline", event.at, true);

  switch (event.type) {
    case "ERROR":
      return toFallback(state, event.kind, event.at, true);
    case "CHUNK": {
      if (state.mode !== "stream" || event.ms <= 0) return [state, []];
      const queuedMs = state.queuedMs + event.ms;
      if (queuedMs >= START_BUFFER_MS) return start({ ...state, queuedMs }, event.at);
      return [{ ...state, phase: "buffering", queuedMs }, []];
    }
    case "ENDED":
      if (state.mode !== "stream") return [state, []];
      // A stream that closed with no audio at all is a failure; with some audio, play it.
      if (state.queuedMs <= 0) return toFallback(state, "network", event.at, true);
      return start({ ...state, sourceEnded: true }, event.at);
    case "STARTED":
      if (state.mode !== "element") return [state, []];
      return [{ ...state, phase: "playing", neuralStarted: true, waitingSince: null }, []];
    default:
      return [state, []];
  }
}

function start(state: VoiceDecisionState, at: number): Step {
  return [{ ...state, phase: "playing", neuralStarted: true, scheduledUntil: at + state.queuedMs, queuedMs: 0 }, [{ type: "play" }]];
}

function playingStream(state: VoiceDecisionState, event: VoiceEvent): Step {
  switch (event.type) {
    case "CHUNK": {
      if (state.sourceEnded || event.ms <= 0) return [state, []];
      const next = checkStall(state, event.at);
      if (next) return next;
      // A chunk after a gap plays at once; otherwise it follows the scheduled audio.
      return [{ ...state, scheduledUntil: Math.max(state.scheduledUntil, event.at) + event.ms }, []];
    }
    case "ENDED":
      return drained({ ...state, sourceEnded: true }, event.at) ?? [{ ...state, sourceEnded: true }, []];
    case "ERROR":
      // The body broke after the first chunk: the caller would hear the rest missing (design.md: a stall).
      if (state.sourceEnded) return [state, []];
      return toFallback(state, "stall", event.at, true);
    case "STALL_TICK":
    case "DEADLINE":
    case "PLAYBACK_ENDED":
      // Time decides in stream mode: done once the stream ended and its scheduled audio has played.
      // (The runner also waits for the AudioContext's own clock before it resolves the reply.)
      return checkStall(state, event.at) ?? drained(state, event.at) ?? [state, []];
    default:
      return [state, []];
  }
}

function checkStall(state: VoiceDecisionState, at: number): Step | null {
  if (state.sourceEnded) return null;
  return at - state.scheduledUntil > STALL_LIMIT_MS ? toFallback(state, "stall", at, true) : null;
}

function drained(state: VoiceDecisionState, at: number): Step | null {
  return state.sourceEnded && at >= state.scheduledUntil
    ? [{ ...state, phase: "done", doneBy: "neural" }, [{ type: "finish", by: "neural" }]]
    : null;
}

function playingElement(state: VoiceDecisionState, event: VoiceEvent): Step {
  switch (event.type) {
    case "PLAYBACK_ENDED":
      return [{ ...state, phase: "done", doneBy: "neural" }, [{ type: "finish", by: "neural" }]];
    case "ERROR":
      return toFallback(state, event.kind === "playback_error" ? "playback_error" : "stall", event.at, true);
    case "UNDERRUN":
      return [{ ...state, waitingSince: state.waitingSince ?? event.at }, []];
    case "STARTED":
      return [{ ...state, waitingSince: null }, []];
    case "STALL_TICK":
    case "DEADLINE":
      if (state.waitingSince !== null && event.at - state.waitingSince > STALL_LIMIT_MS) return toFallback(state, "stall", event.at, true);
      return [state, []];
    default:
      return [state, []];
  }
}

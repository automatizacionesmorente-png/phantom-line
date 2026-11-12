import type { Lang, Line, Outcome, TurnOutput } from "@/lib/conversation/types";
import { MAX_CONVERSATION, MAX_UTTERANCE, type TurnRequest } from "./turnRequest";

/**
 * The browser side of the voice channel as a pure reducer (Requirement 2).
 * `callLoop(state, event)` returns the next state and the effects the
 * `useCallLoop` hook must run: listen, speak, post a Turn, focus the text
 * field, stop speech, send the hang-up beacon. No browser API is touched here,
 * so a whole Call can be driven in tests with a fake SpeechPort.
 *
 * Rules the reducer guarantees:
 * - recognition starts only after speaking ends, so the receptionist's own
 *   voice is never transcribed (2.9);
 * - a missing, denied or failing speech capability switches to Typed_Mode and
 *   never ends the Call (2.8, 2.12);
 * - "type instead" works in every phase except `ended` (2.11);
 * - the Call ends only on a hang-up, the 15-second client timeout (2.10) or a
 *   reply with `complete: true`.
 */

export const CLIENT_TIMEOUT_MS = 15_000;
/** Silences in a row after which the "you can type" hint is shown (recognition keeps going). */
export const NO_SPEECH_HINT_AFTER = 2;

export type CallPhase = "idle" | "starting" | "listening" | "thinking" | "speaking" | "typing" | "ended";

/** Web Speech recognition error codes, plus the port's own `unavailable` (no constructor, or `available()` said no). */
export type RecognitionErrorKind =
  | "no-speech"
  | "aborted"
  | "audio-capture"
  | "network"
  | "not-allowed"
  | "service-not-allowed"
  | "language-not-supported"
  | "phrases-not-supported"
  | "bad-grammar"
  | "unavailable";
/** Synthesis problems: no `speechSynthesis` or no voice for the language, or the utterance failed. */
export type SynthesisErrorKind = "synthesis-unavailable" | "synthesis-failed";
export type SpeechErrorKind = RecognitionErrorKind | SynthesisErrorKind;

/** Recognition errors that switch the Call to Typed_Mode (design, "Speech error mapping"). */
const TO_TYPED: ReadonlySet<SpeechErrorKind> = new Set<SpeechErrorKind>([
  "unavailable",
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "language-not-supported",
  "network",
  "phrases-not-supported",
  "bad-grammar",
]);

export type CallEvent =
  | { type: "PRESS_CALL" }
  | { type: "RECOGNIZED"; text: string }
  | { type: "TYPED"; text: string }
  | { type: "REPLY"; out: TurnOutput }
  | { type: "SPOKEN" }
  | { type: "SPEECH_ERROR"; kind: SpeechErrorKind }
  | { type: "SWITCH_LANG"; lang: Lang }
  | { type: "TYPE_INSTEAD" }
  | { type: "HANG_UP" }
  | { type: "CLIENT_TIMEOUT" };

export type CallEffect =
  | { type: "listen"; lang: Lang }
  | { type: "speak"; text: string; lang: Lang }
  | { type: "post"; body: TurnRequest; timeoutMs: number }
  | { type: "focusInput" }
  /** Stop recognition and synthesis now (hang-up, timeout, switching to typing mid-listen). */
  | { type: "stopSpeech" }
  /** Send `hangup` with `fetch(..., { keepalive: true })` so the Owner gets the Message. */
  | { type: "beaconHangup"; body: Extract<TurnRequest, { kind: "hangup" }> };

/** Texts the UI renders from `phrases()`; the reducer does not know the shop's wording. */
export type NoticeKey = "typeInstead" | "lineCut";
export type TranscriptEntry =
  | { who: "caller"; text: string }
  | { who: "receptionist"; text: string }
  | { who: "notice"; key: NoticeKey };

export interface CallLoopState {
  phase: CallPhase;
  shopId: string;
  lang: Lang;
  /** Issued by the server on `start`. */
  callId: string | null;
  /** Typed_Mode once true; never switches back by itself during a Call. */
  typed: boolean;
  recognition: boolean;
  synthesis: boolean;
  /** Languages with no synthesis voice: replies in them are shown only. */
  mutedLangs: readonly Lang[];
  /** Completed Turns, sent back to the server as context. */
  conversation: readonly Line[];
  /** The caller line waiting for its reply. */
  pending: string | null;
  transcript: readonly TranscriptEntry[];
  noSpeechStreak: number;
  showTypeHint: boolean;
  endReason: "hangup" | "timeout" | "complete" | null;
  outcome: Outcome | null;
}

export interface CallLoopInit {
  shopId: string;
  lang: Lang;
  /** What the SpeechPort can do at all (constructor / `speechSynthesis` present). */
  recognition: boolean;
  synthesis: boolean;
}

export function initialCallLoop(init: CallLoopInit): CallLoopState {
  return {
    phase: "idle",
    shopId: init.shopId,
    lang: init.lang,
    callId: null,
    typed: !init.recognition,
    recognition: init.recognition,
    synthesis: init.synthesis,
    mutedLangs: [],
    conversation: [],
    pending: null,
    transcript: [],
    noSpeechStreak: 0,
    showTypeHint: false,
    endReason: null,
    outcome: null,
  };
}

/** The "type instead" control is shown and works in every phase except `ended` (2.11). */
export function canTypeInstead(state: CallLoopState): boolean {
  return state.phase !== "ended";
}

/** The text field is usable whenever the Call runs in Typed_Mode and is not waiting for a reply. */
export function canType(state: CallLoopState): boolean {
  return state.typed && (state.phase === "typing" || state.phase === "speaking");
}

export const localeOf = (lang: Lang): "es-ES" | "en-US" => (lang === "es" ? "es-ES" : "en-US");

type Step = [CallLoopState, CallEffect[]];

export function callLoop(state: CallLoopState, event: CallEvent): Step {
  if (state.phase === "ended") return onEnded(state, event);

  switch (event.type) {
    case "PRESS_CALL":
      if (state.phase !== "idle") return [state, []];
      return [
        { ...state, phase: "starting" },
        [post({ kind: "start", shopId: state.shopId, language: state.lang })],
      ];

    case "REPLY":
      return onReply(state, event.out);

    case "RECOGNIZED":
      if (state.phase !== "listening") return [state, []];
      if (event.text.trim() === "") return onNoSpeech(state);
      return sendLine(state, event.text, []);

    case "TYPED": {
      if (event.text.trim() === "") return [state, []];
      if (state.phase === "typing") return sendLine(state, event.text, []);
      // A line typed while listening or speaking interrupts the voice and goes out at once.
      if (state.phase === "listening" || state.phase === "speaking") {
        return sendLine({ ...state, typed: true }, event.text, [{ type: "stopSpeech" }]);
      }
      return [state, []];
    }

    case "SPOKEN":
      if (state.phase !== "speaking") return [state, []];
      return afterReplyShown(state);

    case "SPEECH_ERROR":
      return onSpeechError(state, event.kind);

    case "SWITCH_LANG": {
      if (event.lang === state.lang) return [state, []];
      const next = { ...state, lang: event.lang };
      // Restart recognition in the new language right away (2.7); otherwise the next listen uses it.
      if (state.phase === "listening") return [next, [{ type: "listen", lang: event.lang }]];
      return [next, []];
    }

    case "TYPE_INSTEAD": {
      if (state.typed) {
        return state.phase === "typing" ? [state, [{ type: "focusInput" }]] : [state, []];
      }
      const next = { ...state, typed: true, showTypeHint: false };
      if (state.phase === "listening") {
        return [{ ...next, phase: "typing" }, [{ type: "stopSpeech" }, { type: "focusInput" }]];
      }
      // idle, starting, thinking, speaking: the switch applies when the reply has been shown.
      return [next, []];
    }

    case "HANG_UP":
      if (state.phase === "idle") return [state, []];
      return end(state, "hangup", []);

    case "CLIENT_TIMEOUT":
      // Only a request in flight can time out; a late timer from an earlier Turn is ignored.
      if (state.phase !== "starting" && state.phase !== "thinking") return [state, []];
      return end({ ...state, transcript: [...state.transcript, { who: "notice", key: "lineCut" }] }, "timeout", []);
  }
}

// ---------------------------------------------------------------------------

function post(body: TurnRequest): CallEffect {
  return { type: "post", body, timeoutMs: CLIENT_TIMEOUT_MS };
}

function sendLine(state: CallLoopState, raw: string, before: CallEffect[]): Step {
  if (state.callId === null) return [state, []];
  const utterance = raw.trim().slice(0, MAX_UTTERANCE).trim();
  return [
    {
      ...state,
      phase: "thinking",
      pending: utterance,
      noSpeechStreak: 0,
      showTypeHint: false,
      transcript: [...state.transcript, { who: "caller", text: utterance }],
    },
    [
      ...before,
      post({
        kind: "say",
        shopId: state.shopId,
        language: state.lang,
        callId: state.callId,
        utterance,
        conversation: state.conversation.slice(-MAX_CONVERSATION),
      }),
    ],
  ];
}

function onReply(state: CallLoopState, out: TurnOutput): Step {
  if (state.phase !== "starting" && state.phase !== "thinking") return [state, []];
  // A reply for another Call (a stale response) is ignored.
  if (state.phase === "thinking" && out.callId !== state.callId) return [state, []];

  const conversation =
    state.phase === "thinking" && state.pending !== null
      ? [...state.conversation, { caller: state.pending, receptionist: out.reply }]
      : state.conversation;
  // The server may switch the language when the caller asks for it (2.7): the switch follows.
  const next: CallLoopState = {
    ...state,
    callId: out.callId,
    lang: out.language,
    conversation,
    pending: null,
    transcript: [...state.transcript, { who: "receptionist", text: out.reply }],
  };
  const voice = canSpeak(next) ? [{ type: "speak", text: out.reply, lang: next.lang } as const] : [];

  if (out.complete) {
    // The goodbye is still spoken, but nothing listens afterwards.
    return [{ ...next, phase: "ended", endReason: "complete", outcome: out.outcome ?? null }, voice];
  }
  if (voice.length > 0) return [{ ...next, phase: "speaking" }, voice];
  return afterReplyShown(next);
}

/** After a reply was spoken (or only shown): listen again, or wait for typing. */
function afterReplyShown(state: CallLoopState): Step {
  if (state.typed) return [{ ...state, phase: "typing" }, [{ type: "focusInput" }]];
  return [{ ...state, phase: "listening" }, [{ type: "listen", lang: state.lang }]];
}

function canSpeak(state: CallLoopState): boolean {
  return state.synthesis && !state.mutedLangs.includes(state.lang);
}

function onNoSpeech(state: CallLoopState): Step {
  const streak = state.noSpeechStreak + 1;
  return [
    { ...state, noSpeechStreak: streak, showTypeHint: state.showTypeHint || streak >= NO_SPEECH_HINT_AFTER },
    [{ type: "listen", lang: state.lang }],
  ];
}

function onSpeechError(state: CallLoopState, kind: SpeechErrorKind): Step {
  if (kind === "aborted") return [state, []];

  if (kind === "synthesis-unavailable" || kind === "synthesis-failed") {
    const next =
      kind === "synthesis-unavailable" && !state.mutedLangs.includes(state.lang)
        ? { ...state, mutedLangs: [...state.mutedLangs, state.lang] }
        : state;
    // The reply is already in the transcript: carry on as if it had been spoken.
    return next.phase === "speaking" ? afterReplyShown(next) : [next, []];
  }

  if (kind === "no-speech") return state.phase === "listening" ? onNoSpeech(state) : [state, []];

  if (TO_TYPED.has(kind)) {
    // Already typing (the caller chose it, or an earlier error): just stop offering the microphone.
    if (state.typed) return [state.recognition ? { ...state, recognition: false } : state, []];
    const notice: TranscriptEntry = { who: "notice", key: "typeInstead" };
    const hasNotice = state.transcript.some((e) => e.who === "notice" && e.key === "typeInstead");
    const next: CallLoopState = {
      ...state,
      typed: true,
      recognition: false,
      showTypeHint: false,
      transcript: hasNotice ? state.transcript : [...state.transcript, notice],
    };
    if (state.phase === "listening") return [{ ...next, phase: "typing" }, [{ type: "focusInput" }]];
    return [next, []];
  }

  return [state, []];
}

function end(state: CallLoopState, reason: "hangup" | "timeout", effects: CallEffect[]): Step {
  const beacon: CallEffect[] =
    state.callId !== null ? [{ type: "beaconHangup", body: { kind: "hangup", shopId: state.shopId, callId: state.callId } }] : [];
  return [
    { ...state, phase: "ended", endReason: reason, pending: null },
    [...effects, { type: "stopSpeech" }, ...beacon],
  ];
}

/**
 * After the end nothing restarts. One exception: a hang-up or timeout that
 * happened before `start` answered had no callId to send; when that late
 * reply arrives, its Call is closed with a beacon so the server does not wait
 * for the 10-minute sweep.
 */
function onEnded(state: CallLoopState, event: CallEvent): Step {
  if (event.type === "REPLY" && state.callId === null && (state.endReason === "hangup" || state.endReason === "timeout")) {
    const callId = event.out.callId;
    return [{ ...state, callId }, event.out.complete ? [] : [{ type: "beaconHangup", body: { kind: "hangup", shopId: state.shopId, callId } }]];
  }
  return [state, []];
}

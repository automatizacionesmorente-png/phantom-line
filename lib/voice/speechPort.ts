import type { Lang } from "@/lib/conversation/types";
import { localeOf, type CallEvent, type RecognitionErrorKind, type SynthesisErrorKind } from "./callLoop";
import type { SpeechHint } from "./speechRequest";

/**
 * The speech port: the only place that touches the Web Speech API. The pure
 * `callLoop` reducer asks for `listen` and `speak`; the hook runs them on a
 * port and turns the results back into events with `listenEvent` and
 * `speakEvent`.
 *
 * Three implementations:
 * - `createWebSpeechPort(window)`: Chrome's `SpeechRecognition` (or the
 *   `webkit` prefix) and `speechSynthesis`;
 * - `createTypedOnlyPort()`: no speech at all, for Typed_Mode from the start;
 * - `createFakeSpeechPort(script)`: scripted results for tests.
 */

export type ListenResult = { type: "final"; text: string } | { type: "error"; kind: RecognitionErrorKind };
export type SpeakResult = { type: "done" } | { type: "error"; kind: SynthesisErrorKind | "aborted" };

export interface ListenOptions {
  lang: Lang;
  /** Interim (not final) text, shown greyed while the caller speaks. */
  onInterim?: (text: string) => void;
}

export interface SpeechPort {
  /** What exists in this browser at all. Per-language checks happen in `listen` and `speak`. */
  readonly supports: { recognition: boolean; synthesis: boolean };
  /** One utterance (`continuous = false`). Starting a new listen aborts the previous one. */
  listen(opts: ListenOptions): Promise<ListenResult>;
  /**
   * Speaks one reply. `hint` is the Turn_API's speech hint: the neural port uses it, the Web
   * Speech port ignores it.
   */
  speak(text: string, lang: Lang, hint?: SpeechHint): Promise<SpeakResult>;
  /** Called inside the user's gesture (the call button), so audio may start later. Optional. */
  unlock?(): void;
  /** Stops recognition and synthesis; pending promises settle with `aborted`. */
  stop(): void;
}

export function listenEvent(r: ListenResult): CallEvent {
  return r.type === "final" ? { type: "RECOGNIZED", text: r.text } : { type: "SPEECH_ERROR", kind: r.kind };
}

export function speakEvent(r: SpeakResult): CallEvent {
  return r.type === "done" ? { type: "SPOKEN" } : { type: "SPEECH_ERROR", kind: r.kind };
}

// ---------------------------------------------------------------------------
// Web Speech. Typed structurally: TypeScript's DOM lib does not describe
// SpeechRecognition, `available()` or `phrases`, and the structural types
// keep the port testable with plain objects.

type Availability = "available" | "downloadable" | "downloading" | "unavailable";

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  phrases?: unknown;
  onresult: ((ev: RecognitionResultEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
export interface RecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
export interface RecognitionCtorLike {
  new (): RecognitionLike;
  available?: (opts: { langs: string[]; processLocally: boolean }) => Promise<Availability>;
}
export interface VoiceLike {
  lang: string;
  name: string;
  /** False for a network voice (Chrome's "Google …" voices, Android's "-network" voices). */
  localService?: boolean;
}
export interface UtteranceLike {
  lang: string;
  voice: unknown;
  onend: (() => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
}
export interface SynthesisLike {
  getVoices(): readonly VoiceLike[];
  speak(u: UtteranceLike): void;
  cancel(): void;
  addEventListener(type: "voiceschanged", fn: () => void): void;
  removeEventListener(type: "voiceschanged", fn: () => void): void;
}
export interface SpeechWindowLike {
  SpeechRecognition?: RecognitionCtorLike;
  webkitSpeechRecognition?: RecognitionCtorLike;
  SpeechRecognitionPhrase?: new (phrase: string, boost?: number) => unknown;
  speechSynthesis?: SynthesisLike;
  SpeechSynthesisUtterance?: new (text: string) => UtteranceLike;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

const RECOGNITION_ERRORS: ReadonlySet<string> = new Set<RecognitionErrorKind>([
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
]);
const toRecognitionError = (code: string): RecognitionErrorKind =>
  RECOGNITION_ERRORS.has(code) ? (code as RecognitionErrorKind) : "network";

export const VOICE_WAIT_MS = 1000;

/** Names that mark a better-sounding voice (Requirement 4.2). */
const NATURAL = /natural|neural|enhanced|premium|online/i;

/**
 * Rank of a voice, lower is better (natural-voice design.md, "Browser voice choice"):
 * a natural, neural, enhanced, premium or online voice; then Google's network voices; then any
 * other network voice; then the rest, in the browser's order.
 */
export function voiceRank(v: VoiceLike): number {
  if (NATURAL.test(v.name)) return 0;
  if (/google/i.test(v.name)) return 1;
  if (v.localService === false) return 2;
  return 3;
}

/**
 * The best voice for the exact locale, else the best voice of the language, else null.
 * Within a group, the lowest `voiceRank` wins, and the browser's order breaks ties.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: Lang): V | null {
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  const exact = localeOf(lang).toLowerCase();
  const best = (group: readonly V[]) =>
    group.reduce<V | null>((b, v) => (b === null || voiceRank(v) < voiceRank(b) ? v : b), null);
  return (
    best(voices.filter((v) => norm(v.lang) === exact)) ??
    best(voices.filter((v) => norm(v.lang) === lang || norm(v.lang).startsWith(`${lang}-`)))
  );
}

export interface WebSpeechOptions {
  /** Contextual biasing, e.g. the shop's service names; used only where `phrases` is supported. */
  phrases?: readonly string[];
}

/**
 * `win` is the real `window` in the browser. The DOM lib types its handlers
 * more narrowly than the structural types above, so a `Window` is accepted
 * and viewed through `SpeechWindowLike`.
 */
export function createWebSpeechPort(browser: SpeechWindowLike | Window, options: WebSpeechOptions = {}): SpeechPort {
  const win = browser as SpeechWindowLike;
  const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
  const synth = win.speechSynthesis;
  const Utterance = win.SpeechSynthesisUtterance;
  const checked = new Map<Lang, boolean>();
  let usePhrases = (options.phrases?.length ?? 0) > 0 && typeof win.SpeechRecognitionPhrase === "function";
  let current: { rec: RecognitionLike; settle: (r: ListenResult) => void } | null = null;
  let speaking: ((r: SpeakResult) => void) | null = null;
  /** Bumped by every listen and stop, so a listen still awaiting `available()` never starts late. */
  let generation = 0;

  async function isAvailable(lang: Lang): Promise<boolean> {
    if (!Ctor) return false;
    if (typeof Ctor.available !== "function") return true;
    const known = checked.get(lang);
    if (known !== undefined) return known;
    let ok = true;
    try {
      ok = (await Ctor.available({ langs: [localeOf(lang)], processLocally: false })) !== "unavailable";
    } catch {
      ok = true; // a failing check must not lock the caller out of voice; recognition reports its own errors
    }
    checked.set(lang, ok);
    return ok;
  }

  function abortListening() {
    const c = current;
    current = null;
    if (c) {
      c.settle({ type: "error", kind: "aborted" });
      try {
        c.rec.abort();
      } catch {
        /* already stopped */
      }
    }
  }

  function listenOnce(opts: ListenOptions): Promise<ListenResult> {
    return new Promise<ListenResult>((resolve) => {
      const rec = new Ctor!();
      let done = false;
      let finalText = "";
      const settle = (r: ListenResult) => {
        if (done) return;
        done = true;
        if (current?.rec === rec) current = null;
        resolve(r);
      };
      rec.lang = localeOf(opts.lang);
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      if (usePhrases && "phrases" in rec && win.SpeechRecognitionPhrase) {
        const Phrase = win.SpeechRecognitionPhrase;
        try {
          rec.phrases = (options.phrases ?? []).map((p) => new Phrase(p));
        } catch {
          usePhrases = false;
        }
      }
      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (interim) opts.onInterim?.(interim);
      };
      rec.onerror = (ev) => settle({ type: "error", kind: toRecognitionError(ev.error) });
      rec.onend = () => settle(finalText.trim() ? { type: "final", text: finalText.trim() } : { type: "error", kind: "no-speech" });
      current = { rec, settle };
      try {
        rec.start();
      } catch {
        settle({ type: "error", kind: "network" });
      }
    });
  }

  function voiceFor(lang: Lang): Promise<VoiceLike | null> {
    const now = pickVoice(synth!.getVoices(), lang);
    if (now || synth!.getVoices().length > 0) return Promise.resolve(now);
    // Chrome loads voices lazily: wait up to 1 s for `voiceschanged`.
    return new Promise((resolve) => {
      const onChange = () => {
        win.clearTimeout(timer);
        synth!.removeEventListener("voiceschanged", onChange);
        resolve(pickVoice(synth!.getVoices(), lang));
      };
      const timer = win.setTimeout(() => {
        synth!.removeEventListener("voiceschanged", onChange);
        resolve(pickVoice(synth!.getVoices(), lang));
      }, VOICE_WAIT_MS);
      synth!.addEventListener("voiceschanged", onChange);
    });
  }

  return {
    supports: { recognition: Boolean(Ctor), synthesis: Boolean(synth && Utterance) },

    async listen(opts) {
      abortListening();
      const gen = ++generation;
      if (!(await isAvailable(opts.lang))) return { type: "error", kind: "unavailable" };
      if (gen !== generation) return { type: "error", kind: "aborted" };
      const r = await listenOnce(opts);
      if (r.type === "error" && r.kind === "phrases-not-supported" && usePhrases && gen === generation) {
        usePhrases = false; // biasing is a bonus: listen again without it
        return listenOnce(opts);
      }
      return r;
    },

    async speak(text, lang) {
      if (!synth || !Utterance) return { type: "error", kind: "synthesis-unavailable" };
      const voice = await voiceFor(lang);
      if (!voice) return { type: "error", kind: "synthesis-unavailable" };
      speaking?.({ type: "error", kind: "aborted" });
      synth.cancel();
      return new Promise<SpeakResult>((resolve) => {
        let done = false;
        const settle = (r: SpeakResult) => {
          if (done) return;
          done = true;
          if (speaking === settle) speaking = null;
          resolve(r);
        };
        const u = new Utterance(text);
        u.lang = localeOf(lang);
        u.voice = voice;
        u.onend = () => settle({ type: "done" });
        u.onerror = (ev) =>
          settle({ type: "error", kind: ev.error === "interrupted" || ev.error === "canceled" ? "aborted" : "synthesis-failed" });
        speaking = settle;
        synth.speak(u);
      });
    },

    stop() {
      generation++;
      abortListening();
      if (speaking) {
        speaking({ type: "error", kind: "aborted" });
        speaking = null;
      }
      synth?.cancel();
    },
  };
}

// ---------------------------------------------------------------------------

/** No speech at all: the Call runs in Typed_Mode from the start and replies are shown only. */
export function createTypedOnlyPort(): SpeechPort {
  return {
    supports: { recognition: false, synthesis: false },
    listen: async () => ({ type: "error", kind: "unavailable" }),
    speak: async () => ({ type: "error", kind: "synthesis-unavailable" }),
    stop: () => {},
  };
}

// ---------------------------------------------------------------------------

export interface FakeSpeechScript {
  supports?: { recognition: boolean; synthesis: boolean };
  /** Results of successive `listen` calls. When it runs out, `listen` waits forever, like a silent room. */
  listens?: readonly ListenResult[];
  /** Results of successive `speak` calls; `done` once it runs out. */
  speaks?: readonly SpeakResult[];
}

export interface FakeSpeechPort extends SpeechPort {
  /** Every reply asked for; `hint` is present only when the reply carried one. */
  readonly spoken: { text: string; lang: Lang; hint?: SpeechHint }[];
  readonly listened: Lang[];
  readonly stops: number;
}

export function createFakeSpeechPort(script: FakeSpeechScript = {}): FakeSpeechPort {
  const listens = [...(script.listens ?? [])];
  const speaks = [...(script.speaks ?? [])];
  const spoken: { text: string; lang: Lang; hint?: SpeechHint }[] = [];
  const listened: Lang[] = [];
  let stops = 0;
  return {
    supports: script.supports ?? { recognition: true, synthesis: true },
    spoken,
    listened,
    get stops() {
      return stops;
    },
    listen(opts) {
      listened.push(opts.lang);
      const next = listens.shift();
      return next ? Promise.resolve(next) : new Promise<ListenResult>(() => {});
    },
    speak(text, lang, hint) {
      spoken.push(hint ? { text, lang, hint } : { text, lang });
      return Promise.resolve(speaks.shift() ?? { type: "done" });
    },
    stop() {
      stops++;
    },
  };
}

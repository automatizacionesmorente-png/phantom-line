import type { Lang } from "@/lib/conversation/types";
import type { SpeakResult, SpeechPort } from "./speechPort";
import type { SpeechHint, SpeechRequest } from "./speechRequest";
import { createTimeStretcher, type TimeStretcher } from "./timeStretch";
import {
  initialVoiceDecision,
  TTS_DEADLINE_MS,
  voiceDecision,
  type FailureKind,
  type ReportReason,
  type VoiceDecisionState,
  type VoiceEffect,
  type VoiceEvent,
} from "./voiceDecision";

/**
 * The neural voice in the browser (natural-voice design.md, "Browser: the VoicePort"). It is a
 * SpeechPort, so `callLoop` and its property S5 do not change. It only runs effects: every
 * decision (deadline, start buffer, stall, fallback, report) is the pure `voiceDecision` reducer.
 *
 * - A cached line plays through an `<audio>` element with `preservesPitch = true` and
 *   `playbackRate = hint.rate` (the element's own time-stretching keeps the pitch).
 * - A live line is POSTed to /api/speech; its 16-bit PCM chunks are converted to Float32, passed
 *   through `timeStretch` at `hint.rate` (a no-op at 1.0) and scheduled back to back on one
 *   AudioContext, with `AudioBufferSourceNode.playbackRate` left at 1 (resampling would raise the pitch).
 * - The browser voice (`fallback`, the Web Speech port) speaks at rate 1.0 whenever the reducer
 *   says so; after a 429 quota answer it speaks every reply for the rest of the Call (4.4).
 * - Recognition is the fallback port's.
 *
 * Browser objects are typed structurally, so tests drive it with plain fakes.
 */

export const SPEECH_ENDPOINT = "/api/speech";
/** How often the player looks at the clock for the stall rule and the end of the audio. */
export const TICK_MS = 100;
/** Grace after the AudioContext's last scheduled sample before listening again. */
const END_GRACE_MS = 30;

export interface AudioBufferLike {
  readonly duration: number;
  copyToChannel(source: Float32Array, channel: number): void;
}
export interface AudioBufferSourceLike {
  buffer: AudioBufferLike | null;
  readonly playbackRate: { value: number };
  connect(destination: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceLike;
  resume(): Promise<void>;
}
export interface AudioElementLike {
  src: string;
  preservesPitch: boolean;
  playbackRate: number;
  defaultPlaybackRate: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  removeAttribute(name: string): void;
}
export interface NeuralWindowLike {
  fetch: typeof fetch;
  AudioContext?: new () => AudioContextLike;
  webkitAudioContext?: new () => AudioContextLike;
  Audio?: new () => AudioElementLike;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface NeuralVoiceOptions {
  shopId: string;
  endpoint?: string;
  /** Milliseconds on a monotonic clock (`performance.now()` in the browser). */
  now?: () => number;
}

export interface NeuralVoicePort extends SpeechPort {
  /** True after a 429 quota answer: the browser voice speaks for the rest of the Call. */
  readonly quotaOut: boolean;
}

/** The token's middle segment is base64url("1") or base64url("0"): whether the line is cacheable (a Fixed_Phrase for the log). */
export function tokenCacheable(token: string): boolean {
  return token.split(".")[1] === "MQ";
}

/** Little-endian 16-bit PCM to Float32, keeping an odd trailing byte for the next chunk. */
export function pcm16ToFloat(bytes: Uint8Array, carry: number | null): { samples: Float32Array; carry: number | null } {
  const all = carry === null ? bytes : concatByte(carry, bytes);
  const n = Math.floor(all.length / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = all[2 * i] | (all[2 * i + 1] << 8);
    samples[i] = (v >= 0x8000 ? v - 0x10000 : v) / 32768;
  }
  return { samples, carry: all.length % 2 === 1 ? all[all.length - 1] : null };
}

function concatByte(first: number, rest: Uint8Array): Uint8Array {
  const out = new Uint8Array(rest.length + 1);
  out[0] = first;
  out.set(rest, 1);
  return out;
}

/** A 44-byte WAV with no samples: played inside the call button's gesture to unlock the shared element. */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/** The sample rate in `audio/L16; rate=24000; channels=1`. */
export function sampleRateOf(contentType: string | null): number {
  const m = /rate=(\d{4,6})/.exec(contentType ?? "");
  return m ? Number(m[1]) : 24_000;
}

async function failureOf(res: Response): Promise<FailureKind> {
  if (res.status === 403) return "token";
  if (res.status === 429) {
    const body = (await res.json().catch(() => null)) as { fallback?: string } | null;
    return body?.fallback === "quota" ? "quota" : "rate_limit";
  }
  return "unavailable";
}

export function createNeuralVoicePort(browser: NeuralWindowLike | Window, fallback: SpeechPort, opts: NeuralVoiceOptions): NeuralVoicePort {
  const win = browser as NeuralWindowLike;
  const endpoint = opts.endpoint ?? SPEECH_ENDPOINT;
  const now = opts.now ?? (() => Date.now());
  const AudioCtor = win.AudioContext ?? win.webkitAudioContext;
  let ctx: AudioContextLike | null = null;
  // Safari and iOS only let an <audio> element play after a user gesture if that same element was
  // played inside the gesture. The call button unlocks this one element and every cached line reuses
  // it; a new element per line was refused there (NotAllowedError, owner's call, 2026-11-16).
  let sharedEl: AudioElementLike | null = null;
  let quotaOut = false;
  let current: { cancel(): void } | null = null;

  function audioContext(): AudioContextLike | null {
    if (!ctx && AudioCtor) {
      try {
        ctx = new AudioCtor();
      } catch {
        return null;
      }
    }
    return ctx;
  }

  /** The browser voice at rate 1.0. After a neural attempt, "no voice for this language" must not mute the language for the Call. */
  async function speakBrowser(text: string, lang: Lang, afterNeural: boolean): Promise<SpeakResult> {
    const r = await fallback.speak(text, lang);
    if (afterNeural && r.type === "error" && r.kind === "synthesis-unavailable") return { type: "error", kind: "synthesis-failed" };
    return r;
  }

  function report(lang: Lang, reason: ReportReason, latencyMs: number, fixed: boolean) {
    const body: SpeechRequest = { kind: "report", shopId: opts.shopId, language: lang, reason, fixed, latencyMs };
    try {
      void win
        .fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        .catch(() => undefined);
    } catch {
      // A report is best effort.
    }
  }

  function speakNeural(text: string, lang: Lang, hint: SpeechHint): Promise<SpeakResult> {
    const mode = hint.kind === "cached" ? "element" : "stream";
    const fixed = hint.kind === "cached" ? true : tokenCacheable(hint.token);
    const t0 = now();
    const at = () => now() - t0;
    const controller = new AbortController();
    const timers = new Set<number>();
    let state: VoiceDecisionState = initialVoiceDecision(mode);
    let settled = false;
    let resolve: (r: SpeakResult) => void = () => undefined;
    const result = new Promise<SpeakResult>((r) => (resolve = r));
    let fallbackResult: SpeakResult = { type: "done" };

    // Stream mode.
    const queued: AudioBufferLike[] = [];
    const sources: AudioBufferSourceLike[] = [];
    let nextTime = 0;
    // Element mode.
    let audio: AudioElementLike | null = null;
    const listeners: [string, () => void][] = [];

    const later = (fn: () => void, ms: number) => {
      const id = win.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    function settle(r: SpeakResult) {
      if (settled) return;
      settled = true;
      for (const id of timers) win.clearTimeout(id);
      timers.clear();
      if (current === handle) current = null;
      resolve(r);
    }

    function stopNeural() {
      controller.abort();
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* not started or already stopped */
        }
      }
      sources.length = 0;
      queued.length = 0;
      if (audio) {
        for (const [type, fn] of listeners) audio.removeEventListener(type, fn);
        try {
          audio.pause();
          audio.removeAttribute("src");
        } catch {
          /* already gone */
        }
        audio = null;
      }
    }

    function dispatch(event: VoiceEvent) {
      if (settled) return;
      const [next, effects] = voiceDecision(state, event);
      state = next;
      for (const e of effects) run(e);
    }

    function schedule(buf: AudioBufferLike) {
      const c = ctx!;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      const when = Math.max(nextTime, c.currentTime);
      src.start(when);
      nextTime = when + buf.duration;
      sources.push(src);
    }

    function run(effect: VoiceEffect) {
      switch (effect.type) {
        case "play":
          nextTime = ctx!.currentTime;
          for (const b of queued.splice(0)) schedule(b);
          return;
        case "stopNeural":
          stopNeural();
          return;
        case "quotaOut":
          quotaOut = true;
          return;
        case "report":
          report(lang, effect.reason, effect.latencyMs, fixed);
          return;
        case "fallback":
          void speakBrowser(text, lang, true).then((r) => {
            fallbackResult = r;
            dispatch({ type: "FALLBACK_ENDED", at: at() });
          });
          return;
        case "finish":
          if (effect.by === "browser") {
            settle(fallbackResult);
            return;
          }
          if (mode === "stream" && ctx) {
            // Listen again only after the AudioContext has played its last sample (1.8).
            const left = (nextTime - ctx.currentTime) * 1000;
            if (left > 0) {
              later(() => settle({ type: "done" }), left + END_GRACE_MS);
              return;
            }
          }
          settle({ type: "done" });
          return;
      }
    }

    function tick() {
      if (settled) return;
      dispatch({ type: "STALL_TICK", at: at() });
      if (!settled) later(tick, TICK_MS);
    }

    function startStream(token: string) {
      const c = audioContext();
      if (!c) {
        dispatch({ type: "ERROR", at: at(), kind: "playback_error" });
        return;
      }
      const body: SpeechRequest = { kind: "say", shopId: opts.shopId, language: lang, text, token };
      void (async () => {
        let res: Response;
        try {
          res = await win.fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch {
          if (!controller.signal.aborted) dispatch({ type: "ERROR", at: at(), kind: "network" });
          return;
        }
        if (!res.ok || !res.body) {
          dispatch({ type: "ERROR", at: at(), kind: res.ok ? "network" : await failureOf(res) });
          return;
        }
        const sampleRate = sampleRateOf(res.headers.get("content-type"));
        const stretcher: TimeStretcher = createTimeStretcher(hint.rate, sampleRate);
        const enqueue = (samples: Float32Array) => {
          if (samples.length === 0 || settled || controller.signal.aborted) return;
          const buf = c.createBuffer(1, samples.length, sampleRate);
          buf.copyToChannel(samples, 0);
          if (state.phase === "playing") schedule(buf);
          else queued.push(buf);
          dispatch({ type: "CHUNK", at: at(), ms: (samples.length / sampleRate) * 1000 });
        };
        const reader = res.body.getReader();
        let carry: number | null = null;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (settled || controller.signal.aborted) {
              void reader.cancel().catch(() => undefined);
              return;
            }
            if (done) break;
            const pcm = pcm16ToFloat(value, carry);
            carry = pcm.carry;
            enqueue(stretcher.push(pcm.samples));
          }
        } catch {
          if (!controller.signal.aborted) dispatch({ type: "ERROR", at: at(), kind: "network" });
          return;
        }
        enqueue(stretcher.flush());
        dispatch({ type: "ENDED", at: at() });
      })();
    }

    function startElement(url: string, rate: number) {
      const Ctor = win.Audio;
      if (!Ctor) {
        dispatch({ type: "ERROR", at: at(), kind: "playback_error" });
        return;
      }
      const el = sharedEl ?? new Ctor();
      audio = el;
      const on = (type: string, fn: () => void) => {
        listeners.push([type, fn]);
        el.addEventListener(type, fn);
      };
      on("playing", () => dispatch({ type: "STARTED", at: at() }));
      on("waiting", () => dispatch({ type: "UNDERRUN", at: at() }));
      on("ended", () => dispatch({ type: "PLAYBACK_ENDED", at: at() }));
      on("error", () => dispatch({ type: "ERROR", at: at(), kind: "playback_error" }));
      el.preservesPitch = true;
      el.src = url;
      // Loading a source resets playbackRate to defaultPlaybackRate, so both are set, after src.
      el.defaultPlaybackRate = rate;
      el.playbackRate = rate;
      el.play().catch(() => dispatch({ type: "ERROR", at: at(), kind: "playback_error" }));
    }

    const handle = {
      cancel() {
        stopNeural();
        settle({ type: "error", kind: "aborted" });
      },
    };
    current = handle;
    later(() => dispatch({ type: "DEADLINE", at: at() }), TTS_DEADLINE_MS);
    later(tick, TICK_MS);
    if (hint.kind === "cached") startElement(hint.url, hint.rate);
    else startStream(hint.token);
    return result;
  }

  return {
    supports: {
      recognition: fallback.supports.recognition,
      synthesis: fallback.supports.synthesis || Boolean(AudioCtor || win.Audio),
    },
    get quotaOut() {
      return quotaOut;
    },
    listen: (o) => fallback.listen(o),
    speak(text, lang, hint) {
      current?.cancel();
      if (!hint || quotaOut) return speakBrowser(text, lang, false);
      return speakNeural(text, lang, hint);
    },
    unlock() {
      const c = audioContext();
      void c?.resume().catch(() => undefined);
      if (!sharedEl && win.Audio) {
        try {
          sharedEl = new win.Audio();
          sharedEl.src = SILENT_WAV;
          void sharedEl.play().catch(() => undefined);
        } catch {
          sharedEl = null;
        }
      }
      fallback.unlock?.();
    },
    stop() {
      current?.cancel();
      fallback.stop();
    },
  };
}

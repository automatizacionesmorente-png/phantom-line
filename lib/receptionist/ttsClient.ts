import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { VoiceProfile } from "@/lib/sectors/types";
import { GeminiCallError, redactedError } from "./geminiClient";

/**
 * The only file that calls a Gemini text-to-speech model (natural-voice design.md, "TTS client").
 * Server only: the key comes from `GEMINI_API_KEY` and never leaves this process. Every error
 * leaves as a `GeminiCallError` with the key redacted.
 */

/**
 * The TTS models in the order a reply tries them. The 3.8 models carry the Castilian catalog
 * voices; `gemini-3.1-flash-tts-preview` had the steadiest stream but only classic voices.
 * Override with `GEMINI_TTS_MODEL` (one id or a comma-separated list).
 */
export const DEFAULT_TTS_MODELS: readonly string[] = [
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-3.1-flash-tts-preview",
];

/** Streamed audio from the API is 16-bit mono PCM at 24 kHz (spike, task 1). */
export const DEFAULT_SAMPLE_RATE = 24_000;

/** "a, b,,a" → ["a", "b"]; empty or missing → the default list. */
export function parseTtsModelList(raw: string | undefined): string[] {
  const ids = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const unique = [...new Set(ids)];
  return unique.length > 0 ? unique : [...DEFAULT_TTS_MODELS];
}

/** The 3.8 family accepts catalog voices such as `es-es-commercial-3`; the others only classic names. */
export function usesCatalogVoice(model: string): boolean {
  return model.includes("3.8");
}

/** The voice a model is sent, before any 400 has marked it classic-only. */
export function defaultVoiceFor(model: string, profile: VoiceProfile): string {
  return usesCatalogVoice(model) ? profile.voice : profile.classicVoice;
}

/** The request body this client sends, as a type the fake SDK in tests can check. */
export interface TtsRequestParams {
  model: string;
  store: false;
  stream: true;
  input: [
    {
      type: "text";
      text: string;
      annotations: [{ type: "speech_metadata"; style: string; start_index: number; end_index: number }];
    },
  ];
  response_format: { type: "audio" };
  generation_config: { speech_config: [{ voice: string; language: string }] };
}

/** The part of a streamed event this client reads. */
export interface TtsStreamEvent {
  event_type: string;
  delta?: { type: string; data?: string; mime_type?: string; sample_rate?: number };
  error?: { code?: string; message?: string };
}

export interface TtsRequestOptions {
  signal: AbortSignal;
  retries: { strategy: "none" };
}

/** The slice of the SDK this client uses, so a test can pass a fake. */
export interface TtsSdk {
  interactions: {
    create(params: TtsRequestParams, options: TtsRequestOptions): PromiseLike<AsyncIterable<TtsStreamEvent>>;
  };
}

export interface TtsChunk {
  /** Raw 16-bit little-endian mono PCM. */
  pcm: Uint8Array;
  sampleRate: number;
}

export interface TtsStreamRequest {
  text: string;
  profile: VoiceProfile;
  model: string;
  signal: AbortSignal;
}

export interface TtsClient {
  readonly models: readonly string[];
  /** The voice this client sends to `model`: the catalog voice on the 3.8 models, the classic one elsewhere. */
  voiceFor(model: string, profile: VoiceProfile): string;
  /** Streams PCM chunks. Throws a `GeminiCallError` (key redacted) on API errors and on abort. */
  stream(req: TtsStreamRequest): AsyncIterable<TtsChunk>;
}

export interface TtsConfig {
  apiKey: string;
  /** The value of GEMINI_TTS_MODEL. */
  models?: string;
  /** For tests: the SDK instance to use. */
  sdk?: TtsSdk;
}

/** The 400 the API sends when a model does not know a voice id. */
const NO_MATCHING_VOICE = /no matching speaker voice/i;

/** A streamed `error` event carries a string code; map the usual ones to an HTTP status. */
export function statusOfEventCode(code: string | undefined): number | undefined {
  if (!code) return undefined;
  if (/^\d{3}$/.test(code)) return Number(code);
  const byName: Record<string, number> = {
    RESOURCE_EXHAUSTED: 429,
    INVALID_ARGUMENT: 400,
    FAILED_PRECONDITION: 400,
    PERMISSION_DENIED: 403,
    NOT_FOUND: 404,
    UNAVAILABLE: 503,
    INTERNAL: 500,
    DEADLINE_EXCEEDED: 504,
  };
  return byName[code.toUpperCase()];
}

/** Resolves like `p`, or rejects as soon as `signal` aborts, even if `p` never settles (an SDK that ignores the abort). */
function abortable<T>(p: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(p).then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function abortError(signal: AbortSignal): GeminiCallError {
  const reason = signal.reason as { name?: unknown } | undefined;
  const name = typeof reason?.name === "string" ? reason.name : "AbortError";
  return new GeminiCallError("The TTS request was aborted", name);
}

export function createTtsClient(cfg: TtsConfig): TtsClient {
  const models = parseTtsModelList(cfg.models);
  const sdk = cfg.sdk ?? sdkFrom(cfg.apiKey);
  /** Models that rejected a catalog voice with a 400: classic voices only, for the life of the process. */
  const classicOnly = new Set<string>();
  const redact = (s: string) => (cfg.apiKey ? s.split(cfg.apiKey).join("***") : s);

  const voiceFor = (model: string, profile: VoiceProfile) =>
    classicOnly.has(model) ? profile.classicVoice : defaultVoiceFor(model, profile);

  function failed(err: unknown, model: string, voice: string, profile: VoiceProfile): GeminiCallError {
    const e = err instanceof GeminiCallError ? err : redactedError(err, cfg.apiKey);
    if (e.status === 400 && voice === profile.voice && voice !== profile.classicVoice && NO_MATCHING_VOICE.test(e.message)) {
      classicOnly.add(model);
    }
    return e;
  }

  return {
    models,
    voiceFor,
    async *stream({ text, profile, model, signal }) {
      const voice = voiceFor(model, profile);
      const params: TtsRequestParams = {
        model,
        // Names and phones are spoken in the read-back: never keep them as stored interactions.
        store: false,
        stream: true,
        // The style goes in a speech_metadata annotation over the whole text (byte offsets), so it
        // changes how the words are said and is never read aloud (design.md, "Style prompt").
        input: [
          {
            type: "text",
            text,
            annotations: [{ type: "speech_metadata", style: profile.style, start_index: 0, end_index: Buffer.byteLength(text, "utf8") }],
          },
        ],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice, language: profile.languageCode }] },
      };
      let events: AsyncIterable<TtsStreamEvent>;
      // A reply the browser already gave up on spends no quota.
      if (signal.aborted) throw abortError(signal);
      try {
        // Top-level signal and no SDK retries: quota is too scarce to spend on retries.
        events = await abortable(sdk.interactions.create(params, { signal, retries: { strategy: "none" } }), signal);
      } catch (err) {
        throw failed(err, model, voice, profile);
      }
      const it = events[Symbol.asyncIterator]();
      try {
        for (;;) {
          let step: IteratorResult<TtsStreamEvent>;
          try {
            step = await abortable(it.next(), signal);
          } catch (err) {
            throw failed(err, model, voice, profile);
          }
          if (step.done) return;
          const ev = step.value;
          if (ev.event_type === "error") {
            const message = redact(`${ev.error?.code ?? ""} ${ev.error?.message ?? "stream error"}`.trim());
            throw failed(new GeminiCallError(message, "StreamErrorEvent", statusOfEventCode(ev.error?.code)), model, voice, profile);
          }
          const d = ev.event_type === "step.delta" ? ev.delta : undefined;
          if (d?.type === "audio" && d.data) {
            yield { pcm: new Uint8Array(Buffer.from(d.data, "base64")), sampleRate: d.sample_rate ?? DEFAULT_SAMPLE_RATE };
          }
        }
      } finally {
        // Close the upstream stream without waiting on it: a hung SDK must not hang the caller.
        void Promise.resolve(it.return?.()).catch(() => undefined);
      }
    },
  };
}

function sdkFrom(apiKey: string): TtsSdk {
  const ai = new GoogleGenAI({ apiKey });
  return {
    interactions: {
      create: (params, options) => ai.interactions.create(params, options),
    },
  };
}

// ---------------------------------------------------------------------------
// One whole file per request, for the voice cache pre-generation (task 9.10). Not streamed: the
// script needs no early audio, and MP3 (accepted only when not streaming) is about 2.6 times
// smaller than the WAV of the same line (design.md, "Size per line").

/** The request body of a non-streamed request. */
export interface TtsOnceParams {
  model: string;
  store: false;
  input: TtsRequestParams["input"];
  response_format: { type: "audio"; mime_type: string };
  generation_config: TtsRequestParams["generation_config"];
}

/** The parts of a finished interaction that may hold audio (the spike's `audioOf`). */
export interface TtsInteraction {
  output_audio?: { data?: string; mime_type?: string };
  steps?: { content?: { type?: string; data?: string; mime_type?: string }[] }[];
}

export interface TtsOnceSdk {
  interactions: { create(params: TtsOnceParams, options: TtsRequestOptions): PromiseLike<TtsInteraction> };
}

export interface TtsFile {
  bytes: Uint8Array;
  /** audio/mpeg for MP3. */
  mime: string;
}

export interface TtsSynthesizer {
  readonly models: readonly string[];
  voiceFor(model: string, profile: VoiceProfile): string;
  /** One MP3 for the whole text. Throws a `GeminiCallError` (key redacted) on API errors and on abort. */
  synthesize(req: { text: string; profile: VoiceProfile; model: string; signal: AbortSignal }): Promise<TtsFile>;
}

/** The audio blocks of a finished interaction, each payload once (output_audio may repeat the last step's block). */
export function audioBlocksOf(interaction: TtsInteraction): { data: string; mime_type?: string }[] {
  const blocks: { data: string; mime_type?: string }[] = [];
  if (interaction.output_audio?.data) blocks.push({ data: interaction.output_audio.data, mime_type: interaction.output_audio.mime_type });
  for (const step of interaction.steps ?? []) {
    for (const c of step.content ?? []) if (c.type === "audio" && c.data) blocks.push({ data: c.data, mime_type: c.mime_type });
  }
  const seen = new Set<string>();
  return blocks.filter((b) => (seen.has(b.data) ? false : (seen.add(b.data), true)));
}

const normalMime = (mime: string | undefined) => (!mime || /mp3|mpeg/i.test(mime) ? "audio/mpeg" : mime);

export function createTtsSynthesizer(cfg: { apiKey: string; models?: string; sdk?: TtsOnceSdk }): TtsSynthesizer {
  const models = parseTtsModelList(cfg.models);
  const sdk: TtsOnceSdk =
    cfg.sdk ??
    (() => {
      const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
      return {
        interactions: {
          create: (params, options) => ai.interactions.create(params, options) as unknown as PromiseLike<TtsInteraction>,
        },
      };
    })();
  return {
    models,
    voiceFor: defaultVoiceFor,
    async synthesize({ text, profile, model, signal }) {
      if (signal.aborted) throw abortError(signal);
      const params: TtsOnceParams = {
        model,
        store: false,
        input: [
          {
            type: "text",
            text,
            annotations: [{ type: "speech_metadata", style: profile.style, start_index: 0, end_index: Buffer.byteLength(text, "utf8") }],
          },
        ],
        response_format: { type: "audio", mime_type: "audio/mp3" },
        generation_config: { speech_config: [{ voice: defaultVoiceFor(model, profile), language: profile.languageCode }] },
      };
      let interaction: TtsInteraction;
      try {
        interaction = await abortable(sdk.interactions.create(params, { signal, retries: { strategy: "none" } }), signal);
      } catch (err) {
        throw err instanceof GeminiCallError ? err : redactedError(err, cfg.apiKey);
      }
      const blocks = audioBlocksOf(interaction);
      if (blocks.length === 0) throw new GeminiCallError("The TTS answer had no audio", "NoAudio");
      const bytes = new Uint8Array(Buffer.concat(blocks.map((b) => Buffer.from(b.data, "base64"))));
      return { bytes, mime: normalMime(blocks[0].mime_type) };
    },
  };
}

/** The synthesizer from the environment. Throws if the key is missing; the message never contains it. */
export function ttsSynthesizerFromEnv(env: Record<string, string | undefined> = process.env): TtsSynthesizer {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return createTtsSynthesizer({ apiKey, models: env.GEMINI_TTS_MODEL });
}

/** The client from the environment. Throws if the key is missing; the message never contains it. */
export function ttsClientFromEnv(env: Record<string, string | undefined> = process.env): TtsClient {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return createTtsClient({ apiKey, models: env.GEMINI_TTS_MODEL });
}

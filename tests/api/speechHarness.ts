import type { Temporal } from "temporal-polyfill";
import { makeSpeechHandler, type SpeechDeps } from "@/app/api/speech/handler";
import type { TtsFallbackLogEvent } from "@/lib/conversation/fallbackLog";
import { DEFAULT_TTS_LIMITS, type TtsLimitConfig } from "@/lib/conversation/ttsLimits";
import { createTtsRepository } from "@/lib/db/ttsRepository";
import { signSpeech } from "@/lib/receptionist/speechToken";
import type { TtsChunk, TtsClient } from "@/lib/receptionist/ttsClient";
import type { VoiceProfile } from "@/lib/sectors/types";
import type { TestDb } from "../db/pglite";
import { NOW, SHOP } from "./harness";

/** Test harness for POST /api/speech (task 8.5): a fake TTS client, PGlite counters, a log sink. */

export const SECRET = "test-speech-token-secret";
export const MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview"] as const;

export type Behavior =
  | { kind: "chunks"; chunks: number[][]; sampleRate?: number }
  | { kind: "throw"; error: unknown }
  | { kind: "chunksThenThrow"; chunks: number[][]; error: unknown }
  /** Never answers; ends only when the signal aborts. */
  | { kind: "hang" };

export interface TtsCall {
  model: string;
  text: string;
  voice: string;
  profile: VoiceProfile;
}

/** A TTS client whose behaviour is set per model. Records every call, as the real one would spend quota. */
export function fakeTts(behaviors: Partial<Record<string, Behavior>>, models: readonly string[] = MODELS) {
  const calls: TtsCall[] = [];
  const client: TtsClient & { calls: TtsCall[] } = {
    models,
    calls,
    voiceFor: (model, profile) => (model.includes("3.8") ? profile.voice : profile.classicVoice),
    async *stream({ text, profile, model, signal }): AsyncGenerator<TtsChunk> {
      calls.push({ model, text, voice: client.voiceFor(model, profile), profile });
      const b = behaviors[model] ?? { kind: "chunks", chunks: [[1, 2]] };
      if (b.kind === "throw") throw b.error;
      if (b.kind === "hang") {
        await new Promise<never>((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
        return;
      }
      for (const c of b.chunks) yield { pcm: new Uint8Array(c), sampleRate: b.kind === "chunks" ? (b.sampleRate ?? 24000) : 24000 };
      if (b.kind === "chunksThenThrow") throw b.error;
    },
  };
  return client;
}

/** An error as the real TTS client throws it: a GeminiCallError-like object with a status and a class. */
export function apiError(status: number, message: string, errorClass = "APIError"): Error {
  return Object.assign(new Error(message), { status, statusCode: status, errorClass });
}

export interface SpeechSetup {
  POST: (r: Request) => Promise<Response>;
  logs: TtsFallbackLogEvent[];
  deps: SpeechDeps;
  settle: () => Promise<unknown>;
}

export function makeSpeech(
  t: TestDb,
  tts: TtsClient,
  over: Partial<Omit<SpeechDeps, "config">> & { config?: Partial<TtsLimitConfig>; clock?: () => Temporal.Instant } = {},
): SpeechSetup {
  const logs: TtsFallbackLogEvent[] = [];
  const scheduled: Promise<unknown>[] = [];
  const { config, ...rest } = over;
  const deps: SpeechDeps = {
    tts,
    limits: createTtsRepository(t.handle),
    getShop: (id) => t.repo.getShop(id),
    clock: () => NOW,
    config: { ...DEFAULT_TTS_LIMITS, ...config },
    secret: SECRET,
    exhausted: new Map(),
    log: (e) => logs.push(e),
    ...rest,
  };
  const POST = makeSpeechHandler({
    deps: () => deps,
    schedule: (task) => {
      scheduled.push(task());
    },
    salt: () => "test-salt",
  });
  return { POST, logs, deps, settle: () => Promise.all(scheduled) };
}

export function speechRequest(body: unknown, ip = "203.0.113.7", signal?: AbortSignal): Request {
  return new Request("http://localhost/api/speech", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

/** A `say` body for `text`, with a token the Turn_API would have issued at NOW. */
export function sayBody(
  text: string,
  opts: { cacheable?: boolean; language?: "es" | "en"; shopId?: string; nowMs?: number; secret?: string } = {},
) {
  const language = opts.language ?? "es";
  const shopId = opts.shopId ?? SHOP;
  const token = signSpeech(
    { shopId, language, text, cacheable: opts.cacheable ?? true },
    opts.secret ?? SECRET,
    opts.nowMs ?? NOW.epochMilliseconds,
  );
  return { kind: "say" as const, shopId, language, text, token };
}

export const bytesOf = async (res: Response) => [...new Uint8Array(await res.arrayBuffer())];

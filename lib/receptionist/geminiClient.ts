import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { ModelClient } from "@/lib/conversation/types";

/**
 * The only file that imports @google/genai. Server only: the key is read from
 * `GEMINI_API_KEY` (no NEXT_PUBLIC_ prefix, so it is never inlined into a
 * client bundle) and never logged.
 */

/**
 * The models a Turn's attempts use, in order (attempt k uses entry k mod length).
 * Owner decision of 2026-11-16 (front-desk-brain design.md, "Model path constants",
 * question 17): `gemini-flash-lite-latest` answered 13 of 15 measured requests and
 * `gemini-3.5-flash-lite` 10 of 15; `gemini-3.5-flash` was dropped after hanging 13 of 15.
 * Override with GEMINI_MODEL, which may hold one id or a comma-separated list.
 */
export const DEFAULT_GEMINI_MODELS: readonly string[] = ["gemini-flash-lite-latest", "gemini-3.5-flash-lite"];
/** The first model of the default list. */
export const DEFAULT_GEMINI_MODEL = DEFAULT_GEMINI_MODELS[0];
export const MAX_OUTPUT_TOKENS = 400;

/** "a, b,,a" → ["a", "b"]; empty or missing → the default list. */
export function parseModelList(raw: string | undefined): string[] {
  const ids = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const unique = [...new Set(ids)];
  return unique.length > 0 ? unique : [...DEFAULT_GEMINI_MODELS];
}

/** The slice of the SDK this client uses, so a test can pass a fake. */
export interface InteractionsApi {
  interactions: {
    create(
      params: {
        model: string;
        system_instruction: string;
        input: string;
        store: false;
        response_format: { type: "text"; mime_type: "application/json"; schema: { [k: string]: unknown } };
        generation_config: { thinking_level: "low"; max_output_tokens: number };
      },
      options: { signal: AbortSignal; retries: { strategy: "none" } },
    ): PromiseLike<{ output_text?: string | undefined }>;
  };
}

export interface GeminiConfig {
  apiKey: string;
  /** One model id or a comma-separated list (the value of GEMINI_MODEL). */
  model?: string;
  /** For tests: the SDK instance to use. */
  sdk?: InteractionsApi;
}

export function createGeminiClient(cfg: GeminiConfig): ModelClient & { models: readonly string[] } {
  const models = parseModelList(cfg.model);
  const modelFor = (attempt: number) => models[Math.max(0, attempt) % models.length];
  const sdk: InteractionsApi = cfg.sdk ?? new GoogleGenAI({ apiKey: cfg.apiKey });
  return {
    models,
    modelFor,
    async generate({ systemInstruction, input, jsonSchema, signal, attempt = 0 }) {
      const model = modelFor(attempt);
      let interaction: { output_text?: string | undefined };
      try {
        interaction = await sdk.interactions.create(
          {
            model,
            system_instruction: systemInstruction,
            input,
            // Do not keep caller names and phones as stored interactions.
            store: false,
            response_format: { type: "text", mime_type: "application/json", schema: jsonSchema as { [k: string]: unknown } },
            // No temperature / top_p / top_k: Gemini 3.6+ ignore them.
            generation_config: { thinking_level: "low", max_output_tokens: MAX_OUTPUT_TOKENS },
          },
          // Top-level signal (the spike showed fetch_options.signal is unreliable) and no SDK
          // retries, whose backoff can outlast the Model_Wait.
          { signal, retries: { strategy: "none" } },
        );
      } catch (err) {
        throw redactedError(err, cfg.apiKey);
      }
      return interaction.output_text ?? "";
    },
  };
}

/**
 * The SDK error with the key removed from its message, so whatever logs it
 * cannot leak the key. Keeps the status fields (used to classify a 429) and
 * the SDK's class name (most SDK error classes are not exported).
 */
export class GeminiCallError extends Error {
  readonly status?: number;
  readonly statusCode?: number;
  readonly errorClass: string;
  constructor(message: string, errorClass: string, status?: number) {
    super(message);
    this.name = "GeminiCallError";
    this.errorClass = errorClass;
    if (status !== undefined) {
      this.status = status;
      this.statusCode = status;
    }
  }
}

export function redactedError(err: unknown, apiKey: string): GeminiCallError {
  const e = err as { constructor?: { name?: unknown }; message?: unknown; status?: unknown; statusCode?: unknown } | null;
  const raw = typeof e?.message === "string" ? e.message : String(err);
  const message = apiKey ? raw.split(apiKey).join("***") : raw;
  const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : undefined;
  const errorClass = typeof e?.constructor?.name === "string" ? e.constructor.name : typeof err;
  return new GeminiCallError(message, errorClass, status);
}

/** The client from the environment. Throws if the key is missing; the message never contains it. */
export function geminiClientFromEnv(env: Record<string, string | undefined> = process.env): ModelClient {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return createGeminiClient({ apiKey, model: env.GEMINI_MODEL });
}

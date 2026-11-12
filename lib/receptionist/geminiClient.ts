import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { ModelClient } from "@/lib/conversation/types";

/**
 * The only file that imports @google/genai. Server only: the key is read from
 * `GEMINI_API_KEY` (no NEXT_PUBLIC_ prefix, so it is never inlined into a
 * client bundle) and never logged.
 */

/** The model the task-1 spike found answering every call well inside 8 s. Override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const MAX_OUTPUT_TOKENS = 400;

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
  model?: string;
  /** For tests: the SDK instance to use. */
  sdk?: InteractionsApi;
}

export function createGeminiClient(cfg: GeminiConfig): ModelClient {
  const model = cfg.model?.trim() || DEFAULT_GEMINI_MODEL;
  const sdk: InteractionsApi = cfg.sdk ?? new GoogleGenAI({ apiKey: cfg.apiKey });
  return {
    async generate({ systemInstruction, input, jsonSchema, signal }) {
      const interaction = await sdk.interactions.create(
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
        // retries, whose backoff can outlast the 8-second budget.
        { signal, retries: { strategy: "none" } },
      );
      return interaction.output_text ?? "";
    },
  };
}

/** The client from the environment. Throws if the key is missing; the message never contains it. */
export function geminiClientFromEnv(env: Record<string, string | undefined> = process.env): ModelClient {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return createGeminiClient({ apiKey, model: env.GEMINI_MODEL });
}

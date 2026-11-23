import "server-only";
import { GoogleGenAI } from "@google/genai";
import { parseModelList, redactedError } from "@/lib/receptionist/geminiClient";
import type { ExtractModel, ExtractPart } from "./ports";

/** Tokens for the whole JSON of a long price list. */
export const EXTRACT_MAX_OUTPUT_TOKENS = 4096;

/** The slice of the SDK this uses, so a test can pass a fake. */
export interface ExtractSdk {
  interactions: {
    create(
      params: {
        model: string;
        system_instruction: string;
        input: string | ({ type: "text"; text: string } | { type: "document"; data: string; mime_type: string })[];
        store: false;
        response_format: { type: "text"; mime_type: "application/json"; schema: { [k: string]: unknown } };
        generation_config: { thinking_level: "low"; max_output_tokens: number };
      },
      options: { signal: AbortSignal; retries: { strategy: "none" } },
    ): PromiseLike<{ output_text?: string | undefined }>;
  };
}

function inputOf(part: ExtractPart) {
  if (part.kind === "text") return `<document>\n${part.text}\n</document>`;
  return [
    { type: "text" as const, text: "Extract the data from the attached document." },
    { type: "document" as const, data: part.base64, mime_type: "application/pdf" },
  ];
}

/**
 * The Gemini adapter of the extraction: the same key, model list and redaction as the receptionist's
 * client, but a document as input and a larger output budget. Nothing is stored (`store: false`).
 */
export function createGeminiExtractor(cfg: { apiKey: string; model?: string; sdk?: ExtractSdk }): ExtractModel {
  const models = parseModelList(cfg.model);
  const sdk: ExtractSdk = cfg.sdk ?? (new GoogleGenAI({ apiKey: cfg.apiKey }) as unknown as ExtractSdk);
  return {
    models,
    async generate({ systemInstruction, part, jsonSchema, signal, attempt }) {
      const model = models[Math.max(0, attempt) % models.length];
      try {
        const out = await sdk.interactions.create(
          {
            model,
            system_instruction: systemInstruction,
            input: inputOf(part),
            store: false,
            response_format: { type: "text", mime_type: "application/json", schema: jsonSchema as { [k: string]: unknown } },
            generation_config: { thinking_level: "low", max_output_tokens: EXTRACT_MAX_OUTPUT_TOKENS },
          },
          { signal, retries: { strategy: "none" } },
        );
        return out.output_text ?? "";
      } catch (err) {
        throw redactedError(err, cfg.apiKey);
      }
    },
  };
}

export function geminiExtractorFromEnv(env: Record<string, string | undefined> = process.env): ExtractModel {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return createGeminiExtractor({ apiKey, model: env.GEMINI_MODEL });
}

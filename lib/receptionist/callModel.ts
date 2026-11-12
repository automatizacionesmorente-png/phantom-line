import type { ModelClient } from "@/lib/conversation/types";
import { ModelTurnSchema, modelTurnJsonSchema, type ModelTurn } from "./schema";

export type { ModelClient } from "@/lib/conversation/types";
export type ModelFailure = "timeout" | "quota" | "unavailable" | "invalid_output";
export type ModelResult = { ok: true; turn: ModelTurn } | { ok: false; failure: ModelFailure };

export const MODEL_TIMEOUT_MS = 8000;

const TIMED_OUT = Symbol("timed out");

/** Reads fields, not SDK classes: most of the SDK's error classes are not exported. */
function classify(err: unknown): ModelFailure {
  const e = err as { status?: unknown; statusCode?: unknown; message?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : null;
  if (status === 429) return "quota";
  if (typeof e?.message === "string" && /RESOURCE_EXHAUSTED/.test(e.message)) return "quota";
  return "unavailable";
}

/** The model's text as a validated ModelTurn, or null (JSON or zod failure). */
export function parseModelTurn(text: string): ModelTurn | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = ModelTurnSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * One model call with a hard deadline. The signal tells the client to stop,
 * and the race makes the deadline hold even if a client ignores the signal.
 * "timeout" is decided by our own timer, never by the error class.
 * No own I/O: the network happens inside the injected client.
 */
export async function callReceptionist(
  client: ModelClient,
  prompt: { systemInstruction: string; input: string },
  opts: { timeoutMs: number } = { timeoutMs: MODEL_TIMEOUT_MS },
): Promise<ModelResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new DOMException("model call timed out", "TimeoutError"));
      resolve(TIMED_OUT);
    }, opts.timeoutMs);
  });
  const call = client
    .generate({
      systemInstruction: prompt.systemInstruction,
      input: prompt.input,
      jsonSchema: modelTurnJsonSchema,
      signal: controller.signal,
    })
    .then(
      (text) => ({ ok: true as const, text }),
      (err: unknown) => ({ ok: false as const, err }),
    );
  try {
    const result = await Promise.race([call, deadline]);
    if (result === TIMED_OUT || controller.signal.aborted) return { ok: false, failure: "timeout" };
    if (!result.ok) return { ok: false, failure: classify(result.err) };
    const turn = parseModelTurn(result.text);
    return turn ? { ok: true, turn } : { ok: false, failure: "invalid_output" };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Fakes for tests and local runs. None of them touch the network.

/** Answers with the given turns in order (objects are serialized; strings are sent as they are). */
export function createScriptedModel(turns: readonly (ModelTurn | string)[]): ModelClient & {
  calls: { systemInstruction: string; input: string }[];
} {
  const calls: { systemInstruction: string; input: string }[] = [];
  return {
    calls,
    async generate(req) {
      const k = calls.length;
      calls.push({ systemInstruction: req.systemInstruction, input: req.input });
      if (k >= turns.length) throw new Error(`scripted model: no turn ${k + 1} (script has ${turns.length})`);
      const t = turns[k];
      return typeof t === "string" ? t : JSON.stringify(t);
    },
  };
}

/** Never answers and ignores the signal, like a hung connection. */
export const neverResolves: ModelClient = { generate: () => new Promise<string>(() => {}) };

/** Fails like the SDK's RateLimitError: an error with numeric status 429. */
export const throws429: ModelClient = {
  async generate() {
    throw Object.assign(new Error("429 RESOURCE_EXHAUSTED: limit: 5 requests per minute"), { status: 429 });
  },
};

/** Fails like a dropped connection: no status. */
export const throwsNetwork: ModelClient = {
  async generate() {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  },
};

/** Answers with text that is not a valid ModelTurn. */
export const returnsGarbage: ModelClient = {
  async generate() {
    return '{"reply": "hola", "intent": "maybe"';
  },
};

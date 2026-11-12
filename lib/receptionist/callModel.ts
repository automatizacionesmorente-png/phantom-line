import type { ModelClient } from "@/lib/conversation/types";
import { ModelTurnSchema, modelTurnJsonSchema, type ModelTurn } from "./schema";

export type { ModelClient } from "@/lib/conversation/types";
export type ModelFailure = "timeout" | "quota" | "unavailable" | "invalid_output";
export type ModelResult = { ok: true; turn: ModelTurn } | { ok: false; failure: ModelFailure };

export const MODEL_TIMEOUT_MS = 8000;
/**
 * Attempts per Turn for a transient server error (HTTP 5xx, e.g. Gemini's 503
 * "high demand"), all inside the same timeout. A 429 is never retried: it is
 * quota, and retrying burns more of it.
 */
export const MAX_MODEL_ATTEMPTS = 3;

/** Longest error message kept for the server log. */
const MAX_LOGGED_MESSAGE = 300;

/**
 * Why a model call failed, for the server log (design.md, "Error Handling").
 * It never holds the model's text or anything the caller said: zod issues keep
 * only path, code and zod's own message, and a JSON syntax error keeps only its
 * position, because V8's message quotes the text it could not parse.
 */
export interface ModelFailureInfo {
  failure: ModelFailure;
  latencyMs: number;
  /** Model calls made in this Turn (more than 1 after a retried 5xx). */
  attempts?: number;
  /** The errors of the attempts before the last one (each was a retried 5xx). */
  earlier?: Pick<ModelFailureInfo, "status" | "errorClass" | "message">[];
  /** HTTP status of an API error, when it has one. */
  status?: number;
  /** Error class name, e.g. "APIConnectionError", "TypeError". */
  errorClass?: string;
  /** The error's own message, truncated. The Gemini client redacts the key before it gets here. */
  message?: string;
  /** invalid_output: why the text was rejected. */
  invalid?:
    | { kind: "empty" }
    | { kind: "json"; length: number }
    | { kind: "schema"; length: number; issues: { path: string; code: string; message: string }[] };
}

const TIMED_OUT = Symbol("timed out");

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; statusCode?: unknown } | null;
  return typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : undefined;
}

/** Reads fields, not SDK classes: most of the SDK's error classes are not exported. */
function classify(err: unknown): ModelFailure {
  const e = err as { message?: unknown } | null;
  if (statusOf(err) === 429) return "quota";
  if (typeof e?.message === "string" && /RESOURCE_EXHAUSTED/.test(e.message)) return "quota";
  return "unavailable";
}

/** A server-side error worth one more try in the same Turn: HTTP 500–599. */
function isTransient(err: unknown): boolean {
  const status = statusOf(err);
  return status !== undefined && status >= 500 && status <= 599;
}

function errorFields(err: unknown): Pick<ModelFailureInfo, "status" | "errorClass" | "message"> {
  const e = err as { constructor?: { name?: unknown }; name?: unknown; message?: unknown; errorClass?: unknown } | null;
  const status = statusOf(err);
  const errorClass =
    typeof e?.errorClass === "string"
      ? e.errorClass
      : typeof e?.constructor?.name === "string" && e.constructor.name !== "Object"
      ? e.constructor.name
      : typeof e?.name === "string"
        ? e.name
        : typeof err;
  const message = typeof e?.message === "string" ? e.message.slice(0, MAX_LOGGED_MESSAGE) : undefined;
  return { ...(status !== undefined ? { status } : {}), errorClass, ...(message !== undefined ? { message } : {}) };
}

export type ParsedModelTurn =
  | { ok: true; turn: ModelTurn }
  | { ok: false; invalid: NonNullable<ModelFailureInfo["invalid"]> };

/** The model's text as a validated ModelTurn, or why it is not one. */
export function inspectModelTurn(text: string): ParsedModelTurn {
  if (text.trim() === "") return { ok: false, invalid: { kind: "empty" } };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, invalid: { kind: "json", length: text.length } };
  }
  const parsed = ModelTurnSchema.safeParse(json);
  if (parsed.success) return { ok: true, turn: parsed.data };
  return {
    ok: false,
    invalid: {
      kind: "schema",
      length: text.length,
      issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), code: i.code, message: i.message })),
    },
  };
}

/** The model's text as a validated ModelTurn, or null (JSON or zod failure). */
export function parseModelTurn(text: string): ModelTurn | null {
  const r = inspectModelTurn(text);
  return r.ok ? r.turn : null;
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
  opts: { timeoutMs: number; onFailure?: (info: ModelFailureInfo) => void } = { timeoutMs: MODEL_TIMEOUT_MS },
): Promise<ModelResult> {
  const startedAt = Date.now();
  let attempts = 0;
  const earlier: Pick<ModelFailureInfo, "status" | "errorClass" | "message">[] = [];
  const fail = (info: Omit<ModelFailureInfo, "latencyMs" | "attempts" | "earlier">): ModelResult => {
    try {
      opts.onFailure?.({
        ...info,
        attempts,
        ...(earlier.length > 0 ? { earlier } : {}),
        latencyMs: Date.now() - startedAt,
      });
    } catch {
      // A failing logger must never change the outcome of the Turn.
    }
    return { ok: false, failure: info.failure };
  };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new DOMException("model call timed out", "TimeoutError"));
      resolve(TIMED_OUT);
    }, opts.timeoutMs);
  });
  // A 5xx is retried at once (the error itself took about a second to arrive), until
  // MAX_MODEL_ATTEMPTS or the deadline. Any other error ends the attempts.
  const call = (async (): Promise<{ ok: true; text: string } | { ok: false; err: unknown }> => {
    for (;;) {
      attempts++;
      try {
        const text = await client.generate({
          systemInstruction: prompt.systemInstruction,
          input: prompt.input,
          jsonSchema: modelTurnJsonSchema,
          signal: controller.signal,
        });
        return { ok: true, text };
      } catch (err) {
        if (controller.signal.aborted || attempts >= MAX_MODEL_ATTEMPTS || !isTransient(err)) return { ok: false, err };
        earlier.push(errorFields(err));
      }
    }
  })();
  try {
    const result = await Promise.race([call, deadline]);
    if (result === TIMED_OUT || controller.signal.aborted) return fail({ failure: "timeout" });
    if (!result.ok) return fail({ failure: classify(result.err), ...errorFields(result.err) });
    const parsed = inspectModelTurn(result.text);
    return parsed.ok ? { ok: true, turn: parsed.turn } : fail({ failure: "invalid_output", invalid: parsed.invalid });
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

/**
 * The error `@google/genai` 2.32 threw in the first end-to-end test (2026-11-12):
 * an `InternalServerError` (an `APIError`) with `status` and `statusCode` 503,
 * Gemini's "high demand" message and a `CreateInteractionServerError` as cause.
 * The SDK's classes are not exported, so this rebuilds the same shape.
 */
export function geminiHighDemandError(model = "gemini-3.5-flash-lite"): Error {
  class CreateInteractionServerError extends Error {}
  class InternalServerError extends Error {}
  const text = `${model} is currently experiencing high demand, spikes in demand are usually temporary. Please try again later.`;
  const cause = new CreateInteractionServerError(text);
  cause.name = "CreateInteractionServerError";
  const err = new InternalServerError(`503 ${text}`);
  err.name = "InternalServerError";
  return Object.assign(err, { status: 503, statusCode: 503, error: { code: 503, message: text, status: "UNAVAILABLE" }, cause });
}

/** Throws Gemini's 503 "high demand" `failures` times, then answers like `then`. */
export function failsWith503(failures: number, then: ModelClient): ModelClient & { calls: number } {
  const m = {
    calls: 0,
    async generate(req: Parameters<ModelClient["generate"]>[0]) {
      m.calls++;
      if (m.calls <= failures) throw geminiHighDemandError();
      return then.generate(req);
    },
  };
  return m;
}

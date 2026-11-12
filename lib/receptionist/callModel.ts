import type { ModelClient } from "@/lib/conversation/types";
import { ModelTurnSchema, modelTurnJsonSchema, type ModelTurn } from "./schema";

export type { ModelClient } from "@/lib/conversation/types";
export type ModelFailure = "timeout" | "quota" | "unavailable" | "invalid_output";
export type ModelResult = { ok: true; turn: ModelTurn } | { ok: false; failure: ModelFailure };

/** The whole budget of one Turn's model call, every attempt included (Requirement 4.7). */
export const MODEL_TIMEOUT_MS = 8000;
/**
 * The deadline of one attempt. When it expires without an answer, a fresh attempt
 * starts (with the next model of the list) beside it, so one hung request can never
 * use the whole budget. The first answer from any attempt wins, and every attempt
 * still running is aborted when the Turn settles. Chosen from measurements
 * (design.md, "Model attempts").
 */
export const ATTEMPT_TIMEOUT_MS = 2500;
/**
 * A fresh attempt gets its own deadline only if at least this much budget would be
 * left after it; otherwise it is the last attempt and keeps the rest of the budget.
 */
export const MIN_ATTEMPT_MS = 1500;
/**
 * Attempts per Turn, all inside MODEL_TIMEOUT_MS. A new attempt starts after an
 * attempt deadline or a transient server error (HTTP 5xx, e.g. Gemini's 503
 * "high demand"). A 429 is never retried: it is quota, and retrying burns more of
 * it. The cap also stops a client that fails instantly from spinning.
 */
export const MAX_MODEL_ATTEMPTS = 4;

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
  /** Model calls made in this Turn (more than 1 after an attempt deadline or a retried 5xx). */
  attempts?: number;
  /** The model of the last attempt, when the client reports it. */
  model?: string;
  /** The attempts before the last one: each hit its own deadline or answered a 5xx. */
  earlier?: AttemptRecord[];
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

/** One attempt that did not give the Turn its answer, for the log. */
export interface AttemptRecord {
  /** attempt_timeout: no answer by its own deadline; unfinished: still running, without a deadline of its own, when the Turn settled. */
  outcome: "attempt_timeout" | "unfinished" | "5xx" | "error";
  latencyMs: number;
  model?: string;
  status?: number;
  errorClass?: string;
  message?: string;
}

/** How a successful call went, for scripts and logs. */
export interface ModelSuccessInfo {
  latencyMs: number;
  attempts: number;
  model?: string;
  earlier?: AttemptRecord[];
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
 * One model call with a hard deadline for the whole Turn and a shorter one per
 * attempt. When an attempt's deadline expires (a hung or slow request), a fresh
 * attempt starts beside it; when the newest attempt answers a 5xx, a fresh one
 * starts at once. The attempt number is passed on so a client with a model list
 * can switch models. The first valid answer wins; all attempts share one abort
 * signal, aborted when the Turn settles or at the overall deadline, and the race
 * makes the deadline hold even if a client ignores the signal. "timeout" is
 * decided by our own timer, never by the error class. No own I/O: the network
 * happens inside the injected client.
 */
export async function callReceptionist(
  client: ModelClient,
  prompt: { systemInstruction: string; input: string },
  opts: {
    timeoutMs: number;
    /** Per-attempt deadline (default ATTEMPT_TIMEOUT_MS). */
    attemptTimeoutMs?: number;
    onFailure?: (info: ModelFailureInfo) => void;
    onSuccess?: (info: ModelSuccessInfo) => void;
  } = { timeoutMs: MODEL_TIMEOUT_MS },
): Promise<ModelResult> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const attemptMs = opts.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  let attempts = 0;
  let model: string | undefined;
  const earlier: AttemptRecord[] = [];
  const report = <T>(fn: ((info: T) => void) | undefined, info: T) => {
    try {
      fn?.(info);
    } catch {
      // A failing logger must never change the outcome of the Turn.
    }
  };
  const fail = (info: Omit<ModelFailureInfo, "latencyMs" | "attempts" | "earlier" | "model">): ModelResult => {
    report(opts.onFailure, {
      ...info,
      attempts,
      ...(model !== undefined ? { model } : {}),
      ...(earlier.length > 0 ? { earlier } : {}),
      latencyMs: elapsed(),
    });
    return { ok: false, failure: info.failure };
  };

  const overall = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      overall.abort(new DOMException("model call timed out", "TimeoutError"));
      resolve(TIMED_OUT);
    }, opts.timeoutMs);
  });

  /** One record per attempt; the winner's (or the last failure's) is dropped from `earlier`. */
  const records: AttemptRecord[] = [];
  const starts: number[] = [];
  let decisive = -1;
  const call = new Promise<{ ok: true; text: string } | { ok: false; err: unknown }>((resolve) => {
    let done = false;
    let inflight = 0;
    let nextTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (k: number, r: { ok: true; text: string } | { ok: false; err: unknown }) => {
      if (done) return;
      done = true;
      decisive = k;
      model = records[k]?.model;
      clearTimeout(nextTimer);
      resolve(r);
    };
    overall.signal.addEventListener("abort", () => clearTimeout(nextTimer), { once: true });

    const launch = () => {
      if (done || overall.signal.aborted) return;
      const k = attempts++;
      const m = client.modelFor?.(k);
      const startAt = elapsed();
      // The last attempt keeps the rest of the budget: no fresh attempt could follow it.
      const last = attempts >= MAX_MODEL_ATTEMPTS || opts.timeoutMs - startAt - attemptMs < MIN_ATTEMPT_MS;
      records.push({ outcome: "unfinished", latencyMs: 0, ...(m !== undefined ? { model: m } : {}) });
      starts.push(startAt);
      let newest = true;
      if (!last) {
        // Hedged: at its deadline a fresh attempt starts, and this one keeps running. The
        // measurements of 2026-11-12 showed answers 2.5–3.5 s after the request; aborting
        // them would throw away the quickest answer the Turn could get.
        nextTimer = setTimeout(() => {
          newest = false;
          records[k] = { ...records[k], outcome: "attempt_timeout", latencyMs: attemptMs };
          launch();
        }, attemptMs);
      }
      inflight++;
      let pending: Promise<string>;
      try {
        pending = client.generate({
          systemInstruction: prompt.systemInstruction,
          input: prompt.input,
          jsonSchema: modelTurnJsonSchema,
          signal: overall.signal,
          attempt: k,
        });
      } catch (err) {
        pending = Promise.reject(err);
      }
      pending.then(
          (text) => {
            inflight--;
            finish(k, { ok: true, text });
          },
          (err: unknown) => {
            inflight--;
            if (done || overall.signal.aborted) return;
            records[k] = {
              ...records[k],
              outcome: isTransient(err) ? "5xx" : "error",
              latencyMs: elapsed() - startAt,
              ...errorFields(err),
            };
            // A 429 is quota: never retried, and the Turn ends now (Requirement 4.7).
            if (statusOf(err) === 429 || /RESOURCE_EXHAUSTED/.test(String((err as { message?: unknown })?.message))) {
              return finish(k, { ok: false, err });
            }
            const canRetry =
              isTransient(err) && attempts < MAX_MODEL_ATTEMPTS && opts.timeoutMs - elapsed() >= MIN_ATTEMPT_MS;
            if (newest) {
              clearTimeout(nextTimer);
              newest = false;
              // Only a 5xx starts a fresh attempt; a network error or an abort never does.
              if (canRetry) return launch();
            }
            // An older attempt failed while a newer one is still running: wait for that one.
            if (inflight > 0) return;
            finish(k, { ok: false, err });
          },
        );
    };
    launch();
  });

  try {
    const result = await Promise.race([call, deadline]);
    // Stop every attempt still running: the Turn has its answer, or its time is up.
    if (!overall.signal.aborted) overall.abort(new DOMException("model call settled", "AbortError"));
    const settledAt = elapsed();
    const others = records
      .map((r, k) => (r.outcome === "unfinished" ? { ...r, latencyMs: settledAt - starts[k] } : r))
      .filter((_, k) => k !== (result === TIMED_OUT ? records.length - 1 : decisive));
    earlier.push(...others);
    if (result === TIMED_OUT) {
      model = records.at(-1)?.model;
      return fail({ failure: "timeout" });
    }
    if (!result.ok) return fail({ failure: classify(result.err), ...errorFields(result.err) });
    const parsed = inspectModelTurn(result.text);
    if (!parsed.ok) return fail({ failure: "invalid_output", invalid: parsed.invalid });
    report(opts.onSuccess, {
      latencyMs: elapsed(),
      attempts,
      ...(model !== undefined ? { model } : {}),
      ...(earlier.length > 0 ? { earlier } : {}),
    });
    return { ok: true, turn: parsed.turn };
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

/**
 * Hangs (ignoring the signal) on its first `hangs` calls, then answers like `then`:
 * the shape of the real failures of 2026-11-12, where one request hung for the whole
 * budget while the next request answered in about a second.
 */
export function hangsThen(hangs: number, then: ModelClient): ModelClient & { calls: number; attempts: number[] } {
  const m = {
    calls: 0,
    attempts: [] as number[],
    async generate(req: Parameters<ModelClient["generate"]>[0]) {
      m.calls++;
      m.attempts.push(req.attempt ?? 0);
      if (m.calls <= hangs) return new Promise<string>(() => {});
      return then.generate(req);
    },
  };
  return m;
}

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

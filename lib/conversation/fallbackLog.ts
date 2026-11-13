import type { ModelFailureInfo } from "@/lib/receptionist/callModel";

/**
 * What the server logs when a Caller hears a Fallback_Message (design.md,
 * "Error Handling", "Logging a fallback"). One JSON line per fallback.
 * It never contains the API key, the model's text, the utterance, the
 * transcript, the caller's name or phone, or the hashed visitor key.
 */
export type FallbackReason = "rate_limit" | "timeout" | "quota" | "unavailable" | "invalid_output" | "exception";

export interface FallbackLogEvent {
  event: "turn_fallback";
  /** end: the Call closes with a Message; retry: the Call continues; start: no Call yet; http_503: the adapter answered 503. */
  path: "end" | "retry" | "start" | "http_503";
  reason: FallbackReason;
  shopId: string;
  callId?: string;
  /** The Turn number the fallback answered (1 = first `say`). */
  turn?: number;
  /** rate_limit: which cap. */
  limit?: "visitor" | "global";
  /** Model failures: status, class, message, latency, zod issues. */
  model?: ModelFailureInfo;
  /** exception: class, SQLSTATE code and message of the error (or of its cause for a database error). */
  error?: ErrorSummary;
}

export interface ErrorSummary {
  errorClass: string;
  code?: string;
  message?: string;
  /** The first stack frame, so a bug can be found without the message. */
  at?: string;
}

export type FallbackLogger = (event: FallbackLogEvent) => void;

const MAX_MESSAGE = 300;

/** The default logger: one JSON line on stderr. */
export const consoleFallbackLogger: FallbackLogger = (event) => {
  console.error(JSON.stringify(event));
};

function className(e: { constructor?: { name?: unknown }; name?: unknown } | null, fallback: string): string {
  if (typeof e?.constructor?.name === "string" && e.constructor.name !== "Object") return e.constructor.name;
  return typeof e?.name === "string" ? e.name : fallback;
}

/**
 * An unexpected error, safe to log. A Drizzle query error carries the query's
 * parameters (names, phones) in its message, so for any error with `params`
 * the summary describes its cause instead and leaves the parameters out.
 */
export function summarizeError(err: unknown): ErrorSummary {
  type E = { constructor?: { name?: unknown }; name?: unknown; message?: unknown; code?: unknown; stack?: unknown; cause?: unknown; params?: unknown };
  const outer = (err ?? null) as E | null;
  const hasParams = outer !== null && typeof outer === "object" && "params" in outer;
  const e = (hasParams ? ((outer.cause ?? null) as E | null) : outer) ?? null;
  const errorClass = hasParams
    ? `${className(outer, "Error")}(${e ? className(e, "Error") : "no cause"})`
    : className(e, typeof err);
  const code = typeof e?.code === "string" ? e.code : undefined;
  const message = typeof e?.message === "string" ? e.message.slice(0, MAX_MESSAGE) : undefined;
  const frame =
    typeof outer?.stack === "string"
      ? outer.stack
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.startsWith("at "))
      : undefined;
  return {
    errorClass,
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(frame ? { at: frame.slice(0, MAX_MESSAGE) } : {}),
  };
}

// ---------------------------------------------------------------------------
// tts_fallback (natural-voice Requirements 4.5–4.7, design.md "tts_fallback log")

export type TtsFallbackReason =
  | "quota"
  | "rate_limit"
  | "unavailable"
  | "timeout"
  | "stall"
  | "playback_error"
  | "network"
  | "token";

/**
 * One JSON line each time the neural voice is not heard for a reply. Same redaction as
 * `turn_fallback`: it never contains the reply text, the token, the caller's words, a name, a
 * phone or the visitor key, and the API key only as `***`.
 */
export interface TtsFallbackLogEvent {
  event: "tts_fallback";
  /** server: `/api/speech` answered with an error; browser: the Call_Page fell back on its own (a `report`). */
  source: "server" | "browser";
  reason: TtsFallbackReason;
  shopId: string;
  language: "es" | "en";
  /** The line carries no caller data (it was signed cacheable, or the browser says it was a cached line). */
  fixed: boolean;
  /** rate_limit: which cap. */
  limit?: "visitor" | "hour" | "day";
  model?: string;
  status?: number;
  errorClass?: string;
  /** At most 300 characters, scrubbed (see `scrubMessage`). */
  message?: string;
  latencyMs: number;
  /** Models marked exhausted when the request was handled. */
  exhaustedModels?: string[];
}

export type TtsFallbackLogger = (event: TtsFallbackLogEvent) => void;

const REMOVED = "[…]";

export const consoleTtsFallbackLogger: TtsFallbackLogger = (event) => {
  console.error(JSON.stringify(event));
};

/**
 * An error message made safe to log: the API key becomes `***`; the token, the visitor key and
 * the whole text are removed; and so is every word of the text with 2 or more characters (a
 * name, a phone's digit words) in case the API echoed part of it. Then cut to 300 characters.
 */
export function scrubMessage(
  message: string,
  secrets: { apiKey?: string; text?: string; token?: string; visitorKey?: string },
): string {
  let out = message;
  if (secrets.apiKey) out = out.split(secrets.apiKey).join("***");
  // The placeholder has no letters or digits, so a later word can never match inside it.
  for (const s of [secrets.text, secrets.token, secrets.visitorKey]) if (s) out = out.split(s).join(REMOVED);
  if (secrets.text) {
    const words = [...new Set(secrets.text.split(/[^\p{L}\p{N}+]+/u).filter((w) => w.length >= 2))];
    // Longest first, so a word inside a longer one does not leave a fragment behind.
    words.sort((a, b) => b.length - a.length);
    for (const w of words) out = out.split(w).join(REMOVED);
  }
  return out.slice(0, MAX_MESSAGE);
}

/** The safe fields of an error for a `tts_fallback` line. */
export function ttsErrorFields(
  err: unknown,
  secrets: Parameters<typeof scrubMessage>[1],
): Pick<TtsFallbackLogEvent, "status" | "errorClass" | "message"> {
  const e = (err ?? null) as { status?: unknown; statusCode?: unknown; errorClass?: unknown; message?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : undefined;
  const errorClass =
    typeof e?.errorClass === "string" ? e.errorClass : className(e as { constructor?: { name?: unknown } } | null, typeof err);
  const message = typeof e?.message === "string" ? scrubMessage(e.message, secrets) : undefined;
  return { ...(status !== undefined ? { status } : {}), errorClass, ...(message ? { message } : {}) };
}

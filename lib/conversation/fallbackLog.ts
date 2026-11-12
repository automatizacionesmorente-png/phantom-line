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

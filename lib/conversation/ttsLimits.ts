import { Temporal } from "temporal-polyfill";

/**
 * TTS limits and model choice (natural-voice Requirements 4.4 and 5.5, design.md "/api/speech
 * contract" and "TTS client"). Pure: the counts come from `rate_limits` through a port.
 *
 * - `tts:<visitor>` per minute, `tts-global-h` per hour and `tts-global-d` per Pacific day, so the
 *   text model keeps its own quota and the TTS caps sit below the measured TTS quota.
 * - `tts-exhausted:<model>`: a model that answered 429 is out until the next midnight Pacific
 *   (when the free-tier daily quota resets), and is never asked again before then.
 */

export interface TtsLimitConfig {
  perVisitorPerMinute: number;
  globalPerHour: number;
  globalPerDay: number;
}

/** 30 a day is the measured total of the three streaming models (10 each). */
export const DEFAULT_TTS_LIMITS: TtsLimitConfig = { perVisitorPerMinute: 12, globalPerHour: 20, globalPerDay: 30 };

export interface TtsCounts {
  visitor: number;
  hour: number;
  day: number;
}

export type TtsLimitDecision = { blocked: false } | { blocked: true; limit: "visitor" | "hour" | "day" };

/** Counts already include this request, so the 12th in a minute is allowed and the 13th is blocked. */
export function checkTtsLimits(counts: TtsCounts, config: TtsLimitConfig): TtsLimitDecision {
  if (counts.visitor > config.perVisitorPerMinute) return { blocked: true, limit: "visitor" };
  if (counts.hour > config.globalPerHour) return { blocked: true, limit: "hour" };
  if (counts.day > config.globalPerDay) return { blocked: true, limit: "day" };
  return { blocked: false };
}

/** Limits from the environment (no code change to tune them); bad or missing values use the defaults. */
export function ttsLimitsFromEnv(env: Record<string, string | undefined>): TtsLimitConfig {
  const read = (key: string, fallback: number) => {
    const raw = env[key];
    if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
    const n = Number(raw.trim());
    return n >= 1 ? n : fallback;
  };
  return {
    perVisitorPerMinute: read("TTS_LIMIT_PER_VISITOR_PER_MINUTE", DEFAULT_TTS_LIMITS.perVisitorPerMinute),
    globalPerHour: read("TTS_LIMIT_GLOBAL_PER_HOUR", DEFAULT_TTS_LIMITS.globalPerHour),
    globalPerDay: read("TTS_LIMIT_GLOBAL_PER_DAY", DEFAULT_TTS_LIMITS.globalPerDay),
  };
}

/** The free-tier daily quota resets at midnight in this zone (spike: "retry in 9h20m25s" → 08:00 UTC). */
export const TTS_QUOTA_TIME_ZONE = "America/Los_Angeles";

/** The start of the Pacific day that contains `now`: the window of `tts-global-d`. */
export function quotaDayStart(now: Temporal.Instant): Temporal.Instant {
  return now.toZonedDateTimeISO(TTS_QUOTA_TIME_ZONE).startOfDay().toInstant();
}

/** The next midnight Pacific after `now`: when an exhausted model may be asked again. Always later than `now`. */
export function nextQuotaReset(now: Temporal.Instant): Temporal.Instant {
  const today = now.toZonedDateTimeISO(TTS_QUOTA_TIME_ZONE).toPlainDate();
  return today.add({ days: 1 }).toZonedDateTime({ timeZone: TTS_QUOTA_TIME_ZONE }).toInstant();
}

export const TTS_EXHAUSTED_PREFIX = "tts-exhausted:";
export const ttsExhaustedKey = (model: string) => `${TTS_EXHAUSTED_PREFIX}${model}`;
export const ttsVisitorKey = (visitorKey: string) => `tts:${visitorKey}`;
export const TTS_GLOBAL_HOUR_KEY = "tts-global-h";
export const TTS_GLOBAL_DAY_KEY = "tts-global-d";
/** The pre-generation script's successes per model per Pacific day (task 9.10). */
export const ttsPregenKey = (model: string) => `tts-pregen:${model}`;

/** The pre-generation script's port to `rate_limits` (lib/db/ttsRepository.ts). */
export interface PregenQuotaStore {
  /** Models marked exhausted (by the app or the script) whose mark has not expired. */
  exhausted(now: Temporal.Instant): Promise<string[]>;
  markExhausted(model: string, until: Temporal.Instant): Promise<void>;
  /** How many lines the script already synthesized on `model` in the Pacific day of `now`. */
  successesToday(model: string, now: Temporal.Instant): Promise<number>;
  countSuccess(model: string, now: Temporal.Instant): Promise<void>;
}

/** The configured models a request may try, in order, with every exhausted one left out. */
export function modelsToTry(models: readonly string[], exhausted: ReadonlySet<string>): string[] {
  return models.filter((m) => !exhausted.has(m));
}

/** The first model that has not answered 429 today, or null when every model is out. */
export function pickTtsModel(models: readonly string[], exhausted: ReadonlySet<string>): string | null {
  return modelsToTry(models, exhausted)[0] ?? null;
}

/**
 * The marks this process holds in memory, merged with the rows every instance shares. A mark
 * whose reset time has passed no longer counts.
 */
export function exhaustedNow(
  memory: ReadonlyMap<string, number>,
  shared: readonly string[],
  now: Temporal.Instant,
): Set<string> {
  const out = new Set(shared);
  for (const [model, untilMs] of memory) if (untilMs > now.epochMilliseconds) out.add(model);
  return out;
}

/** The port to `rate_limits` (implemented in lib/db/ttsRepository.ts, faked in tests). */
export interface TtsLimitStore {
  /** Counts one `say` in the visitor's minute, the global hour and the Pacific day; also returns the models exhausted now. */
  hitSay(visitorKey: string, now: Temporal.Instant): Promise<{ counts: TtsCounts; exhausted: string[] }>;
  /** Counts one browser `report` in the visitor's minute (it spends no TTS quota). */
  hitReport(visitorKey: string, now: Temporal.Instant): Promise<number>;
  /** Marks `model` exhausted until `until`. Idempotent. */
  markExhausted(model: string, until: Temporal.Instant): Promise<void>;
}

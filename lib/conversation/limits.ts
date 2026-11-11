export interface LimitConfig {
  perVisitorPerMinute: number;
  globalPerHour: number;
}
export type LimitDecision = { blocked: false } | { blocked: true; limit: "visitor" | "global" };

export const DEFAULT_LIMITS: LimitConfig = { perVisitorPerMinute: 12, globalPerHour: 200 };

/**
 * Counts already include the current Turn, so the 12th Turn in a minute is
 * allowed and the 13th is blocked.
 */
export function checkLimits(counts: { visitor: number; global: number }, config: LimitConfig): LimitDecision {
  if (counts.visitor > config.perVisitorPerMinute) return { blocked: true, limit: "visitor" };
  if (counts.global > config.globalPerHour) return { blocked: true, limit: "global" };
  return { blocked: false };
}

/** Limits from the environment (no code change to tune them); bad or missing values use the defaults. */
export function limitsFromEnv(env: Record<string, string | undefined>): LimitConfig {
  const read = (key: string, fallback: number) => {
    const raw = env[key];
    if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
    const n = Number(raw.trim());
    return n >= 1 ? n : fallback;
  };
  return {
    perVisitorPerMinute: read("TURN_LIMIT_PER_VISITOR_PER_MINUTE", DEFAULT_LIMITS.perVisitorPerMinute),
    globalPerHour: read("TURN_LIMIT_GLOBAL_PER_HOUR", DEFAULT_LIMITS.globalPerHour),
  };
}

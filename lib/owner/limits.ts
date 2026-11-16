/**
 * PIN attempt limits (Requirement 2.2, 2.3). Every Shop: 5 per Visitor per 15-minute window.
 * A Real_Shop also: 30 per Shop per hour. The Demo_Shop has no shop-wide cap, because its PIN
 * is public and one script could otherwise lock every judge out. Windows are fixed, in UTC. Pure.
 */
import { Temporal } from "temporal-polyfill";

export interface PinLimitConfig {
  perVisitorPer15Min: number;
  perShopPerHour: number;
}

export type PinLimitDecision = { blocked: false } | { blocked: true; limit: "visitor" | "shop" };

export const DEFAULT_PIN_LIMITS: PinLimitConfig = { perVisitorPer15Min: 5, perShopPerHour: 30 };

const VISITOR_WINDOW_MS = 15 * 60_000;
const SHOP_WINDOW_MS = 60 * 60_000;

/** Limits from the environment; a missing, non-integer or zero value uses the default. */
export function pinLimitsFromEnv(env: Record<string, string | undefined>): PinLimitConfig {
  const read = (key: string, fallback: number) => {
    const raw = env[key]?.trim();
    if (raw === undefined || !/^\d{1,9}$/.test(raw)) return fallback;
    const n = Number(raw);
    return n >= 1 ? n : fallback;
  };
  return {
    perVisitorPer15Min: read("PIN_LIMIT_PER_VISITOR_PER_15MIN", DEFAULT_PIN_LIMITS.perVisitorPer15Min),
    perShopPerHour: read("PIN_LIMIT_PER_SHOP_PER_HOUR", DEFAULT_PIN_LIMITS.perShopPerHour),
  };
}

/** Counts include this attempt, as in checkLimits. `shop` is null for the Demo_Shop, which has no shop-wide cap. */
export function checkPinAttempts(
  counts: { visitor: number; shop: number | null },
  cfg: PinLimitConfig,
): PinLimitDecision {
  if (counts.visitor > cfg.perVisitorPer15Min) return { blocked: true, limit: "visitor" };
  if (counts.shop !== null && counts.shop > cfg.perShopPerHour) return { blocked: true, limit: "shop" };
  return { blocked: false };
}

function windowStart(now: Temporal.Instant, sizeMs: number): Temporal.Instant {
  const ms = now.epochMilliseconds;
  return Temporal.Instant.fromEpochMilliseconds(Math.floor(ms / sizeMs) * sizeMs);
}

export interface PinCounterKey {
  key: string;
  windowStart: Temporal.Instant;
}

/** "pin:v:<shop>:<visitor>" 15 min for every Shop; "pin:s:<shop>" 1 h only when `demo` is false. */
export function pinCounterKeys(
  shopId: string,
  visitorKey: string,
  now: Temporal.Instant,
  demo: boolean,
): readonly PinCounterKey[] {
  const visitor: PinCounterKey = {
    key: `pin:v:${shopId}:${visitorKey}`,
    windowStart: windowStart(now, VISITOR_WINDOW_MS),
  };
  if (demo) return [visitor];
  return [visitor, { key: `pin:s:${shopId}`, windowStart: windowStart(now, SHOP_WINDOW_MS) }];
}

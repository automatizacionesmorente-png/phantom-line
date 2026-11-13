import { and, eq, gt, like, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import {
  quotaDayStart,
  TTS_EXHAUSTED_PREFIX,
  TTS_GLOBAL_DAY_KEY,
  TTS_GLOBAL_HOUR_KEY,
  ttsExhaustedKey,
  ttsPregenKey,
  ttsVisitorKey,
  type PregenQuotaStore,
  type TtsLimitStore,
} from "@/lib/conversation/ttsLimits";
import { rateWindows, type DbHandle } from "./repository";
import { rateLimits } from "./schema";

const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);

/**
 * The TTS counters and exhausted-model marks, in the existing `rate_limits` table with the same
 * upsert as the Turn limits (natural-voice Requirement 5.5). No new table.
 *
 * An exhausted mark is stored with `window_start` = the moment it expires (the next midnight
 * Pacific), so "exhausted now" is `window_start > now`, and the sweep, which deletes windows that
 * started more than 24 hours ago, only removes marks long after they expired.
 */
export function createTtsRepository(handle: DbHandle): TtsLimitStore {
  const { db } = handle;
  const upsert = (rows: { key: string; windowStart: Date }[]) =>
    db
      .insert(rateLimits)
      .values(rows.map((r) => ({ ...r, count: 1 })))
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ key: rateLimits.key, count: rateLimits.count });

  return {
    async hitSay(visitorKey, now) {
      const w = rateWindows(now);
      const visitor = ttsVisitorKey(visitorKey);
      // One counter statement and one read of the marks, in parallel: one round trip before the model call.
      const [rows, marks] = await Promise.all([
        upsert([
          { key: visitor, windowStart: toDate(w.visitorWindow) },
          { key: TTS_GLOBAL_HOUR_KEY, windowStart: toDate(w.globalWindow) },
          { key: TTS_GLOBAL_DAY_KEY, windowStart: toDate(quotaDayStart(now)) },
        ]),
        db
          .select({ key: rateLimits.key })
          .from(rateLimits)
          .where(and(like(rateLimits.key, `${TTS_EXHAUSTED_PREFIX}%`), gt(rateLimits.windowStart, toDate(now)))),
      ]);
      const count = (key: string) => rows.find((r) => r.key === key)?.count ?? 0;
      return {
        counts: { visitor: count(visitor), hour: count(TTS_GLOBAL_HOUR_KEY), day: count(TTS_GLOBAL_DAY_KEY) },
        exhausted: marks.map((m) => m.key.slice(TTS_EXHAUSTED_PREFIX.length)),
      };
    },

    async hitReport(visitorKey, now) {
      const visitor = ttsVisitorKey(visitorKey);
      const rows = await upsert([{ key: visitor, windowStart: toDate(rateWindows(now).visitorWindow) }]);
      return rows.find((r) => r.key === visitor)?.count ?? 0;
    },

    async markExhausted(model, until) {
      await db
        .insert(rateLimits)
        .values({ key: ttsExhaustedKey(model), windowStart: toDate(until), count: 1 })
        .onConflictDoNothing({ target: [rateLimits.key, rateLimits.windowStart] });
    },
  };
}

/**
 * The pre-generation script's view of the TTS quota (task 9.10), in `rate_limits` too: the same
 * `tts-exhausted:<model>` marks the app writes and reads, and one `tts-pregen:<model>` counter per
 * model per Pacific day, so a second run on the same day knows how many requests the first spent.
 */
export function createPregenQuotaStore(handle: DbHandle): PregenQuotaStore {
  const { db } = handle;
  const limits = createTtsRepository(handle);
  return {
    async exhausted(now) {
      const rows = await db
        .select({ key: rateLimits.key })
        .from(rateLimits)
        .where(and(like(rateLimits.key, `${TTS_EXHAUSTED_PREFIX}%`), gt(rateLimits.windowStart, toDate(now))));
      return rows.map((r) => r.key.slice(TTS_EXHAUSTED_PREFIX.length));
    },
    markExhausted: (model, until) => limits.markExhausted(model, until),
    async successesToday(model, now) {
      const rows = await db
        .select({ count: rateLimits.count })
        .from(rateLimits)
        .where(and(eq(rateLimits.key, ttsPregenKey(model)), eq(rateLimits.windowStart, toDate(quotaDayStart(now)))));
      return rows[0]?.count ?? 0;
    },
    async countSuccess(model, now) {
      await db
        .insert(rateLimits)
        .values({ key: ttsPregenKey(model), windowStart: toDate(quotaDayStart(now)), count: 1 })
        .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } });
    },
  };
}

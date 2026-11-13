import { and, eq, inArray, lt } from "drizzle-orm";
import { planEviction, TOUCH_AFTER_MS, type VoiceCacheStore } from "@/lib/receptionist/voiceCacheBudget";
import type { DbHandle } from "./repository";
import { voiceCache } from "./schema";

/**
 * The voice cache in Postgres (natural-voice design.md, "Where the audio lives"). Lookups by key
 * read no audio; only `get` does. Eviction reads the rows' sizes and dates, never their bytes,
 * and the choice of rows is the pure `planEviction`.
 */
export function createVoiceCacheRepository(handle: DbHandle): VoiceCacheStore {
  const { db } = handle;
  return {
    async findKeys(keys) {
      if (keys.length === 0) return new Set();
      const rows = await db
        .select({ key: voiceCache.key })
        .from(voiceCache)
        .where(inArray(voiceCache.key, [...new Set(keys)]));
      return new Set(rows.map((r) => r.key));
    },

    async get(key) {
      const rows = await db
        .select({ mime: voiceCache.mime, bytes: voiceCache.bytes, lastUsedAt: voiceCache.lastUsedAt })
        .from(voiceCache)
        .where(eq(voiceCache.key, key))
        .limit(1);
      const r = rows[0];
      return r ? { mime: r.mime, bytes: r.bytes, lastUsedAtMs: new Date(r.lastUsedAt).getTime() } : null;
    },

    async insert(row) {
      const inserted = await db
        .insert(voiceCache)
        .values({ ...row, sizeBytes: row.bytes.byteLength })
        .onConflictDoNothing({ target: voiceCache.key })
        .returning({ key: voiceCache.key });
      return inserted.length > 0;
    },

    async touch(key, nowMs) {
      await db
        .update(voiceCache)
        .set({ lastUsedAt: new Date(nowMs) })
        .where(and(eq(voiceCache.key, key), lt(voiceCache.lastUsedAt, new Date(nowMs - TOUCH_AFTER_MS))));
    },

    async evict(maxBytes) {
      const rows = await db
        .select({
          key: voiceCache.key,
          sizeBytes: voiceCache.sizeBytes,
          pinned: voiceCache.pinned,
          lastUsedAt: voiceCache.lastUsedAt,
        })
        .from(voiceCache);
      const doomed = planEviction(
        rows.map((r) => ({ key: r.key, sizeBytes: r.sizeBytes, pinned: r.pinned, lastUsedAtMs: new Date(r.lastUsedAt).getTime() })),
        maxBytes,
      );
      if (doomed.length === 0) return [];
      await db.delete(voiceCache).where(and(inArray(voiceCache.key, doomed), eq(voiceCache.pinned, false)));
      return doomed;
    },
  };
}

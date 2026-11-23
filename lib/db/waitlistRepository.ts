import { sql } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import type { WaitlistStore } from "@/lib/waitlist/schema";
import type { DbHandle } from "./repository";
import { rateLimits, waitlist } from "./schema";

const WAITLIST_GLOBAL_KEY = "waitlist-global";
const visitorKey = (key: string) => `waitlist:${key}`;

/**
 * The waitlist store. Counters live in the existing `rate_limits` table with the same upsert as the
 * Turn limits (fixed UTC windows: the hour for a visitor, the day for everyone), so the daily
 * sweep removes them. Write-only: nothing here reads entries back.
 */
export function createWaitlistRepository(handle: DbHandle): WaitlistStore {
  const { db } = handle;
  return {
    async hit(key, now) {
      const ms = now.epochMilliseconds;
      const vKey = visitorKey(key);
      const rows = await db
        .insert(rateLimits)
        .values([
          { key: vKey, windowStart: new Date(ms - (ms % 3_600_000)), count: 1 },
          { key: WAITLIST_GLOBAL_KEY, windowStart: new Date(ms - (ms % 86_400_000)), count: 1 },
        ])
        .onConflictDoUpdate({
          target: [rateLimits.key, rateLimits.windowStart],
          set: { count: sql`${rateLimits.count} + 1` },
        })
        .returning({ key: rateLimits.key, count: rateLimits.count });
      const count = (k: string) => rows.find((r) => r.key === k)?.count ?? 0;
      return { visitor: count(vKey), day: count(WAITLIST_GLOBAL_KEY) };
    },

    async add(entry, now: Temporal.Instant) {
      const rows = await db
        .insert(waitlist)
        .values({
          shopName: entry.shopName,
          city: entry.city,
          email: entry.email,
          language: entry.language,
          consentAt: new Date(now.epochMilliseconds),
        })
        .onConflictDoNothing({ target: waitlist.email })
        .returning({ id: waitlist.id });
      return { created: rows.length > 0 };
    },
  };
}

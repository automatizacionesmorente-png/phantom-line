import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { WizardKind, WizardLimiter, TrialStore } from "@/lib/rebirth/ports";
import type { DbHandle } from "./repository";
import { bookings, calls, clients, messages, ownerActions, rateLimits, shops, voiceCache } from "./schema";

const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const DAY_MS = 86_400_000;

/**
 * Per-visitor and global daily counters of the /nacer endpoints, in the existing `rate_limits`
 * table (same upsert as the waitlist: fixed UTC day windows, swept by the daily cron).
 */
export function createWizardLimiter(handle: DbHandle): WizardLimiter {
  const { db } = handle;
  return {
    async hit(kind: WizardKind, visitorKey: string, now) {
      const ms = now.epochMilliseconds;
      const window = new Date(ms - (ms % DAY_MS));
      const vKey = `nacer:${kind}:${visitorKey}`;
      const gKey = `nacer:${kind}:global`;
      const rows = await db
        .insert(rateLimits)
        .values([
          { key: vKey, windowStart: window, count: 1 },
          { key: gKey, windowStart: window, count: 1 },
        ])
        .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
        .returning({ key: rateLimits.key, count: rateLimits.count });
      const count = (k: string) => rows.find((r) => r.key === k)?.count ?? 0;
      return { visitor: count(vKey), day: count(gKey) };
    },
  };
}

/** Trial shops: insert-only creation, the badge flag, and the deletion of expired ones. */
export function createTrialStore(handle: DbHandle): TrialStore {
  const { db } = handle;
  return {
    async createShop({ name, candidates, buildProfile, pinHash, now, expiresAt }) {
      const sameName = await db.select({ id: shops.id }).from(shops).where(eq(shops.name, name)).limit(1);
      if (sameName.length > 0) return { ok: false, reason: "name_taken" };
      for (const id of candidates) {
        const profile: ShopProfile = buildProfile(id);
        // Never an upsert: a taken id or name inserts nothing and the shop that owns it is untouched.
        const rows = await db
          .insert(shops)
          .values({
            id,
            name: profile.name,
            sectorPackId: profile.sectorPackId,
            timeZone: profile.timeZone,
            profile,
            ownerPinHash: pinHash,
            ownerPinSetAt: toDate(now),
            trial: true,
            expiresAt: toDate(expiresAt),
          })
          .onConflictDoNothing()
          .returning({ id: shops.id });
        if (rows.length > 0) return { ok: true, shopId: rows[0].id };
        const raced = await db.select({ id: shops.id }).from(shops).where(eq(shops.name, profile.name)).limit(1);
        if (raced.length > 0) return { ok: false, reason: "name_taken" };
      }
      return { ok: false, reason: "no_free_slug" };
    },

    async isTrial(shopId) {
      const rows = await db.select({ trial: shops.trial }).from(shops).where(eq(shops.id, shopId)).limit(1);
      return rows[0]?.trial === true;
    },

    async deleteExpired(now) {
      const expired = await db
        .select({ id: shops.id })
        .from(shops)
        .where(and(eq(shops.trial, true), lte(shops.expiresAt, toDate(now))))
        .limit(200);
      const ids = expired.map((r) => r.id);
      if (ids.length === 0) return 0;
      // Children first, in one atomic batch; only rows of expired trial shops, never the demo or a real shop.
      await handle.atomic((q) => [
        q.delete(ownerActions).where(inArray(ownerActions.shopId, ids)).returning({ id: ownerActions.id }),
        q.delete(messages).where(inArray(messages.shopId, ids)).returning({ id: messages.id }),
        q.delete(bookings).where(inArray(bookings.shopId, ids)).returning({ id: bookings.id }),
        q.delete(calls).where(inArray(calls.shopId, ids)).returning({ id: calls.id }),
        q.delete(voiceCache).where(inArray(voiceCache.shopId, ids)).returning({ key: voiceCache.key }),
        q.delete(clients).where(inArray(clients.shopId, ids)).returning({ id: clients.id }),
        q.delete(shops).where(and(eq(shops.trial, true), inArray(shops.id, ids))).returning({ id: shops.id }),
      ]);
      return ids.length;
    },
  };
}

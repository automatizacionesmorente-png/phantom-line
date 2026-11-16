import fc from "fast-check";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { bookings, calls, messages, ownerActions, shops } from "@/lib/db/schema";
import { SAMPLE_KEYS, type SampleKey } from "@/lib/owner/api";
import { DEMO_SHOP_ID, demoCutoffs } from "@/lib/owner/demo";
import { runDemoRetention } from "@/lib/owner/demoRetention";
import type { OwnerRepository } from "@/lib/owner/types";
import { arbNow } from "../booking/arbitraries";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { insertShop } from "./helpers";
import { ACTOR, addBooking, addCall, addMessage, fullSnapshot, ownerRepoOf, realProfile } from "./ownerFixtures";

/**
 * M21. Demo_Retention in the database (owner-machine 15.7, 16.1–16.4, 16.6). For generated
 * Demo_Shop and Real_Shop data (Calls started from 10 days before `now` to `now`, open and
 * ended; Messages heard, unheard, erased and samples; Bookings past and future, some cancelled,
 * some with Audit_Records) and `now` values that include both Madrid DST weekends: after one
 * run with a fresh claim, every clause of 15.7 holds for the Demo_Shop, and every Real_Shop row
 * is unchanged; a second run at the same `now` is refused by the claim, and a forced second
 * run changes nothing. numRuns 50 (design).
 */
const D = DEMO_SHOP_ID;
const R = realProfile.id;
const TEN_DAYS_MIN = 10 * 24 * 60;

const arbCall = fc.record({
  ageMin: fc.integer({ min: 0, max: TEN_DAYS_MIN }),
  open: fc.boolean(),
  message: fc.option(
    fc.record({
      lagMin: fc.integer({ min: 0, max: 30 }),
      heard: fc.boolean(),
      erased: fc.boolean(),
      sample: fc.option(fc.constantFrom(...SAMPLE_KEYS), { nil: undefined }),
      audit: fc.boolean(),
    }),
    { nil: undefined },
  ),
});
const arbBooking = fc.record({
  /** Half-hour slots from 10 days before `now` to 3 days after. */
  slot: fc.integer({ min: -480, max: 144 }),
  ofCall: fc.option(fc.nat({ max: 7 }), { nil: undefined }),
  cancelled: fc.boolean(),
  audit: fc.boolean(),
});
const arbShopData = fc.record({
  calls: fc.array(arbCall, { maxLength: 8 }),
  bookings: fc.uniqueArray(arbBooking, { maxLength: 6, selector: (b) => b.slot }),
});
type ShopData = typeof arbShopData extends fc.Arbitrary<infer T> ? T : never;

let t: TestDb;
let owner: OwnerRepository;
beforeAll(async () => {
  t = await createTestDb();
  owner = ownerRepoOf(t);
}, 120_000);
afterAll(async () => {
  await t.close();
});

async function seed(shopId: string, data: ShopData, now: Temporal.Instant) {
  const callIds: string[] = [];
  for (const c of data.calls) {
    callIds.push(await addCall(t, shopId, { startedAt: now.subtract({ minutes: c.ageMin }), status: c.open ? "open" : "completed" }));
  }
  const bookingOfCall = new Map<number, string>();
  for (const b of data.bookings) {
    const k = b.ofCall !== undefined && b.ofCall < callIds.length && !bookingOfCall.has(b.ofCall) ? b.ofCall : undefined;
    const id = await addBooking(t, shopId, {
      start: now.add({ minutes: 30 * b.slot }),
      callId: k === undefined ? null : callIds[k],
      status: b.cancelled ? "cancelled" : "confirmed",
    });
    if (k !== undefined) bookingOfCall.set(k, id);
    if (b.audit) {
      await t.handle.db.insert(ownerActions).values({
        shopId, action: "move", bookingId: id, actorSession: ACTOR.sessionId, actorLabel: "Lola", before: {}, after: {},
      });
    }
  }
  const activeSamples = new Set<SampleKey>();
  for (const [k, c] of data.calls.entries()) {
    if (!c.message) continue;
    const m = c.message;
    const createdAt = now.subtract({ minutes: Math.max(0, c.ageMin - m.lagMin) });
    // The partial unique index allows one active copy of each sample.
    const sampleKey = m.sample && (m.erased || !activeSamples.has(m.sample)) ? m.sample : undefined;
    if (sampleKey && !m.erased) activeSamples.add(sampleKey);
    const id = await addMessage(t, shopId, callIds[k], {
      createdAt,
      heard: m.heard,
      erasedAt: m.erased ? createdAt : undefined,
      sampleKey,
      bookingId: bookingOfCall.get(k),
    });
    if (m.audit) {
      await t.handle.db.insert(ownerActions).values({
        shopId, action: "play", messageId: id, actorSession: ACTOR.sessionId, actorLabel: "Lola", before: {}, after: {},
      });
    }
  }
}

describe("M21: Demo_Retention in the database", () => {
  it("meets 15.7 for the Demo_Shop, never touches a Real_Shop, and runs once", async () => {
    const seen = { deletedCalls: 0, erased: 0, samples: 0 };
    await fc.assert(
      fc.asyncProperty(arbShopData, arbShopData, arbNow, async (demoData, realData, now) => {
        await t.reset();
        await insertShop(t, lolaProfile);
        await insertShop(t, realProfile);
        await seed(D, demoData, now);
        await seed(R, realData, now);
        const realBefore = await fullSnapshot(t, R);
        const c = demoCutoffs(now);
        const deps = { repo: owner, clock: () => now, newId: () => randomUUID(), log: () => {} };

        expect(await runDemoRetention(deps)).toBe(true);

        const db = t.handle.db;
        // No New_Message created more than 24 hours before `now` (16.2).
        expect(
          await db.select().from(messages).where(and(eq(messages.shopId, D), isNull(messages.erasedAt), lt(messages.createdAt, new Date(c.eraseBefore.epochMilliseconds)))),
        ).toEqual([]);
        // No Call and no Message older than 7 days; no Booking that ended more than 7 days ago (16.3).
        const deleteBefore = new Date(c.deleteBefore.epochMilliseconds);
        expect(await db.select().from(calls).where(and(eq(calls.shopId, D), lt(calls.startedAt, deleteBefore)))).toEqual([]);
        expect(await db.select().from(messages).where(and(eq(messages.shopId, D), lt(messages.createdAt, deleteBefore)))).toEqual([]);
        expect(await db.select().from(bookings).where(and(eq(bookings.shopId, D), lt(bookings.endsAt, deleteBefore)))).toEqual([]);
        // No orphan Audit_Record.
        const orphans = (await db.execute(sql`
          SELECT count(*)::int AS n FROM owner_actions a
           WHERE a.shop_id = ${D}
             AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = a.message_id)
             AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = a.booking_id)`)) as { rows: { n: number }[] };
        expect(orphans.rows[0].n).toBe(0);
        // At least 3 New_Messages, and each sample at most once on the Tape (16.4).
        const active = await db.select().from(messages).where(and(eq(messages.shopId, D), isNull(messages.erasedAt)));
        expect(active.length).toBeGreaterThanOrEqual(3);
        for (const key of SAMPLE_KEYS) expect(active.filter((m) => m.sampleKey === key).length).toBeLessThanOrEqual(1);
        // The Real_Shop is unchanged, row for row (16.1).
        expect(await fullSnapshot(t, R)).toBe(realBefore);

        if (demoData.calls.some((x) => x.ageMin > 7 * 24 * 60)) seen.deletedCalls++;
        if (active.some((m) => m.sampleKey)) seen.samples++;
        if (demoData.calls.some((x) => x.message && !x.message.erased && x.ageMin > 24 * 60 && x.ageMin <= 7 * 24 * 60)) seen.erased++;

        // A second run at the same `now` is refused by the claim and changes nothing (16.6).
        const demoAfter = await fullSnapshot(t, D);
        expect(await runDemoRetention(deps)).toBe(false);
        expect(await fullSnapshot(t, D)).toBe(demoAfter);
        // A forced second run (claim released) changes nothing either.
        await db.update(shops).set({ demoSweptAt: null }).where(eq(shops.id, D));
        expect(await runDemoRetention(deps)).toBe(true);
        expect(await fullSnapshot(t, D)).toBe(demoAfter);
        expect(await fullSnapshot(t, R)).toBe(realBefore);
      }),
      { numRuns: 50 },
    );
    // Not passing without testing anything: deletions, 24-hour erases and restored samples all happened.
    expect(seen.deletedCalls).toBeGreaterThan(0);
    expect(seen.erased).toBeGreaterThan(0);
    expect(seen.samples).toBeGreaterThan(0);
  }, 900_000);
});

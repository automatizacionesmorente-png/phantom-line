import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { bookings, messages } from "@/lib/db/schema";
import type { OwnerRepository } from "@/lib/owner/types";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { bookingWrite, callWrite, insertShop, messageWrite } from "./helpers";
import { ACTOR, ownerRepoOf, realProfile, shopSnapshot, versionOf } from "./ownerFixtures";

/**
 * M15. Every write that changes a Message or Booking row bumps its own shop's Machine_Version
 * and no other's; a write that changes no row bumps nothing (owner-machine 12.4). Writes go
 * through the real repositories on PGlite: caller commit batches (some clash on the
 * constraint), caller cancels, duplicate end-of-Call Messages, the stale-call sweep, and owner
 * commands with current and stale revisions. The oracle for "changed" is a snapshot of the
 * shop's messages and bookings rows before and after. numRuns 50 (design).
 */
const SHOPS = [lolaProfile.id, realProfile.id] as const;
const NOW = Temporal.Instant.from("2026-11-10T08:00:00Z");
const FAR = Temporal.Instant.from("2100-01-01T00:00:00Z");
/** Thursday 12 November 10:00 Madrid, plus k × 15 min: few slots, so writes clash. */
const slot = (k: number) => Temporal.Instant.from("2026-11-12T09:00:00Z").add({ minutes: 15 * k });

const s = fc.integer({ min: 0, max: 1 });
const j = fc.nat({ max: 5 });
const k = fc.integer({ min: 0, max: 3 });
const res = fc.constantFrom("chair-1", "chair-2");
const arbOp = fc.oneof(
  fc.record({ op: fc.constant("book" as const), s, k, res }),
  fc.record({ op: fc.constant("callerCancel" as const), s, j }),
  fc.record({ op: fc.constant("dupMessage" as const), s, j }),
  fc.record({ op: fc.constant("openCall" as const), s }),
  fc.record({ op: fc.constant("sweep" as const), s }),
  fc.record({
    op: fc.constant("ownerBooking" as const),
    s,
    j,
    kind: fc.constantFrom("confirm" as const, "cancel" as const, "move" as const),
    stale: fc.boolean(),
    k,
    res,
  }),
  fc.record({ op: fc.constant("ownerMessage" as const), s, j, kind: fc.constantFrom("play" as const, "erase" as const) }),
);
type Op = typeof arbOp extends fc.Arbitrary<infer T> ? T : never;

let t: TestDb;
let owner: OwnerRepository;
beforeAll(async () => {
  t = await createTestDb();
  owner = ownerRepoOf(t);
}, 120_000);
afterAll(async () => {
  await t.close();
});

const bookingsOf = (shopId: string) =>
  t.handle.db.select().from(bookings).where(eq(bookings.shopId, shopId)).orderBy(asc(bookings.createdAt), asc(bookings.id));
const messagesOf = (shopId: string) =>
  t.handle.db.select().from(messages).where(eq(messages.shopId, shopId)).orderBy(asc(messages.createdAt), asc(messages.id));

async function apply(o: Op): Promise<void> {
  const shopId = SHOPS[o.s];
  switch (o.op) {
    case "book": {
      const c = callWrite(shopId);
      await t.repo.commit([c]);
      const b = bookingWrite({ shopId, callId: c.call.id, start: slot(o.k).toString(), resourceId: o.res });
      await t.repo.commit([b, messageWrite(shopId, c.call.id, b.booking.id)]);
      return;
    }
    case "callerCancel": {
      const b = (await bookingsOf(shopId))[o.j];
      await t.repo.commit([{ type: "cancelBooking", bookingId: b?.id ?? "00000000-0000-4000-8000-000000000000" }]);
      return;
    }
    case "dupMessage": {
      const m = (await messagesOf(shopId))[o.j];
      if (m) await t.repo.commit([messageWrite(shopId, m.callId)]);
      return;
    }
    case "openCall":
      await t.repo.commit([callWrite(shopId)]);
      return;
    case "sweep":
      await t.repo.closeStaleCalls(shopId, FAR);
      return;
    case "ownerBooking": {
      const b = (await bookingsOf(shopId))[o.j];
      if (!b) return;
      const revision = o.stale ? b.revision + 1 : b.revision;
      const base = { shopId, bookingId: b.id, revision, actor: ACTOR, now: NOW };
      if (o.kind === "move") {
        await owner.applyOwnerCommand({ ...base, kind: "move", to: { start: slot(o.k), end: slot(o.k).add({ minutes: 30 }), resourceId: o.res } });
      } else {
        await owner.applyOwnerCommand({ ...base, kind: o.kind });
      }
      return;
    }
    case "ownerMessage": {
      const m = (await messagesOf(shopId))[o.j];
      if (m) await owner.applyOwnerCommand({ kind: o.kind, shopId, messageId: m.id, actor: ACTOR, now: NOW });
      return;
    }
  }
}

describe("M15: the Machine_Version follows every write, and only its own shop's", () => {
  it("moves exactly when that shop's messages or bookings changed", async () => {
    let changedWrites = 0;
    let unchangedWrites = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(arbOp, { minLength: 1, maxLength: 25 }), async (ops) => {
        await t.reset();
        await insertShop(t, lolaProfile);
        await insertShop(t, realProfile);
        for (const o of ops) {
          const before = await Promise.all(SHOPS.map(async (id) => ({ v: await versionOf(t, id), snap: await shopSnapshot(t, id) })));
          await apply(o);
          for (const [n, id] of SHOPS.entries()) {
            const v = await versionOf(t, id);
            const changed = (await shopSnapshot(t, id)) !== before[n].snap;
            if (changed) {
              expect(v).toBeGreaterThan(before[n].v);
              if (n === o.s) changedWrites++;
            } else {
              expect(v).toBe(before[n].v);
              if (n === o.s) unchangedWrites++;
            }
          }
        }
      }),
      { numRuns: 50 },
    );
    // Both branches on the written shop itself: a write that changed rows, and one that
    // changed none (a clash, a duplicate Message, a stale or noop command, a calls-only write).
    expect(changedWrites).toBeGreaterThan(0);
    expect(unchangedWrites).toBeGreaterThan(0);
  }, 600_000);
});

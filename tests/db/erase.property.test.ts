import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { initialCallState } from "@/lib/conversation/types";
import { messages } from "@/lib/db/schema";
import type { OwnerRepository } from "@/lib/owner/types";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { callWrite, insertShop, messageWrite } from "./helpers";
import { ACTOR, ownerRepoOf } from "./ownerFixtures";

/**
 * M4. Erase is permanent in the database (owner-machine 15.3, 8.1, 8.2). Over sequences of
 * finishing Calls, late end-of-Call writes (a repeated hang-up, the stale-call sweep), plays,
 * erases, repeated erases and polls, after every step: the New_Message count equals the
 * Messages never erased, and no erased id is on the Tape. PGlite, numRuns 50 (design).
 */
const SHOP = lolaProfile.id;
const NOW = Temporal.Instant.from("2026-11-10T08:00:00Z");
/** Every open Call is stale for the sweep. */
const FAR = Temporal.Instant.from("2100-01-01T00:00:00Z");

type Op =
  | { op: "finish"; i: number }
  | { op: "sweep" }
  | { op: "play"; i: number }
  | { op: "erase"; i: number }
  | { op: "poll" };

const arbCase = fc.integer({ min: 1, max: 5 }).chain((calls) => {
  const i = fc.integer({ min: 0, max: calls - 1 });
  const op: fc.Arbitrary<Op> = fc.oneof(
    { arbitrary: i.map((i) => ({ op: "finish" as const, i })), weight: 3 },
    { arbitrary: fc.constant({ op: "sweep" as const }), weight: 1 },
    { arbitrary: i.map((i) => ({ op: "play" as const, i })), weight: 2 },
    { arbitrary: i.map((i) => ({ op: "erase" as const, i })), weight: 3 },
    { arbitrary: fc.constant({ op: "poll" as const }), weight: 1 },
  );
  return fc.record({ calls: fc.constant(calls), ops: fc.array(op, { minLength: 1, maxLength: 30 }) });
});

let t: TestDb;
let owner: OwnerRepository;
beforeAll(async () => {
  t = await createTestDb();
  owner = ownerRepoOf(t);
}, 120_000);
afterAll(async () => {
  await t.close();
});

describe("M4: erase is permanent in the database", () => {
  it("an erased Message never counts as new again and never returns to the Tape", async () => {
    let erasedAfterLateWrite = 0;
    await fc.assert(
      fc.asyncProperty(arbCase, async ({ calls, ops }) => {
        await t.reset();
        await insertShop(t, lolaProfile);
        const callIds: string[] = [];
        for (let k = 0; k < calls; k++) {
          const w = callWrite(SHOP);
          await t.repo.commit([w]);
          callIds.push(w.call.id);
        }
        const has = new Set<number>();
        const open = new Set(callIds.map((_, k) => k));
        const erasedIds = new Set<string>();
        const erasedCalls = new Set<number>();
        const messageIdOf = async (i: number) =>
          (await t.handle.db.select({ id: messages.id }).from(messages).where(eq(messages.callId, callIds[i])))[0]?.id;

        for (const step of ops) {
          if (step.op === "finish") {
            if (erasedCalls.has(step.i)) erasedAfterLateWrite++;
            await t.repo.commit([
              messageWrite(SHOP, callIds[step.i]),
              { type: "updateCall", callId: callIds[step.i], state: { ...initialCallState("es"), stage: "done" }, transcript: [], turnCount: 1, status: "completed" },
            ]);
            has.add(step.i);
            open.delete(step.i);
          } else if (step.op === "sweep") {
            for (const k of erasedCalls) if (open.has(k)) erasedAfterLateWrite++;
            await t.repo.closeStaleCalls(SHOP, FAR);
            for (const k of open) has.add(k);
            open.clear();
          } else if (step.op === "play" || step.op === "erase") {
            const id = await messageIdOf(step.i);
            if (id) {
              await owner.applyOwnerCommand({ kind: step.op, shopId: SHOP, messageId: id, actor: ACTOR, now: NOW });
              if (step.op === "erase") {
                erasedIds.add(id);
                erasedCalls.add(step.i);
              }
            }
          }
          const head = await owner.pollHead(SHOP);
          const tape = await owner.listTape(SHOP, 200);
          const expectedNew = [...has].filter((k) => !erasedCalls.has(k)).length;
          expect(head?.counts.new).toBe(expectedNew);
          expect(tape).toHaveLength(expectedNew);
          for (const row of tape) expect(erasedIds.has(row.id)).toBe(false);
          expect(head!.counts.unheard).toBeLessThanOrEqual(head!.counts.new);
        }
      }),
      { numRuns: 50 },
    );
    // The property must have exercised a late end-of-Call write after an erase.
    expect(erasedAfterLateWrite).toBeGreaterThan(0);
  }, 600_000);
});

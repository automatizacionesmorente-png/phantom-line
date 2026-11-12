import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, messages } from "@/lib/db/schema";
import { initialCallState } from "@/lib/conversation/types";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { bookingWrite, callWrite, insertShop, messageWrite } from "./helpers";

/**
 * The database half of P9 (Requirements 9.9, 5.11): 20 Calls confirm the same
 * chair at the same time at once. Each commit is a full confirmation batch
 * (booking + message + call update) decided in code beforehand, with no read
 * inside the batch, so the EXCLUDE constraint is the only thing that can stop
 * a double booking.
 *
 * PGlite is one Postgres backend: the 20 transactions are all in flight at
 * once from the application's side, and Postgres runs them one after another.
 * Interleaving inside one statement between two backends needs a real server;
 * there the same constraint holds through its index locks.
 */
const SHOP = lolaProfile.id;
const START = "2026-11-17T09:00:00Z"; // Tuesday 17 November, 10:00 Madrid
const N = 20;

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  await insertShop(t, lolaProfile);
}, 60_000);
afterAll(async () => {
  await t.close();
});

describe("P9, database half: 20 concurrent commits for one chair and time", () => {
  it("leave exactly one confirmed row and return 19 booking_overlap conflicts", async () => {
    const callIds: string[] = [];
    for (let k = 0; k < N; k++) {
      const w = callWrite(SHOP);
      await t.repo.commit([w]);
      callIds.push(w.call.id);
    }

    let pending = 0;
    let maxInFlight = 0;
    const commits = callIds.map((callId, k) => {
      const b = bookingWrite({ shopId: SHOP, callId, start: START, resourceId: "chair-1", customerName: `Cliente ${k}` });
      pending++;
      maxInFlight = Math.max(maxInFlight, pending);
      return t.repo
        .commit([
          b,
          messageWrite(SHOP, callId, b.booking.id),
          { type: "updateCall", callId, state: { ...initialCallState("es"), stage: "done" }, transcript: [], turnCount: 7, status: "completed" },
        ])
        .finally(() => pending--);
    });
    // All 20 were started before the first one settled.
    expect(maxInFlight).toBe(N);
    const results = await Promise.all(commits);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.conflict === "booking_overlap")).toHaveLength(N - 1);

    const confirmed = await t.handle.db.select().from(bookings).where(eq(bookings.status, "confirmed"));
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].resourceId).toBe("chair-1");
    // The losers' batches rolled back whole: one Message, belonging to the winner.
    const ms = await t.handle.db.select().from(messages);
    expect(ms).toHaveLength(1);
    expect(ms[0].bookingId).toBe(confirmed[0].id);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { bookings, calls } from "@/lib/db/schema";
import { createWeekSource } from "@/lib/db/weekRepository";
import { addBooking, addCall } from "../db/ownerFixtures";
import { createTestDb, type TestDb } from "../db/pglite";
import { DEMO, REAL, SECRET, answer, createMachineEnv, mreq, seedShops, tokenFor, type MachineEnv } from "./machineHarness";

/**
 * "Últimos 7 días" through the Machine_API (BACKLOG 17): the owner session is required, the numbers
 * are the shop's own, and another shop's rows never count. CLOCK0 is Tuesday 10 November 2026.
 */
let t: TestDb;
let env: MachineEnv;

beforeAll(async () => {
  t = await createTestDb();
}, 120_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await seedShops(t);
  env = createMachineEnv(t, { week: createWeekSource(t.handle) });
});

const get = (shopId: string, token?: string) => env.handlers.week(mreq("GET", `/api/machine/${shopId}/week`, { token }), { shopId });

async function callOf(shopId: string, startedAt: string, minutes: number) {
  const id = await addCall(t, shopId, { startedAt });
  const end = new Date(Temporal.Instant.from(startedAt).add({ minutes }).epochMilliseconds);
  await t.handle.db.update(calls).set({ endedAt: end, updatedAt: end }).where(eq(calls.id, id));
  return id;
}
async function bookedBy(shopId: string, callId: string, createdAt: string) {
  const id = await addBooking(t, shopId, { start: "2026-11-12T09:00:00Z", callId });
  await t.handle.db.update(bookings).set({ createdAt: new Date(createdAt) }).where(eq(bookings.id, id));
}

describe("GET /api/machine/[shopId]/week", () => {
  it("needs the owner session: 401 locked without or with another shop's token", async () => {
    expect((await answer(await get(DEMO))).status).toBe(401);
    expect((await answer(await get(DEMO, tokenFor(REAL)))).status).toBe(401);
  });

  it("is 404 for an unknown shop", async () => {
    expect((await answer(await get("nope", tokenFor("nope")))).status).toBe(404);
  });

  it("reads the shop's own last 7 days and no other shop's rows", async () => {
    // Now is Tuesday 10 November 09:00 Madrid. Friday 6th 10:00 and 10:07 are open, the second while the first runs.
    const a = await callOf(DEMO, "2026-11-06T09:00:00Z", 10);
    await callOf(DEMO, "2026-11-06T09:07:00Z", 3);
    await callOf(DEMO, "2026-11-09T19:30:00Z", 2); // Monday 20:30 Madrid: closed
    await callOf(DEMO, "2026-11-03T07:30:00Z", 3); // 08:30 Madrid, 7 days and 30 minutes ago: outside
    await bookedBy(DEMO, a, "2026-11-06T09:10:00Z");
    const other = await callOf(REAL, "2026-11-06T09:00:00Z", 3);
    await bookedBy(REAL, other, "2026-11-06T09:05:00Z");

    const res = await answer(await get(DEMO, tokenFor(DEMO)));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      from: "2026-11-03",
      to: "2026-11-10",
      callsAnswered: 3,
      bookings: 1,
      lostCalls: 2,
      timeSavedSeconds: (10 + 3 + 2) * 60,
      timedCalls: 3,
    });
    expect(res.json!.revenueCents).toBe(1500);
    expect(res.text).not.toMatch(/Ana|\+346/);
  });

  it("answers an empty window with zeros and no time saved", async () => {
    const res = await answer(await get(DEMO, tokenFor(DEMO)));
    expect(res.json).toMatchObject({ callsAnswered: 0, bookings: 0, revenueCents: 0, lostCalls: 0, timeSavedSeconds: null });
  });

  it("moves with the clock, in the shop's zone", async () => {
    await callOf(DEMO, "2026-11-08T12:00:00Z", 2);
    const later = Temporal.Instant.from("2026-11-15T11:30:00Z");
    env.setNow(later);
    const next = await answer(await get(DEMO, tokenFor(DEMO, {}, SECRET, later)));
    expect(next.json).toMatchObject({ from: "2026-11-08", to: "2026-11-15", callsAnswered: 1 });
    env.setNow(later.add({ hours: 1 }));
    const gone = await answer(await get(DEMO, tokenFor(DEMO, {}, SECRET, later)));
    expect(gone.json).toMatchObject({ callsAnswered: 0 });
  });
});

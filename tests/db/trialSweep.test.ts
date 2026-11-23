import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { makeCronHandler } from "@/app/api/cron/demo-retention/handler";
import { bookings, calls, clients, messages, ownerActions, shops, voiceCache } from "@/lib/db/schema";
import { createTrialStore } from "@/lib/db/trialRepository";
import { TRIAL_DAYS } from "@/lib/rebirth/draft";
import { lolaProfile } from "../fixtures/lola";
import { insertShop } from "./helpers";
import { addBooking, addCall, addMessage, realProfile } from "./ownerFixtures";
import { createTestDb, type TestDb } from "./pglite";

const NOW = Temporal.Instant.from("2026-12-01T10:00:00Z");
const EXPIRED = NOW.subtract({ hours: 1 });
const FRESH = NOW.add({ hours: 5 * 24 });

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => t?.close());
beforeEach(async () => {
  await t.reset();
});

const d = (i: Temporal.Instant) => new Date(i.epochMilliseconds);

/** A trial shop with a call, a booking, a message, an owner action and a cached voice clip. */
async function trialShop(id: string, expiresAt: Temporal.Instant, trial = true) {
  await insertShop(t, { ...lolaProfile, id, name: `Shop ${id}` });
  await t.handle.db.update(shops).set({ trial, expiresAt: d(expiresAt) }).where(eq(shops.id, id));
  const callId = await addCall(t, id);
  const bookingId = await addBooking(t, id, { start: "2026-12-10T10:00:00Z", callId });
  await addMessage(t, id, callId, { bookingId });
  await t.handle.db.insert(ownerActions).values({ shopId: id, action: "confirm", bookingId, actorSession: "s", actorLabel: "x", before: {}, after: {} });
  await t.handle.db.insert(voiceCache).values({
    key: id.padEnd(32, "0").replace(/[^0-9a-f]/g, "a").slice(0, 32),
    shopId: id,
    language: "es",
    model: "m",
    mime: "audio/mpeg",
    bytes: new Uint8Array([1, 2, 3]),
    sizeBytes: 3,
    source: "live",
  });
  // A client of the customer book (BACKLOG 14): it must go with its shop.
  await t.handle.db.insert(clients).values({ shopId: id, phone: "+34612345678", name: "Ana" });
}
const counts = async (id: string) => {
  const n = async (table: string) => Number(((await t.handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE ${table === "shops" ? "id" : "shop_id"} = '${id}'`))) as unknown as { rows: { n: number }[] }).rows[0].n);
  return { shops: await n("shops"), calls: await n("calls"), bookings: await n("bookings"), messages: await n("messages"), owner_actions: await n("owner_actions"), voice_cache: await n("voice_cache"), clients: await n("clients") };
};
const NONE = { shops: 0, calls: 0, bookings: 0, messages: 0, owner_actions: 0, voice_cache: 0, clients: 0 };
const ALL = { shops: 1, calls: 1, bookings: 1, messages: 1, owner_actions: 1, voice_cache: 1, clients: 1 };

describe("deleteExpired", () => {
  it("deletes an expired trial shop and every row that belongs to it", async () => {
    await trialShop("prueba-vieja", EXPIRED);
    expect(await counts("prueba-vieja")).toEqual(ALL);
    expect(await createTrialStore(t.handle).deleteExpired(NOW)).toBe(1);
    expect(await counts("prueba-vieja")).toEqual(NONE);
  });

  it("keeps a trial shop that has not expired, a real shop, and the demo shop, with all their data", async () => {
    await trialShop("prueba-fresca", FRESH);
    await trialShop("prueba-vieja", EXPIRED);
    // A shop that is not a trial never goes, even with an expiry in the past.
    await trialShop("real-con-fecha", EXPIRED, false);
    await trialShop("peluqueria-lola", EXPIRED, false);
    await insertShop(t, realProfile);
    expect(await createTrialStore(t.handle).deleteExpired(NOW)).toBe(1);
    expect(await counts("prueba-fresca")).toEqual(ALL);
    expect(await counts("real-con-fecha")).toEqual(ALL);
    expect(await counts("peluqueria-lola")).toEqual(ALL);
    expect(await counts(realProfile.id)).toMatchObject({ shops: 1 });
    expect(await counts("prueba-vieja")).toEqual(NONE);
  });

  it(`a trial shop is deleted exactly when ${TRIAL_DAYS} days have passed, not before`, async () => {
    await trialShop("justa", NOW.add({ hours: TRIAL_DAYS * 24 }));
    const store = createTrialStore(t.handle);
    expect(await store.deleteExpired(NOW.add({ hours: TRIAL_DAYS * 24 - 1 }))).toBe(0);
    expect(await store.deleteExpired(NOW.add({ hours: TRIAL_DAYS * 24 }))).toBe(1);
  });

  it("is idempotent and handles an empty table", async () => {
    const store = createTrialStore(t.handle);
    expect(await store.deleteExpired(NOW)).toBe(0);
    await trialShop("prueba-vieja", EXPIRED);
    expect(await store.deleteExpired(NOW)).toBe(1);
    expect(await store.deleteExpired(NOW)).toBe(0);
  });

  it("isTrial tells a trial from a real shop", async () => {
    await trialShop("prueba", FRESH);
    await insertShop(t, realProfile);
    const store = createTrialStore(t.handle);
    expect(await store.isTrial("prueba")).toBe(true);
    expect(await store.isTrial(realProfile.id)).toBe(false);
    expect(await store.isTrial("nope")).toBe(false);
  });
});

describe("the daily cron also sweeps trial shops", () => {
  const SECRET = "cron-secret-for-tests";
  const emptyRepo = {
    claimDemoRetention: async () => false,
  } as never;
  const handler = (sweepTrials?: () => Promise<number>) =>
    makeCronHandler({ deps: () => ({ repo: emptyRepo, clock: () => NOW, newId: () => "x" }), secret: () => SECRET, sweepTrials });
  const get = (h: ReturnType<typeof handler>, auth?: string) => h(new Request("http://x/api/cron/demo-retention", { headers: auth ? { authorization: auth } : {} }));

  it("refuses without the secret and sweeps nothing", async () => {
    const sweep = vi.fn(async () => 0);
    expect((await get(handler(sweep))).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it("deletes expired trials through the real store, then answers 204, logging only a count", async () => {
    await trialShop("prueba-vieja", EXPIRED);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await get(handler(() => createTrialStore(t.handle).deleteExpired(NOW)), `Bearer ${SECRET}`);
    expect(res.status).toBe(204);
    expect(await counts("prueba-vieja")).toEqual(NONE);
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("trial_sweep"))!;
    log.mockRestore();
    expect(JSON.parse(line)).toEqual({ event: "trial_sweep", outcome: "ok", deleted: 1 });
    expect(line).not.toContain("prueba-vieja");
  });

  it("answers 503 when the sweep fails, so the cron run shows red", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get(
      handler(async () => {
        throw new Error("db down");
      }),
      `Bearer ${SECRET}`,
    );
    err.mockRestore();
    expect(res.status).toBe(503);
  });

  it("without a sweep configured it behaves as before", async () => {
    expect((await get(handler(), `Bearer ${SECRET}`)).status).toBe(204);
  });
});

describe("a trial shop's data is deleted with it, whatever its size", () => {
  it("handles many calls and messages", async () => {
    await insertShop(t, { ...lolaProfile, id: "grande", name: "Grande" });
    await t.handle.db.update(shops).set({ trial: true, expiresAt: d(EXPIRED) }).where(eq(shops.id, "grande"));
    for (let i = 0; i < 15; i++) {
      const c = await addCall(t, "grande");
      await addMessage(t, "grande", c);
    }
    expect(await createTrialStore(t.handle).deleteExpired(NOW)).toBe(1);
    const left = await t.handle.db.select().from(calls).where(eq(calls.shopId, "grande"));
    const lm = await t.handle.db.select().from(messages).where(eq(messages.shopId, "grande"));
    const lb = await t.handle.db.select().from(bookings).where(eq(bookings.shopId, "grande"));
    expect([left.length, lm.length, lb.length]).toEqual([0, 0, 0]);
  });
});

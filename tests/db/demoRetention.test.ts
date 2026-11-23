import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { bookings, calls, messages, ownerActions, shops } from "@/lib/db/schema";
import { DEMO_SHOP_ID } from "@/lib/owner/demo";
import { runDemoRetention } from "@/lib/owner/demoRetention";
import type { OwnerLogEvent, OwnerRepository } from "@/lib/owner/types";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { insertShop } from "./helpers";
import { ACTOR, addBooking, addCall, addMessage, fullSnapshot, ownerRepoOf, realProfile } from "./ownerFixtures";

/** Owner-machine tasks 8.6 (Demo_Retention) and 8.7 (its log lines carry no personal data). */

const D = DEMO_SHOP_ID;
const R = realProfile.id;
/** Monday 21 December 2026, 12:00 Madrid: judging time. */
const NOW = Temporal.Instant.from("2026-12-21T11:00:00Z");

/** The seeded personal data; no log line may contain any of it (14.4, 16.7). */
const SEEDED = {
  names: ["Rosalía Fernández", "Ignacio Beltrán"],
  phones: ["+34611223344", "+34699887766"],
  reasons: ["Quiere mechas rubias para la boda", "Pregunta por el precio del tinte"],
  lines: ["Me caso el sábado y quiero mechas", "¿Cuánto cuesta el tinte?"],
  // The Sample_Messages' own texts (design, "Logging": never sample texts).
  samples: ["Marta (ejemplo)", "Ana (ejemplo)", "Luis (ejemplo)", "+34000000001", "reacción, me pica"],
};
const allSeeded = Object.values(SEEDED).flat();

const logLines: string[] = [];
const collect = (e: OwnerLogEvent) => logLines.push(JSON.stringify(e));

let t: TestDb;
let owner: OwnerRepository;
beforeAll(async () => {
  t = await createTestDb();
  owner = ownerRepoOf(t);
}, 120_000);
afterAll(async () => {
  // 8.7: every demo_retention line written in this file. owner_auth lines are written by the
  // login handler (task 10), whose tests extend this check; none exists yet in task 8.
  expect(logLines.length).toBeGreaterThan(0);
  for (const line of logLines) {
    expect(JSON.parse(line).event).toBe("demo_retention");
    for (const s of allSeeded) expect(line).not.toContain(s);
  }
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
  await insertShop(t, realProfile);
});

const deps = (repo: OwnerRepository = owner, at: Temporal.Instant = NOW) => ({
  repo,
  clock: () => at,
  newId: () => randomUUID(),
  log: collect,
});

/** One shop's data: a 10-day-old call with its message, booking and audit record, and a fresh call. */
async function seedShopData(shopId: string) {
  const old = await addCall(t, shopId, {
    startedAt: NOW.subtract({ hours: 240 }),
    transcript: [{ caller: SEEDED.lines[0], receptionist: "Vale" }],
  });
  const oldBooking = await addBooking(t, shopId, {
    start: NOW.subtract({ hours: 239 }),
    callId: old,
    name: SEEDED.names[0],
    phone: SEEDED.phones[0],
  });
  const oldMessage = await addMessage(t, shopId, old, {
    createdAt: NOW.subtract({ hours: 240 }),
    bookingId: oldBooking,
    name: SEEDED.names[0],
    phone: SEEDED.phones[0],
    reason: SEEDED.reasons[0],
  });
  await t.handle.db.insert(ownerActions).values({
    shopId, action: "erase", messageId: oldMessage, actorSession: ACTOR.sessionId, actorLabel: "Lola", before: {}, after: {},
  });
  await t.handle.db.insert(ownerActions).values({
    shopId, action: "confirm", bookingId: oldBooking, actorSession: ACTOR.sessionId, actorLabel: "Lola", before: {}, after: {},
  });
  // A 2-day-old call (erased by the 24 h rule) whose booking is next week (it stays).
  const recent = await addCall(t, shopId, {
    startedAt: NOW.subtract({ hours: 48 }),
    transcript: [{ caller: SEEDED.lines[1], receptionist: "Quince euros" }],
  });
  const future = await addBooking(t, shopId, {
    start: NOW.add({ hours: 72 }),
    callId: recent,
    name: SEEDED.names[1],
    phone: SEEDED.phones[1],
  });
  const recentMessage = await addMessage(t, shopId, recent, {
    createdAt: NOW.subtract({ hours: 48 }),
    bookingId: future,
    name: SEEDED.names[1],
    phone: SEEDED.phones[1],
    reason: SEEDED.reasons[1],
  });
  return { old, oldBooking, oldMessage, recent, future, recentMessage };
}

describe("claimDemoRetention (16.6)", () => {
  it("returns true once in 10 minutes even with 10 concurrent calls", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => owner.claimDemoRetention(NOW)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await owner.claimDemoRetention(NOW.add({ minutes: 1 }))).toBe(false);
    expect(await owner.claimDemoRetention(NOW.add({ minutes: 9, seconds: 59 }))).toBe(false);
    expect(await owner.claimDemoRetention(NOW.add({ minutes: 10 }))).toBe(true);
  });

  it("only ever touches the Demo_Shop's row", async () => {
    await owner.claimDemoRetention(NOW);
    const rows = await t.handle.db.select({ id: shops.id, at: shops.demoSweptAt }).from(shops);
    expect(rows.find((r) => r.id === R)?.at).toBeNull();
    expect(rows.find((r) => r.id === D)?.at?.toISOString()).toBe("2026-12-21T11:00:00.000Z");
  });
});

describe("runDemoRetention", () => {
  it("retention deletes visitor payments, outbox, blocks and expenses but keeps curated", async () => {
    const old = NOW.subtract({ hours: 24 * 30 }).toString();
    const fresh = NOW.subtract({ hours: 1 }).toString();
    const oldBooking = await addBooking(t, D, { start: NOW.subtract({ hours: 24 * 30 }) });
    const keptBooking = await addBooking(t, D, { start: NOW.add({ hours: 72 }) });
    const real = await addBooking(t, R, { start: NOW.subtract({ hours: 24 * 30 }) });
    const pay = (shop: string, booking: string | null, at: string, curated: boolean) =>
      t.pg.query(`INSERT INTO payments (shop_id, booking_id, amount_cents, method, paid_at, curated) VALUES ($1, $2, 1000, 'cash', $3, $4)`, [shop, booking, at, curated]);
    await pay(D, oldBooking, old, false); // old, visitor: goes
    await pay(D, null, old, true); // old, curated: stays
    await pay(D, keptBooking, fresh, false); // fresh: stays
    await pay(R, real, old, false); // real shop: stays
    const ob = (shop: string, key: string, at: string, curated: boolean) =>
      t.pg.query(`INSERT INTO outbox (shop_id, kind, dedupe_key, phone, language, body, created_at, curated) VALUES ($1, 'review', $2, '+34612345678', 'es', 'Hola', $3, $4)`, [shop, key, at, curated]);
    await ob(D, "old", old, false);
    await ob(D, "old-curated", old, true);
    await ob(D, "fresh", fresh, false);
    await ob(R, "real", old, false);
    const blk = (shop: string, end: string, curated: boolean) =>
      t.pg.query(`INSERT INTO time_blocks (shop_id, starts_at, ends_at, curated) VALUES ($1, $2::timestamptz - interval '1 hour', $2, $3)`, [shop, end, curated]);
    await blk(D, old, false);
    await blk(D, old, true);
    await blk(D, fresh, false);
    await blk(R, old, false);
    const ex = (shop: string, at: string, curated: boolean) =>
      t.pg.query(`INSERT INTO expenses (shop_id, concept, category, amount_cents, day, created_at, curated) VALUES ($1, 'x', 'other', 500, '2026-11-01', $2, $3)`, [shop, at, curated]);
    await ex(D, old, false);
    await ex(D, old, true);
    await ex(D, fresh, false);
    await ex(R, old, false);

    expect(await runDemoRetention(deps())).toBe(true);

    const count = async (table: string, shop: string) =>
      (await t.pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE shop_id = $1`, [shop])).rows[0].n;
    for (const table of ["payments", "outbox", "time_blocks", "expenses"]) {
      expect(await count(table, D), table).toBe(2);
      expect(await count(table, R), `${table} real`).toBe(1);
    }
    const curatedLeft = await t.pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM payments WHERE shop_id = $1 AND curated`, [D]);
    expect(curatedLeft.rows[0].n).toBe(1);
  });

  it("erases, deletes, restores the 3 samples, and leaves the Real_Shop byte for byte (16.1–16.5)", async () => {
    const demo = await seedShopData(D);
    await seedShopData(R);
    const realBefore = await fullSnapshot(t, R);

    expect(await runDemoRetention(deps())).toBe(true);

    // 16.3: the old Call, its Message, its Booking and both Audit_Records are gone.
    expect(await t.handle.db.select().from(calls).where(eq(calls.id, demo.old))).toEqual([]);
    expect(await t.handle.db.select().from(messages).where(eq(messages.id, demo.oldMessage))).toEqual([]);
    expect(await t.handle.db.select().from(bookings).where(eq(bookings.id, demo.oldBooking))).toEqual([]);
    expect(await t.handle.db.select().from(ownerActions).where(eq(ownerActions.shopId, D))).toEqual([]);
    // 16.2: the 2-day-old Message is erased; its future Booking stays.
    const [recent] = await t.handle.db.select().from(messages).where(eq(messages.id, demo.recentMessage));
    expect(recent.erasedAt?.toISOString()).toBe("2026-12-21T11:00:00.000Z");
    const [future] = await t.handle.db.select().from(bookings).where(eq(bookings.id, demo.future));
    expect(future).toMatchObject({ status: "confirmed", callId: demo.recent });
    // 16.4, 16.5: the three samples, no Booking for any of them.
    const active = await t.handle.db
      .select()
      .from(messages)
      .where(and(eq(messages.shopId, D), isNull(messages.erasedAt)));
    expect(active.map((m) => m.sampleKey).sort()).toEqual(["booking", "question", "urgent"]);
    expect(active.every((m) => m.bookingId === null)).toBe(true);
    expect(active.find((m) => m.sampleKey === "urgent")).toMatchObject({
      urgency: "urgent",
      urgencyBasis: { rule: "urgent_term", term: "reacción", lang: "es" },
    });
    expect(await t.handle.db.select().from(bookings).where(eq(bookings.shopId, D))).toHaveLength(1);
    // 16.1.
    expect(await fullSnapshot(t, R)).toBe(realBefore);

    const ok = logLines.map((l) => JSON.parse(l)).filter((e) => e.outcome === "ok").at(-1);
    expect(ok).toMatchObject({
      event: "demo_retention",
      step: "samples",
      // erased counts the 10-day-old Message too: step 1 erases it before step 4 deletes it.
      counts: { erased: 2, deletedCalls: 1, deletedMessages: 1, deletedBookings: 1, deletedAuditRecords: 2, samplesAdded: 3 },
    });
  });

  it("unlinks a staying Booking from a deleted Call, and a staying Message from a deleted Booking", async () => {
    const old = await addCall(t, D, { startedAt: NOW.subtract({ hours: 200 }) });
    const staying = await addBooking(t, D, { start: NOW.add({ hours: 30 }), callId: old });
    const recentCall = await addCall(t, D, { startedAt: NOW.subtract({ hours: 2 }) });
    const gone = await addBooking(t, D, { start: NOW.subtract({ hours: 190 }) });
    const keptMessage = await addMessage(t, D, recentCall, { createdAt: NOW.subtract({ hours: 2 }), bookingId: gone });
    expect(await runDemoRetention(deps())).toBe(true);
    const [b] = await t.handle.db.select().from(bookings).where(eq(bookings.id, staying));
    expect(b.callId).toBeNull();
    const [m] = await t.handle.db.select().from(messages).where(eq(messages.id, keptMessage));
    expect(m).toMatchObject({ bookingId: null, erasedAt: null });
  });

  it("does nothing while another run holds the claim", async () => {
    await seedShopData(D);
    await owner.claimDemoRetention(NOW.subtract({ minutes: 1 }));
    const before = await fullSnapshot(t, D);
    expect(await runDemoRetention(deps())).toBe(false);
    expect(await fullSnapshot(t, D)).toBe(before);
  });

  it("adds no sample when the Tape already holds 3 New_Messages, and never a second copy of an active sample", async () => {
    for (let k = 0; k < 3; k++) await addMessage(t, D, await addCall(t, D, { startedAt: NOW }), { createdAt: NOW });
    expect(await runDemoRetention(deps())).toBe(true);
    expect(await t.handle.db.select().from(messages).where(eq(messages.shopId, D))).toHaveLength(3);

    await t.reset();
    await insertShop(t, lolaProfile);
    await addMessage(t, D, await addCall(t, D, { startedAt: NOW }), { createdAt: NOW, sampleKey: "urgent" });
    expect(await runDemoRetention(deps())).toBe(true);
    const keys = (await t.handle.db.select().from(messages).where(eq(messages.shopId, D))).map((m) => m.sampleKey).sort();
    expect(keys).toEqual(["booking", "question", "urgent"]);
  });

  it("a failing step logs one demo_retention line with counts only and does not throw (16.7)", async () => {
    await seedShopData(D);
    const failing: OwnerRepository = {
      ...owner,
      applyDemoCutoffs: async () => {
        throw Object.assign(new Error(`connection reset while deleting ${SEEDED.names[0]}`), {
          params: [SEEDED.names[0], SEEDED.phones[0]],
          cause: Object.assign(new Error("connection reset"), { code: "08006" }),
        });
      },
    };
    const before = logLines.length;
    await expect(runDemoRetention(deps(failing))).resolves.toBe(true);
    const lines = logLines.slice(before).map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: "demo_retention",
      step: "cutoffs",
      outcome: "failed",
      counts: { erased: 0, deletedCalls: 0, samplesAdded: 0 },
      error: { code: "08006", message: "connection reset" },
    });
  });

  it("a duplicate sample is refused by messages_sample_uq: the whole insert rolls back and is logged", async () => {
    // A Tape state that lies (no active samples) while the urgent sample is active.
    await addMessage(t, D, await addCall(t, D, { startedAt: NOW }), { createdAt: NOW, sampleKey: "urgent" });
    const lying: OwnerRepository = { ...owner, demoTapeState: async () => ({ newCount: 1, activeSampleKeys: [] }) };
    const before = logLines.length;
    await expect(runDemoRetention(deps(lying))).resolves.toBe(true);
    const [line] = logLines.slice(before).map((l) => JSON.parse(l));
    expect(line).toMatchObject({ step: "samples", outcome: "failed", counts: { samplesAdded: 0 } });
    expect(JSON.stringify(line)).toContain("messages_sample_uq");
    expect(await t.handle.db.select().from(messages).where(eq(messages.shopId, D))).toHaveLength(1);
    expect(await t.handle.db.select().from(calls).where(eq(calls.shopId, D))).toHaveLength(1);
  });

  it("a database that is down at the claim logs step 'claim' and reports that it did not run", async () => {
    const down: OwnerRepository = {
      ...owner,
      claimDemoRetention: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    };
    const before = logLines.length;
    await expect(runDemoRetention(deps(down))).resolves.toBe(false);
    expect(logLines.slice(before).map((l) => JSON.parse(l))).toMatchObject([{ step: "claim", outcome: "failed" }]);
  });
});

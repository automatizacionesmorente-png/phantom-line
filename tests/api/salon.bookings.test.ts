import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { bookings, clients, ownerActions, timeBlocks } from "@/lib/db/schema";
import type { SalonDeps } from "@/lib/salon/types";
import { addBooking, addCall, auditRows, bookingRow } from "../db/ownerFixtures";
import { createTestDb, type TestDb } from "../db/pglite";
import { DEMO, REAL, client, createMachineEnv, seedShops, tokenFor, type MachineEnv } from "./machineHarness";

/**
 * Salon task 4: manual bookings and time blocks through real `Request` objects on PGlite.
 * Clock: Tuesday 10 November 2026, 09:00 in Madrid. Thursday 12 November is CET (UTC+1).
 */
const THU_10 = "2026-11-12T09:00:00Z"; // 10:00 Madrid
const THU_11 = "2026-11-12T10:00:00Z";
const SUN_10 = "2026-11-15T09:00:00Z"; // closed day

let t: TestDb;
let env: MachineEnv;
let api: ReturnType<typeof client>;
let token: string;

beforeAll(async () => {
  t = await createTestDb();
}, 120_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await seedShops(t);
  env = createMachineEnv(t);
  api = client(env.handlers);
  token = tokenFor(REAL);
});

const book = (o: object = {}) => ({ resourceId: "chair-1", serviceId: "haircut", start: THU_10, name: "Marta Gil", ...o });
const open = () => ({ token });

describe("POST /bookings (manual)", () => {
  it("owner books a walk-in without phone", async () => {
    const r = await api.createBooking(REAL, book(), open());
    expect(r.status).toBe(201);
    const row = await bookingRow(t, r.json!.id as string);
    expect(row).toMatchObject({ channel: "manual", customerPhone: "", clientId: null, serviceId: "haircut", resourceId: "chair-1", priceCents: 1500, status: "confirmed" });
    expect(row.ownerConfirmedAt?.getTime()).toBe(env.now().epochMilliseconds);
    expect(row.startsAt.toISOString()).toBe("2026-11-12T09:00:00.000Z");
    expect(row.endsAt.toISOString()).toBe("2026-11-12T09:30:00.000Z");
    expect(await t.handle.db.select().from(clients)).toHaveLength(0);
    const audit = (await auditRows(t)).filter((a) => a.action === "book");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ bookingId: r.json!.id, shopId: REAL, actorLabel: "Lola" });
    expect(JSON.stringify(audit[0])).not.toContain("Marta");
  });

  it("owner books with a phone and the client is created and linked", async () => {
    const r = await api.createBooking(REAL, book({ phone: "612 345 678" }), open());
    expect(r.status).toBe(201);
    const row = await bookingRow(t, r.json!.id as string);
    expect(row.customerPhone).toBe("+34612345678");
    const cs = await t.handle.db.select().from(clients);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ shopId: REAL, phone: "+34612345678", name: "Marta Gil" });
    expect(row.clientId).toBe(cs[0].id);

    // An E.164 phone is kept as typed and reuses the same client.
    const again = await api.createBooking(REAL, book({ start: THU_11, phone: "+34612345678", name: "Marta G." }), open());
    expect(again.status).toBe(201);
    expect(await t.handle.db.select().from(clients)).toHaveLength(1);
    expect((await bookingRow(t, again.json!.id as string)).clientId).toBe(cs[0].id);
  });

  it("the booking shows up in the poll as a confirmed manual booking", async () => {
    const r = await api.createBooking(REAL, book({ phone: "612345678" }), open());
    const poll = await api.poll(REAL, null, open());
    const items = (poll.json!.agenda as { items: { id: string; source: string; state: string; status: string; priceCents: number }[] }[]).flatMap((d) => d.items);
    expect(items.find((i) => i.id === r.json!.id)).toMatchObject({ source: "manual", state: "confirmed", status: "confirmed", priceCents: 1500 });
  });

  it("manual booking loses the race with a 409", async () => {
    await addBooking(t, REAL, { start: THU_10, resourceId: "chair-1", callId: await addCall(t, REAL) });
    const r = await api.createBooking(REAL, book(), open());
    expect(r.status).toBe(409);
    expect(r.json!.error).toBe("taken");
    expect(await t.handle.db.select().from(bookings).where(eq(bookings.channel, "manual"))).toHaveLength(0);
  });

  it("the database constraint still wins when the check saw nothing (a real race)", async () => {
    const blind: SalonDeps = { ...env.deps, core: { ...env.deps.core, listBookings: async () => [] } };
    const racing = client(createMachineEnv(t, { core: blind.core }).handlers);
    await addBooking(t, REAL, { start: THU_10, resourceId: "chair-1" });
    const r = await racing.createBooking(REAL, book(), open());
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "taken", slots: [] });
    expect((await auditRows(t)).filter((a) => a.action === "book")).toHaveLength(0);
    expect(await t.handle.db.select().from(clients)).toHaveLength(0);
  });

  it("the other chair is free: booking it works", async () => {
    await addBooking(t, REAL, { start: THU_10, resourceId: "chair-1" });
    expect((await api.createBooking(REAL, book({ resourceId: "chair-2" }), open())).status).toBe(201);
  });

  it("manual booking inside a block is refused", async () => {
    await api.createBlock(REAL, { resourceId: "chair-1", start: "2026-11-12T08:30:00Z", end: "2026-11-12T10:00:00Z", reason: "Médico" }, open());
    const r = await api.createBooking(REAL, book(), open());
    expect(r.status).toBe(422);
    expect(r.json!.error).toBe("blocked");
    // The other chair is not blocked.
    expect((await api.createBooking(REAL, book({ resourceId: "chair-2" }), open())).status).toBe(201);
  });

  it("a whole-shop block refuses every chair", async () => {
    await api.createBlock(REAL, { resourceId: null, start: "2026-11-12T00:00:00Z", end: "2026-11-13T00:00:00Z", reason: "Fiesta" }, open());
    for (const resourceId of ["chair-1", "chair-2"]) {
      const r = await api.createBooking(REAL, book({ resourceId }), open());
      expect([r.status, r.json!.error]).toEqual([422, "blocked"]);
    }
  });

  it("a closed day and outside hours are 422", async () => {
    expect((await api.createBooking(REAL, book({ start: SUN_10 }), open())).json).toMatchObject({ error: "closed" });
    const late = await api.createBooking(REAL, book({ start: "2026-11-12T19:00:00Z" }), open()); // 20:00 Madrid, closed
    expect([late.status, late.json!.error]).toEqual([422, "outside_hours"]);
  });

  it("refuses a start before the shop-local today (in_the_past) and over a year ahead (too_far)", async () => {
    const early = await api.createBooking(REAL, book({ start: "2026-11-09T22:59:00Z" }), open()); // 23:59 on Monday 9th in Madrid
    expect([early.status, early.json!.error]).toEqual([422, "in_the_past"]);
    // Today's midnight is allowed by this check (the opening hours then say no, with another code).
    const midnight = await api.createBooking(REAL, book({ start: "2026-11-09T23:00:00Z" }), open());
    expect(midnight.json!.error).not.toBe("in_the_past");
    // Earlier today is allowed: the Owner writes down a visit that already happened (10:00 today, clock 13:00 Madrid).
    env.setNow(Temporal.Instant.from("2026-11-10T12:00:00Z")); // 13:00 Madrid
    expect((await api.createBooking(REAL, book({ start: "2026-11-10T09:00:00Z" }), open())).status).toBe(201); // 10:00 Madrid, earlier today
    const far = await api.createBooking(REAL, book({ start: "2027-11-12T09:00:00Z" }), open());
    expect([far.status, far.json!.error]).toEqual([422, "too_far"]);
    expect(await t.handle.db.select().from(bookings)).toHaveLength(1);
  });

  it("rejects unknown service or resource, bad phone, extra keys and a bad name", async () => {
    for (const body of [
      book({ serviceId: "nope" }),
      book({ resourceId: "nope" }),
      book({ phone: "12345" }),
      book({ name: "" }),
      book({ name: "x".repeat(61) }),
      book({ extra: 1 }),
      book({ start: "tomorrow" }),
    ]) {
      expect((await api.createBooking(REAL, body, open())).status).toBe(400);
    }
    expect(await t.handle.db.select().from(bookings)).toHaveLength(0);
  });

  it("checks origin and content type like every mutation", async () => {
    expect((await api.createBooking(REAL, book(), { ...open(), origin: "https://evil.example" })).status).toBe(403);
    expect((await api.createBooking(REAL, book(), { ...open(), contentType: "text/plain" })).status).toBe(415);
  });

  it("no session is 401", async () => {
    for (const o of [{}, { token: tokenFor(DEMO) }]) {
      const r = await api.createBooking(REAL, book(), o);
      expect(r.status).toBe(401);
    }
    expect(await t.handle.db.select().from(bookings)).toHaveLength(0);
  });

  it("a session of another shop cannot book here", async () => {
    expect((await api.createBooking(REAL, book(), { token: tokenFor(DEMO) })).status).toBe(401);
    expect(await t.handle.db.select().from(bookings)).toHaveLength(0);
  });
});

describe("blocks", () => {
  const block = (o: object = {}) => ({ resourceId: "chair-1", start: "2026-11-12T08:00:00Z", end: "2026-11-12T12:00:00Z", reason: "Vacaciones", ...o });

  it("refuses the 2001st block of a shop with 409 limit_reached", async () => {
    await t.pg.query(
      `INSERT INTO time_blocks (shop_id, resource_id, starts_at, ends_at, reason) SELECT $1, NULL, '2026-12-01T08:00:00Z', '2026-12-01T09:00:00Z', 'x' FROM generate_series(1, 2000)`,
      [REAL],
    );
    const r = await api.createBlock(REAL, block(), open());
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "limit_reached" });
    expect((await api.blocks(DEMO, { token: tokenFor(DEMO) })).status).toBe(200);
    expect((await api.createBlock(DEMO, block(), { token: tokenFor(DEMO) })).status).toBe(201);
  });

  it("block over bookings is created and lists them", async () => {
    const under = await addBooking(t, REAL, { start: THU_10, resourceId: "chair-1" });
    const otherChair = await addBooking(t, REAL, { start: THU_10, resourceId: "chair-2" });
    const before = await addBooking(t, REAL, { start: "2026-11-12T07:00:00Z", resourceId: "chair-1" }); // ends 07:30, outside
    const edge = await addBooking(t, REAL, { start: "2026-11-12T07:45:00Z", minutes: 30, resourceId: "chair-1" }); // ends 08:15, overlaps
    const cancelled = await addBooking(t, REAL, { start: THU_11, resourceId: "chair-1", status: "cancelled" });
    const r = await api.createBlock(REAL, block(), open());
    expect(r.status).toBe(201);
    const ids = (r.json!.overlapping as { id: string }[]).map((x) => x.id).sort();
    expect(ids).toEqual([under, edge].sort());
    expect(ids).not.toContain(otherChair);
    expect(ids).not.toContain(before);
    expect(ids).not.toContain(cancelled);
    expect(r.json!.block).toMatchObject({ resourceId: "chair-1", reason: "Vacaciones", start: "2026-11-12T08:00:00Z", end: "2026-11-12T12:00:00Z" });
    // The bookings are untouched.
    expect((await bookingRow(t, under)).status).toBe("confirmed");
    expect(await t.handle.db.select().from(timeBlocks)).toHaveLength(1);
  });

  it("a whole-shop block lists the bookings of every chair", async () => {
    const a = await addBooking(t, REAL, { start: THU_10, resourceId: "chair-1" });
    const b = await addBooking(t, REAL, { start: THU_10, resourceId: "chair-2" });
    const r = await api.createBlock(REAL, block({ resourceId: null }), open());
    expect((r.json!.overlapping as { id: string }[]).map((x) => x.id).sort()).toEqual([a, b].sort());
  });

  it("lists blocks of a window, the default being today and 31 days", async () => {
    await api.createBlock(REAL, block(), open());
    await api.createBlock(REAL, block({ start: "2027-03-01T08:00:00Z", end: "2027-03-02T08:00:00Z" }), open());
    const inWindow = await api.blocks(REAL, open());
    expect(inWindow.status).toBe(200);
    expect((inWindow.json!.blocks as unknown[]).length).toBe(1);
    const wide = await api.blocks(REAL, { ...open(), query: "?from=2026-11-01T00:00:00Z&to=2027-04-01T00:00:00Z" });
    expect((wide.json!.blocks as unknown[]).length).toBe(2);
    expect((await api.blocks(REAL, { ...open(), query: "?from=2026-11-01T00:00:00Z" })).status).toBe(200);
    expect((await api.blocks(REAL, { ...open(), query: "?from=2026-11-05T00:00:00Z&to=2026-11-01T00:00:00Z" })).status).toBe(400);
    expect((await api.blocks(REAL, { ...open(), query: "?x=1" })).status).toBe(400);
  });

  it("deletes a block, and the slot opens again", async () => {
    const made = await api.createBlock(REAL, block(), open());
    const id = (made.json!.block as { id: string }).id;
    expect((await api.createBooking(REAL, book(), open())).status).toBe(422);
    const del = await api.deleteBlock(REAL, id, open());
    expect(del.status).toBe(200);
    expect(await t.handle.db.select().from(timeBlocks)).toHaveLength(0);
    expect((await api.createBooking(REAL, book(), open())).status).toBe(201);
  });

  it("cross-shop id is not_found, and the block stays", async () => {
    const made = await api.createBlock(REAL, block(), open());
    const id = (made.json!.block as { id: string }).id;
    const other = await api.deleteBlock(DEMO, id, { token: tokenFor(DEMO) });
    expect([other.status, other.json]).toEqual([404, { error: "block_not_found" }]);
    expect((await api.deleteBlock(REAL, "not-a-uuid", open())).status).toBe(404);
    expect((await api.deleteBlock(REAL, "00000000-0000-4000-8000-0000000000ff", open())).status).toBe(404);
    expect(await t.handle.db.select().from(timeBlocks).where(and(eq(timeBlocks.id, id)))).toHaveLength(1);
    // And the other shop's list never shows it.
    const list = await api.blocks(DEMO, { token: tokenFor(DEMO), query: "?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z" });
    expect(list.json).toEqual({ blocks: [] });
  });

  it("a block starting over a year ahead is refused", async () => {
    const r = await api.createBlock(REAL, block({ start: "2027-12-01T08:00:00Z", end: "2027-12-02T08:00:00Z" }), open());
    expect(r.status).toBe(400);
    expect((await api.createBlock(REAL, block({ start: "2027-11-09T08:00:00Z", end: "2027-11-10T08:00:00Z" }), open())).status).toBe(201);
  });

  it("the warning lists at most 50 bookings and says it was cut", async () => {
    for (let k = 0; k < 51; k++) {
      await addBooking(t, REAL, { start: Temporal.Instant.from("2026-11-12T08:00:00Z").add({ minutes: 30 * k }), resourceId: "chair-1" });
    }
    const r = await api.createBlock(REAL, block({ start: "2026-11-12T00:00:00Z", end: "2026-11-14T00:00:00Z" }), open());
    expect(r.status).toBe(201);
    expect((r.json!.overlapping as unknown[]).length).toBe(50);
    expect(r.json!.truncated).toBe(true);
    const few = await api.createBlock(REAL, block({ start: "2026-11-12T08:00:00Z", end: "2026-11-12T09:00:00Z" }), open());
    expect(few.json!.truncated).toBe(false);
  });

  it("validates: unknown chair, end before start, too long, extra keys", async () => {
    for (const body of [
      block({ resourceId: "nope" }),
      block({ end: "2026-11-12T08:00:00Z" }),
      block({ end: "2028-11-12T12:00:00Z" }),
      block({ reason: "x".repeat(81) }),
      block({ extra: 1 }),
    ]) {
      expect((await api.createBlock(REAL, body, open())).status).toBe(400);
    }
    expect(await t.handle.db.select().from(timeBlocks)).toHaveLength(0);
  });

  it("no session is 401 on every block route", async () => {
    const id = "00000000-0000-4000-8000-0000000000ff";
    expect((await api.blocks(REAL)).status).toBe(401);
    expect((await api.createBlock(REAL, block())).status).toBe(401);
    expect((await api.deleteBlock(REAL, id)).status).toBe(401);
    expect(await t.handle.db.select().from(timeBlocks)).toHaveLength(0);
  });

  it("the audit log holds no personal data", async () => {
    await api.createBooking(REAL, book({ phone: "612345678" }), open());
    const all = JSON.stringify(await t.handle.db.select().from(ownerActions));
    expect(all).not.toContain("Marta");
    expect(all).not.toContain("612345678");
  });
});

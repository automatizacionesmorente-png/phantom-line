import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { bookings, clients, ownerActions } from "@/lib/db/schema";
import { DEMO_SHOP_ID } from "@/lib/owner/demo";
import { runDemoRetention } from "@/lib/owner/demoRetention";
import type { OwnerRepository } from "@/lib/owner/types";
import { lolaProfile } from "../fixtures/lola";
import { bookingWrite, callWrite, insertShop, messageWrite } from "./helpers";
import { ACTOR, addBooking, ownerRepoOf, realProfile } from "./ownerFixtures";
import { createTestDb, type TestDb } from "./pglite";

/** BACKLOG 14: the customer book on PGlite: upsert by phone, per-shop scoping, no-shows, retention. */
const D = DEMO_SHOP_ID;
const R = realProfile.id;
const NOW = Temporal.Instant.from("2026-12-21T11:00:00Z");
const PHONE = "+34612345678";

let t: TestDb;
let owner: OwnerRepository;
beforeAll(async () => {
  t = await createTestDb();
  owner = ownerRepoOf(t);
}, 120_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
  await insertShop(t, realProfile);
});

const rows = (shopId: string) => t.handle.db.select().from(clients).where(eq(clients.shopId, shopId));

/** A Call with a Booking, written the way handleTurn writes them. */
async function callWithBooking(shopId: string, o: { name?: string; phone?: string; start?: string; lang?: "es" | "en" } = {}) {
  const call = callWrite(shopId);
  call.call.language = o.lang ?? "es";
  const booking = bookingWrite({
    shopId,
    callId: call.call.id,
    start: o.start ?? "2026-12-22T10:00:00Z",
    customerName: o.name ?? "Carlos Vega",
    customerPhone: o.phone ?? PHONE,
  });
  expect(await t.repo.commit([call, booking])).toEqual({ ok: true });
  return { call, booking };
}

describe("clients are created and updated by the writes that carry a name and a phone", () => {
  it("a Booking creates the Client; the next Booking of the same shop and phone updates it, never duplicates", async () => {
    await callWithBooking(R, { name: "Carlos Vega", start: "2026-12-22T10:00:00Z" });
    await callWithBooking(R, { name: "Carlos Vega García", start: "2026-12-23T10:00:00Z", lang: "en" });
    const list = await rows(R);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ phone: PHONE, name: "Carlos Vega García", language: "en", note: "", curated: false });
  });

  it("a Message with name and phone creates a Client too, with the Call's language", async () => {
    const call = callWrite(R);
    call.call.language = "en";
    await t.repo.commit([call, messageWrite(R, call.call.id)]);
    expect(await rows(R)).toMatchObject([{ phone: PHONE, name: "Ana", language: "en" }]);
  });

  it("the same phone in two shops is two Clients", async () => {
    await callWithBooking(R);
    await callWithBooking(D, { name: "Otra Persona" });
    expect(await rows(R)).toMatchObject([{ name: "Carlos Vega" }]);
    expect(await rows(D)).toMatchObject([{ name: "Otra Persona" }]);
  });

  it("a phone that is not E.164 or a blank name creates nothing and does not break the write", async () => {
    await callWithBooking(R, { phone: "612345678" });
    await callWithBooking(R, { name: "   ", phone: "+34600000009", start: "2026-12-24T10:00:00Z" });
    expect(await rows(R)).toHaveLength(0);
    expect(await t.handle.db.select().from(bookings).where(eq(bookings.shopId, R))).toHaveLength(2);
  });

  it("a curated client is never overwritten by a caller who gives the same phone", async () => {
    await t.handle.db.insert(clients).values({ shopId: D, phone: PHONE, name: "Carlos Vega", note: "VIP", curated: true });
    await callWithBooking(D, { name: "Impostor" });
    expect(await rows(D)).toMatchObject([{ name: "Carlos Vega", note: "VIP", curated: true }]);
  });

  it("findClient reads only the asked shop and exact phone, and offers the usual after 2 visits of one service", async () => {
    await callWithBooking(R);
    const now = Temporal.Instant.from("2026-12-30T00:00:00Z");
    expect(await t.repo.findClient!(R, PHONE, now)).toEqual({ name: "Carlos Vega", phone: PHONE, usualServiceId: null });
    await callWithBooking(R, { start: "2026-12-23T10:00:00Z" });
    expect((await t.repo.findClient!(R, PHONE, now))?.usualServiceId).toBe("haircut");
    expect(await t.repo.findClient!(D, PHONE, now)).toBeNull();
    expect(await t.repo.findClient!(R, "+34600000000", now)).toBeNull();
  });
});

describe("owner reads and the private note are scoped to the shop", () => {
  it("listClients returns the shop's clients with their own bookings only", async () => {
    await callWithBooking(R);
    await callWithBooking(D, { name: "Demo Client" });
    const list = await owner.listClients(R, 100);
    expect(list).toHaveLength(1);
    expect(list[0].bookings).toHaveLength(1);
    expect(list[0].name).toBe("Carlos Vega");
  });

  it("getClient and setClientNote refuse another shop's id and a malformed id", async () => {
    await callWithBooking(R);
    const [mine] = await owner.listClients(R, 10);
    expect(await owner.getClient(D, mine.id)).toBeNull();
    expect(await owner.setClientNote(D, mine.id, "pwned")).toBe(false);
    expect(await owner.getClient(R, "not-a-uuid")).toBeNull();
    expect(await owner.setClientNote(R, "not-a-uuid", "x")).toBe(false);
    expect((await rows(R))[0].note).toBe("");
    expect(await owner.setClientNote(R, mine.id, "Prefiere el sillón 2")).toBe(true);
    expect((await owner.getClient(R, mine.id))?.note).toBe("Prefiere el sillón 2");
  });

  it("the database refuses a note over 500 characters", async () => {
    await callWithBooking(R);
    const [mine] = await owner.listClients(R, 10);
    await expect(owner.setClientNote(R, mine.id, "x".repeat(501))).rejects.toThrow();
    expect(await owner.setClientNote(R, mine.id, "x".repeat(500))).toBe(true);
  });
});

describe('"No vino" on a past booking', () => {
  const PAST = "2026-12-10T10:00:00Z";
  const cmd = (bookingId: string, noShow: boolean, over: Record<string, unknown> = {}) =>
    ({ kind: "no_show", shopId: R, bookingId, phone: PHONE, noShow, actor: ACTOR, now: NOW, ...over }) as const;

  it("marks it, audits it, counts it as a no-show, and can be undone", async () => {
    const id = await addBooking(t, R, { start: PAST, phone: PHONE });
    expect((await owner.applyOwnerCommand(cmd(id, true))).status).toBe("applied");
    const [row] = await t.handle.db.select().from(bookings).where(eq(bookings.id, id));
    expect(row.noShowAt).not.toBeNull();
    const audit = await t.handle.db.select().from(ownerActions).where(eq(ownerActions.bookingId, id));
    expect(audit).toMatchObject([{ action: "no_show", shopId: R, before: { noShow: false }, after: { noShow: true } }]);
    // Marking twice is a noop with no second audit record.
    expect((await owner.applyOwnerCommand(cmd(id, true))).status).toBe("noop");
    expect(await t.handle.db.select().from(ownerActions).where(eq(ownerActions.bookingId, id))).toHaveLength(1);
    expect((await owner.applyOwnerCommand(cmd(id, false))).status).toBe("applied");
    expect((await t.handle.db.select().from(bookings).where(eq(bookings.id, id)))[0].noShowAt).toBeNull();
  });

  it("refuses a booking that has not finished, a cancelled one, another shop's and another phone's", async () => {
    const future = await addBooking(t, R, { start: "2026-12-22T10:00:00Z", phone: PHONE });
    const cancelled = await addBooking(t, R, { start: PAST, phone: PHONE, status: "cancelled", resourceId: "chair-2" });
    const mine = await addBooking(t, R, { start: "2026-12-09T10:00:00Z", phone: PHONE });
    expect((await owner.applyOwnerCommand(cmd(future, true))).status).toBe("stale");
    expect((await owner.applyOwnerCommand(cmd(cancelled, true))).status).toBe("stale");
    expect((await owner.applyOwnerCommand(cmd(mine, true, { shopId: D }))).status).toBe("not_found");
    expect((await owner.applyOwnerCommand(cmd(mine, true, { phone: "+34600000000" }))).status).toBe("not_found");
    expect((await owner.applyOwnerCommand(cmd("nope", true))).status).toBe("not_found");
    const noShows = await t.handle.db.select().from(bookings).where(and(eq(bookings.shopId, R)));
    expect(noShows.every((b) => b.noShowAt === null)).toBe(true);
  });
});

describe("Demo_Retention and the customer book", () => {
  const deps = () => ({ repo: owner, clock: () => NOW, newId: () => randomUUID(), log: () => {} });
  const old = new Date(NOW.subtract({ hours: 200 }).epochMilliseconds);
  const recent = new Date(NOW.subtract({ hours: 2 }).epochMilliseconds);

  it("deletes the demo shop's old non-curated clients, keeps curated and recent ones, never touches a Real_Shop", async () => {
    await t.handle.db.insert(clients).values([
      { shopId: D, phone: "+34600000001", name: "Viejo", updatedAt: old },
      { shopId: D, phone: "+34600000002", name: "Reciente", updatedAt: recent },
      { shopId: D, phone: "+34600000003", name: "Curado", updatedAt: old, curated: true },
      { shopId: R, phone: "+34600000004", name: "Real viejo", updatedAt: old },
    ]);
    expect(await runDemoRetention(deps())).toBe(true);
    expect((await rows(D)).map((c) => c.name).sort()).toEqual(["Curado", "Reciente"]);
    expect((await rows(R)).map((c) => c.name)).toEqual(["Real viejo"]);
  });
});

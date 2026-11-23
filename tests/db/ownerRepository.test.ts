import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { messages } from "@/lib/db/schema";
import type { OwnerRepository } from "@/lib/owner/types";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { callWrite, insertShop, messageWrite } from "./helpers";
import {
  ACTOR,
  addBooking,
  addCall,
  addMessage,
  auditRows,
  bookingRow,
  messageRow,
  ownerRepoOf,
  realProfile,
  versionOf,
} from "./ownerFixtures";

/** Owner-machine task 8.6: migrations, triggers and every OwnerCommand on PGlite. */

const SHOP = lolaProfile.id;
/** Tuesday 10 November 2026, 09:00 in Madrid. */
const NOW = Temporal.Instant.from("2026-11-10T08:00:00Z");
/** Thursday 12 November, 10:00 and 17:00 Madrid. */
const THU10 = "2026-11-12T09:00:00Z";
const THU17 = "2026-11-12T16:00:00Z";

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

describe("migrations 0000–0007", () => {
  it("all apply, in order", async () => {
    const r = await t.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
    expect(r.rows[0].n).toBe(8);
  });

  it("create the deferred machine-version triggers, the revision trigger and the erase guard", async () => {
    const r = await t.pg.query<{ tgname: string; tgdeferrable: boolean; tginitdeferred: boolean }>(
      "SELECT tgname, tgdeferrable, tginitdeferred FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname",
    );
    const by = Object.fromEntries(r.rows.map((x) => [x.tgname, x]));
    expect(by.messages_machine_version).toMatchObject({ tgdeferrable: true, tginitdeferred: true });
    expect(by.bookings_machine_version).toMatchObject({ tgdeferrable: true, tginitdeferred: true });
    expect(by.bookings_revision).toMatchObject({ tgdeferrable: false });
    expect(by.messages_erase_permanent).toMatchObject({ tgdeferrable: false });
  });

  it("bump the revision and record 'caller' on a caller's cancel (11.5)", async () => {
    const id = await addBooking(t, SHOP, { start: THU10 });
    expect((await bookingRow(t, id)).revision).toBe(0);
    expect(await t.repo.commit([{ type: "cancelBooking", bookingId: id }])).toEqual({ ok: true });
    const row = await bookingRow(t, id);
    expect(row).toMatchObject({ revision: 1, status: "cancelled", cancelledBy: "caller" });
  });

  it("bump the Machine_Version once per changed row, at commit, and not for a write that inserts nothing", async () => {
    const v0 = await versionOf(t, SHOP);
    const call = callWrite(SHOP);
    await t.repo.commit([call]);
    expect(await versionOf(t, SHOP)).toBe(v0); // calls are not watched
    await t.repo.commit([messageWrite(SHOP, call.call.id)]);
    expect(await versionOf(t, SHOP)).toBe(v0 + 1);
    await t.repo.commit([messageWrite(SHOP, call.call.id)]); // a late hang-up: ON CONFLICT DO NOTHING
    expect(await versionOf(t, SHOP)).toBe(v0 + 1);
    expect(await versionOf(t, realProfile.id)).toBe(0);
  });

  it("insertMessage stores the suggestion and the basis when the write carries them, NULL otherwise (4.3)", async () => {
    const a = callWrite(SHOP);
    const b = callWrite(SHOP);
    await t.repo.commit([a, b]);
    const plain = messageWrite(SHOP, a.call.id);
    const withBasis = messageWrite(SHOP, b.call.id);
    Object.assign(withBasis.message, {
      urgency: "urgent",
      urgencySuggested: "low",
      urgencyBasis: { rule: "urgent_term", term: "urgente", lang: "es" },
    });
    await t.repo.commit([plain, withBasis]);
    const rows = await t.handle.db.select().from(messages);
    const of = (callId: string) => rows.find((r) => r.callId === callId)!;
    expect(of(a.call.id)).toMatchObject({ urgencySuggested: null, urgencyBasis: null });
    expect(of(b.call.id)).toMatchObject({
      urgency: "urgent",
      urgencySuggested: "low",
      urgencyBasis: { rule: "urgent_term", term: "urgente", lang: "es" },
    });
  });
});

describe("booking commands", () => {
  async function booking(start = THU10, resourceId = "chair-1") {
    return addBooking(t, SHOP, { start, resourceId });
  }

  it("confirm: applied with its Audit_Record, then noop with none (10.2)", async () => {
    const id = await booking();
    const v0 = await versionOf(t, SHOP);
    const r = await owner.applyOwnerCommand({ kind: "confirm", shopId: SHOP, bookingId: id, revision: 0, actor: ACTOR, now: NOW });
    expect(r).toEqual({ status: "applied", version: v0 + 1 });
    const row = await bookingRow(t, id);
    expect(row.ownerConfirmedAt?.toISOString()).toBe("2026-11-10T08:00:00.000Z");
    expect(row.revision).toBe(1);

    const audit = await auditRows(t);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      shopId: SHOP,
      action: "confirm",
      bookingId: id,
      messageId: null,
      actorSession: ACTOR.sessionId,
      actorLabel: "Lola",
      before: { start: "2026-11-12T09:00:00.000Z", end: "2026-11-12T09:30:00.000Z", resourceId: "chair-1", status: "confirmed", ownerConfirmed: false },
      after: { start: "2026-11-12T09:00:00.000Z", end: "2026-11-12T09:30:00.000Z", resourceId: "chair-1", status: "confirmed", ownerConfirmed: true },
    });

    const again = await owner.applyOwnerCommand({ kind: "confirm", shopId: SHOP, bookingId: id, revision: 1, actor: ACTOR, now: NOW });
    expect(again).toEqual({ status: "noop", version: v0 + 1 });
    expect(await auditRows(t)).toHaveLength(1);
  });

  it("stale: the caller cancelled it since the Owner loaded it; nothing written (10.7, 11.3)", async () => {
    const id = await booking();
    await t.repo.commit([{ type: "cancelBooking", bookingId: id }]);
    const v = await versionOf(t, SHOP);
    for (const kind of ["confirm", "cancel"] as const) {
      expect(await owner.applyOwnerCommand({ kind, shopId: SHOP, bookingId: id, revision: 0, actor: ACTOR, now: NOW })).toEqual({ status: "stale", version: v });
    }
    const move = await owner.applyOwnerCommand({
      kind: "move", shopId: SHOP, bookingId: id, revision: 0, actor: ACTOR, now: NOW,
      to: { start: Temporal.Instant.from(THU17), end: Temporal.Instant.from(THU17).add({ minutes: 30 }), resourceId: "chair-1" },
    });
    expect(move).toEqual({ status: "stale", version: v });
    expect(await auditRows(t)).toHaveLength(0);
  });

  it("stale: another device moved it, so a confirm, cancel or move at the old revision is refused (10.7)", async () => {
    const id = await booking();
    const start = Temporal.Instant.from(THU17);
    const to = { start, end: start.add({ minutes: 30 }), resourceId: "chair-1" };
    expect((await owner.applyOwnerCommand({ kind: "move", shopId: SHOP, bookingId: id, revision: 0, actor: ACTOR, now: NOW, to })).status).toBe("applied");
    const moved = await bookingRow(t, id);
    for (const kind of ["confirm", "cancel"] as const) {
      expect((await owner.applyOwnerCommand({ kind, shopId: SHOP, bookingId: id, revision: 0, actor: ACTOR, now: NOW })).status).toBe("stale");
    }
    const back = { start: Temporal.Instant.from(THU10), end: Temporal.Instant.from(THU10).add({ minutes: 30 }), resourceId: "chair-1" };
    expect((await owner.applyOwnerCommand({ kind: "move", shopId: SHOP, bookingId: id, revision: 0, actor: ACTOR, now: NOW, to: back })).status).toBe("stale");
    expect(await bookingRow(t, id)).toEqual(moved);
    expect(await auditRows(t)).toHaveLength(1);
  });

  it("stale: a Booking that has started cannot be changed, even at its revision (10.1)", async () => {
    const id = await booking("2026-11-10T07:30:00Z");
    const r = await owner.applyOwnerCommand({ kind: "cancel", shopId: SHOP, bookingId: id, revision: 0, actor: ACTOR, now: NOW });
    expect(r.status).toBe("stale");
    expect((await bookingRow(t, id)).status).toBe("confirmed");
    expect(await auditRows(t)).toHaveLength(0);
  });

  it("not_found: an unknown id, a non-UUID id, and another shop's Booking (14.3)", async () => {
    const other = await addBooking(t, realProfile.id, { start: THU10 });
    for (const bookingId of [randomUUID(), "not-a-uuid", other]) {
      const r = await owner.applyOwnerCommand({ kind: "cancel", shopId: SHOP, bookingId, revision: 0, actor: ACTOR, now: NOW });
      expect(r.status).toBe("not_found");
    }
    expect((await bookingRow(t, other)).status).toBe("confirmed");
    expect(await auditRows(t)).toHaveLength(0);
  });

  it("move: applied in place, keeps the customer, drops the confirmation; the audit holds the after-state (10.6)", async () => {
    const id = await booking();
    await owner.applyOwnerCommand({ kind: "confirm", shopId: SHOP, bookingId: id, revision: 0, actor: ACTOR, now: NOW });
    const start = Temporal.Instant.from(THU17);
    const r = await owner.applyOwnerCommand({
      kind: "move", shopId: SHOP, bookingId: id, revision: 1, actor: { sessionId: "s2", label: "Marta" }, now: NOW.add({ minutes: 1 }),
      to: { start, end: start.add({ minutes: 30 }), resourceId: "chair-2" },
    });
    expect(r.status).toBe("applied");
    const row = await bookingRow(t, id);
    expect(row).toMatchObject({ resourceId: "chair-2", ownerConfirmedAt: null, customerName: "Ana", serviceId: "haircut", status: "confirmed", revision: 2 });
    expect(row.startsAt.toISOString()).toBe("2026-11-12T16:00:00.000Z");
    const audit = await auditRows(t);
    expect(audit[1]).toMatchObject({
      action: "move",
      actorLabel: "Marta",
      before: { start: "2026-11-12T09:00:00.000Z", resourceId: "chair-1", ownerConfirmed: true },
      after: { start: "2026-11-12T16:00:00.000Z", end: "2026-11-12T16:30:00.000Z", resourceId: "chair-2", status: "confirmed", ownerConfirmed: false },
    });
    const agenda = await owner.getBooking(SHOP, id);
    expect(agenda?.lastOwnerAction).toMatchObject({ action: "move", label: "Marta" });
  });

  it("overlap: the no-overlap constraint refuses a move onto a taken chair; nothing written (10.5, 11.3)", async () => {
    const id = await booking();
    await booking(THU17, "chair-2");
    const v = await versionOf(t, SHOP);
    const start = Temporal.Instant.from(THU17).add({ minutes: 15 });
    const r = await owner.applyOwnerCommand({
      kind: "move", shopId: SHOP, bookingId: id, revision: 0, actor: ACTOR, now: NOW,
      to: { start, end: start.add({ minutes: 30 }), resourceId: "chair-2" },
    });
    expect(r).toEqual({ status: "overlap", version: v });
    expect(await bookingRow(t, id)).toMatchObject({ resourceId: "chair-1", revision: 0 });
    expect(await auditRows(t)).toHaveLength(0);
  });

  it("cancel: applied, marked as the Owner's, then stale at the old revision (10.8)", async () => {
    const id = await booking();
    expect((await owner.applyOwnerCommand({ kind: "cancel", shopId: SHOP, bookingId: id, revision: 0, actor: ACTOR, now: NOW })).status).toBe("applied");
    const row = await bookingRow(t, id);
    expect(row).toMatchObject({ status: "cancelled", cancelledBy: "owner", revision: 1 });
    expect(row.cancelledAt?.toISOString()).toBe("2026-11-10T08:00:00.000Z");
    expect((await owner.applyOwnerCommand({ kind: "cancel", shopId: SHOP, bookingId: id, revision: 0, actor: ACTOR, now: NOW })).status).toBe("stale");
    const audit = await auditRows(t);
    expect(audit).toHaveLength(1);
    expect(audit[0].after).toMatchObject({ status: "cancelled", ownerConfirmed: false });
    // The Agenda still lists it, cancelled, with who did it (9.4, 9.5).
    const agenda = await owner.listAgenda(SHOP, NOW, NOW.add({ hours: 24 * 8 }));
    expect(agenda.map((b) => [b.id, b.status, b.cancelledBy, b.lastOwnerAction?.label])).toEqual([[id, "cancelled", "owner", "Lola"]]);
  });
});

describe("message commands", () => {
  async function message(bookingId?: string) {
    const callId = await addCall(t, SHOP, { transcript: [{ caller: "", receptionist: "Hola" }, { caller: "Quería cita", receptionist: "Vale" }] });
    return addMessage(t, SHOP, callId, { bookingId });
  }

  it("play: marks Heard once and records only the first play (7.4)", async () => {
    const id = await message();
    expect((await owner.pollHead(SHOP))?.counts).toEqual({ new: 1, unheard: 1 });
    expect((await owner.applyOwnerCommand({ kind: "play", shopId: SHOP, messageId: id, actor: ACTOR, now: NOW })).status).toBe("applied");
    expect((await owner.applyOwnerCommand({ kind: "play", shopId: SHOP, messageId: id, actor: ACTOR, now: NOW.add({ minutes: 1 }) })).status).toBe("noop");
    expect((await messageRow(t, id)).readAt?.toISOString()).toBe("2026-11-10T08:00:00.000Z");
    const audit = await auditRows(t);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "play", messageId: id, bookingId: null, before: { heard: false, erased: false }, after: { heard: true, erased: false } });
    expect((await owner.pollHead(SHOP))?.counts).toEqual({ new: 1, unheard: 0 });
  });

  it("erase twice: one Audit_Record, the Message leaves the Tape and the counts (8.1, 8.2)", async () => {
    const id = await message();
    const first = await owner.applyOwnerCommand({ kind: "erase", shopId: SHOP, messageId: id, actor: ACTOR, now: NOW });
    const second = await owner.applyOwnerCommand({ kind: "erase", shopId: SHOP, messageId: id, actor: ACTOR, now: NOW.add({ minutes: 1 }) });
    expect(first.status).toBe("applied");
    expect(second).toEqual({ status: "noop", version: first.version });
    const audit = await auditRows(t);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "erase", before: { erased: false, heard: false }, after: { erased: true, heard: true } });
    expect(await owner.listTape(SHOP, 200)).toEqual([]);
    expect((await owner.pollHead(SHOP))?.counts).toEqual({ new: 0, unheard: 0 });
    expect(await owner.getTranscript(SHOP, id)).toBeNull();
    // Play on an erased Message changes nothing.
    expect((await owner.applyOwnerCommand({ kind: "play", shopId: SHOP, messageId: id, actor: ACTOR, now: NOW })).status).toBe("noop");
  });

  it("not_found: an unknown id, a non-UUID id and another shop's Message", async () => {
    const otherCall = await addCall(t, realProfile.id);
    const other = await addMessage(t, realProfile.id, otherCall);
    for (const messageId of [randomUUID(), "x'; DROP TABLE messages; --", other]) {
      for (const kind of ["play", "erase"] as const) {
        expect((await owner.applyOwnerCommand({ kind, shopId: SHOP, messageId, actor: ACTOR, now: NOW })).status).toBe("not_found");
      }
    }
    expect((await messageRow(t, other)).erasedAt).toBeNull();
    expect(await auditRows(t)).toHaveLength(0);
  });

  it("no statement can set erased_at back to NULL, or move it (8.3)", async () => {
    const id = await message();
    await owner.applyOwnerCommand({ kind: "erase", shopId: SHOP, messageId: id, actor: ACTOR, now: NOW });
    await expect(t.pg.query("UPDATE messages SET erased_at = NULL WHERE id = $1", [id])).rejects.toThrow(/stays erased/);
    await expect(t.handle.db.update(messages).set({ erasedAt: null }).where(eq(messages.id, id))).rejects.toThrow();
    await expect(t.pg.query("UPDATE messages SET erased_at = now() + interval '1 day' WHERE id = $1", [id])).rejects.toThrow(/stays erased/);
    expect((await messageRow(t, id)).erasedAt?.toISOString()).toBe("2026-11-10T08:00:00.000Z");
    // Other columns of an erased row can still change (for example the retention unlinking a Booking).
    await t.handle.db.update(messages).set({ suggestedReply: "x" }).where(eq(messages.id, id));
  });

  it("erasing a Message leaves its Booking unchanged (8.4)", async () => {
    const bookingId = await addBooking(t, SHOP, { start: THU10 });
    const id = await message(bookingId);
    const before = await bookingRow(t, bookingId);
    await owner.applyOwnerCommand({ kind: "erase", shopId: SHOP, messageId: id, actor: ACTOR, now: NOW });
    expect(await bookingRow(t, bookingId)).toEqual(before);
  });
});

describe("reads", () => {
  it("listTape joins the Call's language and the Booking as it is now, with the latest owner move, and no Transcript (14.2)", async () => {
    const bookingId = await addBooking(t, SHOP, { start: THU10 });
    const callId = await addCall(t, SHOP, { transcript: [{ caller: "secreto", receptionist: "x" }] });
    const id = await addMessage(t, SHOP, callId, { bookingId });
    const start = Temporal.Instant.from(THU17);
    await owner.applyOwnerCommand({
      kind: "move", shopId: SHOP, bookingId, revision: 0, actor: ACTOR, now: NOW,
      to: { start, end: start.add({ minutes: 30 }), resourceId: "chair-1" },
    });
    const [row] = await owner.listTape(SHOP, 200);
    expect(row.id).toBe(id);
    expect(row.callLang).toBe("es");
    expect(row.booking?.start.toString()).toBe("2026-11-12T16:00:00Z");
    expect(row.booking?.ownerMovedAt?.toString()).toBe(NOW.toString());
    expect(JSON.stringify(row)).not.toContain("secreto");
    expect(await owner.getTranscript(SHOP, id)).toEqual({ lines: [{ caller: "secreto", receptionist: "x" }], lang: "es" });
    expect(await owner.getTranscript(realProfile.id, id)).toBeNull();
  });

  it("listTape: an owner move of one Booking is not reported on another Message's Booking", async () => {
    const moved = await addBooking(t, SHOP, { start: THU10 });
    const untouched = await addBooking(t, SHOP, { start: THU10, resourceId: "chair-2" });
    const m1 = await addMessage(t, SHOP, await addCall(t, SHOP), { bookingId: moved });
    const m2 = await addMessage(t, SHOP, await addCall(t, SHOP), { bookingId: untouched });
    const start = Temporal.Instant.from(THU17);
    await owner.applyOwnerCommand({
      kind: "move", shopId: SHOP, bookingId: moved, revision: 0, actor: ACTOR, now: NOW,
      to: { start, end: start.add({ minutes: 30 }), resourceId: "chair-1" },
    });
    const rows = await owner.listTape(SHOP, 200);
    const of = (id: string) => rows.find((r) => r.id === id)!;
    expect(of(m1).booking?.ownerMovedAt?.toString()).toBe(NOW.toString());
    expect(of(m2).booking?.ownerMovedAt).toBeNull();
  });

  it("listTape lists newest first and only that shop's New_Messages, up to the limit", async () => {
    const ids: string[] = [];
    for (let k = 0; k < 3; k++) {
      ids.push(await addMessage(t, SHOP, await addCall(t, SHOP), { createdAt: NOW.subtract({ minutes: 10 - k }) }));
    }
    await addMessage(t, realProfile.id, await addCall(t, realProfile.id));
    expect((await owner.listTape(SHOP, 200)).map((r) => r.id)).toEqual([...ids].reverse());
    expect((await owner.listTape(SHOP, 2)).map((r) => r.id)).toEqual([ids[2], ids[1]]);
  });

  it("pollHead and getShopAccess: null for an unknown shop; the PIN hash only through getShopAccess", async () => {
    expect(await owner.pollHead("nope")).toBeNull();
    expect(await owner.getShopAccess("nope")).toBeNull();
    const at = Temporal.Instant.from("2026-11-01T10:00:00Z");
    await owner.setOwnerPin(SHOP, "scrypt$16384$8$1$abc$def", at);
    expect(await owner.getShopAccess(SHOP)).toMatchObject({ pinHash: "scrypt$16384$8$1$abc$def" });
    expect((await owner.getShopAccess(SHOP))?.pinSetAt?.toString()).toBe(at.toString());
    const head = await owner.pollHead(SHOP);
    expect(head?.pinSetAt?.toString()).toBe(at.toString());
    expect(JSON.stringify(head)).not.toContain("scrypt");
  });

  it("hitCounters counts per key and window, in the order asked", async () => {
    const w15 = Temporal.Instant.from("2026-11-10T08:00:00Z");
    const w60 = Temporal.Instant.from("2026-11-10T08:00:00Z");
    const keys = [
      { key: "pin:v:peluqueria-lola:abc", windowStart: w15 },
      { key: "pin:s:peluqueria-lola", windowStart: w60 },
    ];
    expect(await owner.hitCounters(keys)).toEqual([1, 1]);
    expect(await owner.hitCounters(keys)).toEqual([2, 2]);
    expect(await owner.hitCounters([keys[1]])).toEqual([3]);
    expect(await owner.hitCounters([{ key: keys[0].key, windowStart: w15.add({ minutes: 15 }) }])).toEqual([1]);
  });

  it("the Machine_Version of a raw transaction moves only at commit (deferred trigger)", async () => {
    const callId = await addCall(t, SHOP);
    const v0 = await versionOf(t, SHOP);
    await t.handle.db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO messages (shop_id, call_id, channel, reason, urgency, agreed, suggested_reply, outcome)
                           VALUES (${SHOP}, ${callId}::uuid, 'voice', 'r', 'low', 'a', 's', 'message')`);
      const inside = (await tx.execute(sql`SELECT machine_version AS v FROM shops WHERE id = ${SHOP}`)) as { rows: { v: unknown }[] };
      expect(Number(inside.rows[0].v)).toBe(v0);
    });
    expect(await versionOf(t, SHOP)).toBe(v0 + 1);
  });
});

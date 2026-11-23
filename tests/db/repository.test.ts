import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleQueryError, eq, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { bookings, calls, messages, rateLimits, shops } from "@/lib/db/schema";
import { isOverlapViolation, rateWindows } from "@/lib/db/repository";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { bookingWrite, callWrite, insertShop, messageWrite } from "./helpers";

const SHOP = lolaProfile.id;
// Tuesday 17 November 2026, 10:00 Madrid = 09:00Z.
const T10 = "2026-11-17T09:00:00Z";
const T1015 = "2026-11-17T09:15:00Z";
const T1030 = "2026-11-17T09:30:00Z";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
});

async function newCall() {
  const w = callWrite(SHOP);
  expect(await t.repo.commit([w])).toEqual({ ok: true });
  return w.call.id;
}
const confirmedRows = () =>
  t.handle.db.select().from(bookings).where(eq(bookings.status, "confirmed"));

describe("the bookings_no_overlap constraint", () => {
  it("rejects overlapping confirmed bookings on one chair, as booking_overlap", async () => {
    expect(await t.repo.commit([bookingWrite({ shopId: SHOP, callId: await newCall(), start: T10 })])).toEqual({ ok: true });
    const clash = await t.repo.commit([bookingWrite({ shopId: SHOP, callId: await newCall(), start: T1015 })]);
    expect(clash).toEqual({ ok: false, conflict: "booking_overlap" });
    expect(await confirmedRows()).toHaveLength(1);
  });

  it("is enforced by Postgres itself, not by the repository: a raw INSERT fails with 23P01", async () => {
    await t.repo.commit([bookingWrite({ shopId: SHOP, callId: await newCall(), start: T10 })]);
    const raw = t.pg.query(
      `INSERT INTO bookings (shop_id, resource_id, service_id, starts_at, ends_at, customer_name, customer_phone, channel)
       VALUES ($1, 'chair-1', 'haircut', $2, $3, 'X', '+34600000000', 'voice')`,
      [SHOP, T1015, "2026-11-17T09:45:00Z"],
    );
    const err = await raw.then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(isOverlapViolation(err)).toBe(true);
  });

  it("recognises 23P01 also when Drizzle wraps the driver error (the neon-http path PGlite does not run)", () => {
    const neonError = Object.assign(new Error("conflicting key value violates exclusion constraint"), {
      name: "NeonDbError",
      code: "23P01",
    });
    expect(isOverlapViolation(new DrizzleQueryError("insert into bookings ...", [], neonError))).toBe(true);
    const unique = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(isOverlapViolation(new DrizzleQueryError("insert into bookings ...", [], unique))).toBe(false);
    expect(isOverlapViolation(undefined)).toBe(false);
  });

  it("allows the other chair, back-to-back bookings and an overlap with a cancelled row", async () => {
    const first = bookingWrite({ shopId: SHOP, callId: await newCall(), start: T10 });
    expect(await t.repo.commit([first])).toEqual({ ok: true });
    expect(await t.repo.commit([bookingWrite({ shopId: SHOP, callId: await newCall(), start: T1015, resourceId: "chair-2" })])).toEqual({ ok: true });
    expect(await t.repo.commit([bookingWrite({ shopId: SHOP, callId: await newCall(), start: T1030 })])).toEqual({ ok: true });

    expect(await t.repo.commit([{ type: "cancelBooking", bookingId: first.booking.id }])).toEqual({ ok: true });
    expect(await t.repo.commit([bookingWrite({ shopId: SHOP, callId: await newCall(), start: T10 })])).toEqual({ ok: true });
    const [cancelled] = await t.handle.db.select().from(bookings).where(eq(bookings.id, first.booking.id));
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(await confirmedRows()).toHaveLength(3);
  });

  it("does not compare bookings of different shops", async () => {
    await insertShop(t, { ...lolaProfile, id: "otra", name: "Otra Peluquería" });
    await t.repo.commit([bookingWrite({ shopId: SHOP, callId: await newCall(), start: T10 })]);
    const otherCall = callWrite("otra");
    await t.repo.commit([otherCall]);
    expect(await t.repo.commit([bookingWrite({ shopId: "otra", callId: otherCall.call.id, start: T10 })])).toEqual({ ok: true });
  });
});

describe("atomic writes", () => {
  it("a reschedule batch rolls back completely when the new slot conflicts", async () => {
    const mine = bookingWrite({ shopId: SHOP, callId: await newCall(), start: T10 });
    const theirs = bookingWrite({ shopId: SHOP, callId: await newCall(), start: T1030, customerName: "Luis" });
    await t.repo.commit([mine, theirs]);

    const call = await newCall();
    const result = await t.repo.commit([
      { type: "cancelBooking", bookingId: mine.booking.id },
      bookingWrite({ shopId: SHOP, callId: call, start: "2026-11-17T09:40:00Z", rescheduledFrom: mine.booking.id }),
      messageWrite(SHOP, call),
      { type: "updateCall", callId: call, state: { ...callWrite(SHOP).call.state, stage: "done" }, transcript: [], turnCount: 5, status: "completed" },
    ]);
    expect(result).toEqual({ ok: false, conflict: "booking_overlap" });

    const [old] = await t.handle.db.select().from(bookings).where(eq(bookings.id, mine.booking.id));
    expect(old.status).toBe("confirmed"); // the old booking is never lost without a new one (5.10)
    expect(await confirmedRows()).toHaveLength(2);
    expect(await t.handle.db.select().from(messages)).toHaveLength(0);
    const [c] = await t.handle.db.select().from(calls).where(eq(calls.id, call));
    expect(c.status).toBe("open");
    expect(c.turnCount).toBe(0);
  });

  it("a reschedule batch that fits replaces the old booking", async () => {
    const mine = bookingWrite({ shopId: SHOP, callId: await newCall(), start: T10 });
    await t.repo.commit([mine]);
    const call = await newCall();
    // 15 minutes later on the same chair: the old row leaves the constraint in the same batch.
    const moved = bookingWrite({ shopId: SHOP, callId: call, start: T1015, rescheduledFrom: mine.booking.id });
    expect(await t.repo.commit([{ type: "cancelBooking", bookingId: mine.booking.id }, moved])).toEqual({ ok: true });
    const rows = await confirmedRows();
    expect(rows.map((r) => [r.id, r.rescheduledFrom])).toEqual([[moved.booking.id, mine.booking.id]]);
  });
});

describe("one Booking and one Message per Call", () => {
  it("a second Booking for the same Call is rejected by the unique key", async () => {
    const call = await newCall();
    await t.repo.commit([bookingWrite({ shopId: SHOP, callId: call, start: T10 })]);
    await expect(t.repo.commit([bookingWrite({ shopId: SHOP, callId: call, start: "2026-11-18T09:00:00Z" })])).rejects.toThrow();
    expect(await t.handle.db.select().from(bookings)).toHaveLength(1);
  });

  it("a second Message for the same Call is ignored (idempotent hang-up and sweep)", async () => {
    const call = await newCall();
    expect(await t.repo.commit([messageWrite(SHOP, call)])).toEqual({ ok: true });
    expect(await t.repo.commit([{ ...messageWrite(SHOP, call), message: { ...messageWrite(SHOP, call).message, reason: "otra" } }])).toEqual({ ok: true });
    const rows = await t.handle.db.select().from(messages);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("Quiere una cita de corte");
  });

  it("a Message can point at the Booking inserted in the same batch", async () => {
    const call = await newCall();
    const b = bookingWrite({ shopId: SHOP, callId: call, start: T10 });
    await t.repo.commit([b, messageWrite(SHOP, call, b.booking.id)]);
    const [m] = await t.handle.db.select().from(messages);
    expect(m.bookingId).toBe(b.booking.id);
  });
});

describe("rate limits", () => {
  const at = (iso: string) => Temporal.Instant.from(iso);

  it("counts per visitor per minute and globally per hour", async () => {
    const now = at("2026-11-11T09:12:30Z");
    expect(await t.repo.hitRateLimits("visitor-a", now)).toEqual({ visitor: 1, global: 1 });
    expect(await t.repo.hitRateLimits("visitor-a", at("2026-11-11T09:12:59Z"))).toEqual({ visitor: 2, global: 2 });
    expect(await t.repo.hitRateLimits("visitor-b", now)).toEqual({ visitor: 1, global: 3 });
    // Next minute, same hour: the visitor window resets, the global one does not.
    expect(await t.repo.hitRateLimits("visitor-a", at("2026-11-11T09:13:00Z"))).toEqual({ visitor: 1, global: 4 });
    // Next hour: both reset.
    expect(await t.repo.hitRateLimits("visitor-a", at("2026-11-11T10:00:00Z"))).toEqual({ visitor: 1, global: 1 });
  });

  it("windows are UTC minutes and hours, also for a half-hour time zone offset", () => {
    expect(rateWindows(at("2026-11-11T09:12:30.5Z"))).toEqual({
      visitorWindow: at("2026-11-11T09:12:00Z"),
      globalWindow: at("2026-11-11T09:00:00Z"),
    });
  });

  it("prunes old windows", async () => {
    await t.repo.hitRateLimits("visitor-a", at("2026-11-09T09:00:00Z"));
    await t.repo.hitRateLimits("visitor-a", at("2026-11-11T09:00:00Z"));
    expect(await t.repo.pruneRateLimits(at("2026-11-10T09:00:00Z"))).toBe(2); // visitor + global rows of the 9th
    expect((await t.handle.db.select().from(rateLimits)).length).toBe(2);
  });
});

describe("reads", () => {
  it("findCallerBookings returns only upcoming, confirmed bookings for that phone and shop", async () => {
    const now = Temporal.Instant.from("2026-11-17T09:20:00Z");
    const w = (start: string, over: Partial<Parameters<typeof bookingWrite>[0]> = {}) =>
      newCall().then((callId) => bookingWrite({ shopId: SHOP, callId, start, ...over }));
    const past = await w("2026-11-17T08:00:00Z");
    const started = await w(T1015, { resourceId: "chair-2" }); // started 5 minutes before now
    const upcoming = await w("2026-11-18T09:00:00Z");
    const later = await w("2026-11-20T09:00:00Z");
    const cancelled = await w("2026-11-19T09:00:00Z");
    const otherPhone = await w("2026-11-18T10:00:00Z", { customerPhone: "+34699999999" });
    await t.repo.commit([past, started, upcoming, later, cancelled, otherPhone]);
    await t.repo.commit([{ type: "cancelBooking", bookingId: cancelled.booking.id }]);

    const found = await t.repo.findCallerBookings(SHOP, "+34612345678", now);
    expect(found.map((b) => b.id)).toEqual([upcoming.booking.id, later.booking.id]);
    expect(found[0]).toMatchObject({ serviceId: "haircut", customerName: "Ana", customerPhone: "+34612345678", resourceId: "chair-1" });
    expect(found[0].start.toString()).toBe("2026-11-18T09:00:00Z");
    expect(found[0].end.toString()).toBe("2026-11-18T09:30:00Z");
  });

  it("listBookings returns confirmed bookings that intersect the window", async () => {
    const a = bookingWrite({ shopId: SHOP, callId: await newCall(), start: T10 });
    const b = bookingWrite({ shopId: SHOP, callId: await newCall(), start: "2026-11-18T09:00:00Z" });
    await t.repo.commit([a, b]);
    const from = Temporal.Instant.from("2026-11-17T09:29:00Z");
    const to = Temporal.Instant.from("2026-11-18T09:00:00Z"); // b starts exactly at `to`: excluded
    expect((await t.repo.listBookings(SHOP, from, to)).map((x) => x.id)).toEqual([a.booking.id]);
  });

  it("getShop validates the profile; getCall is scoped to the shop", async () => {
    expect(await t.repo.getShop(SHOP)).toEqual(lolaProfile);
    expect(await t.repo.getShop("nope")).toBeNull();
    await t.handle.db.update(shops).set({ profile: sql`'{"id":"broken"}'::jsonb` }).where(eq(shops.id, SHOP));
    await expect(t.repo.getShop(SHOP)).rejects.toThrow(/invalid profile/);
  });

  it("getCall returns the stored call only for its own shop", async () => {
    const id = await newCall();
    const call = await t.repo.getCall(id, SHOP);
    expect(call).toMatchObject({ id, shopId: SHOP, status: "open", turnCount: 0, channel: "voice", language: "es" });
    expect(await t.repo.getCall(id, "otra")).toBeNull();
    expect(await t.repo.getCall(randomUUID(), SHOP)).toBeNull();
  });
});

describe("closeStaleCalls", () => {
  it("closes idle open calls as abandoned with their Message, once", async () => {
    const stale = await newCall();
    const done = await newCall();
    await t.repo.commit([
      {
        type: "updateCall",
        callId: stale,
        state: { ...callWrite(SHOP).call.state, fields: { name: "Ana", phone: "+34612345678" }, note: { reason: "Quiere cita", urgency: "normal" } },
        transcript: [{ caller: "hola", receptionist: "hola" }],
        turnCount: 1,
      },
      { type: "updateCall", callId: done, state: callWrite(SHOP).call.state, transcript: [], turnCount: 3, status: "completed" },
    ]);
    // Nothing is idle for 10 minutes yet.
    expect(await t.repo.closeStaleCalls(SHOP, Temporal.Now.instant().subtract({ minutes: 10 }))).toBe(0);

    const later = Temporal.Now.instant().add({ minutes: 1 });
    expect(await t.repo.closeStaleCalls(SHOP, later)).toBe(1);
    const [c] = await t.handle.db.select().from(calls).where(eq(calls.id, stale));
    expect(c.status).toBe("abandoned");
    expect(c.endedAt).not.toBeNull();
    expect(c.state.stage).toBe("done");
    const ms = await t.handle.db.select().from(messages);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ callId: stale, outcome: "abandoned", callerName: "Ana", callerPhone: "+34612345678", reason: "Llamada sin terminar" });
    expect(ms[0].agreed).toBe("Nada acordado; colgó antes de terminar");

    expect(await t.repo.closeStaleCalls(SHOP, later)).toBe(0);
    expect(await t.handle.db.select().from(messages)).toHaveLength(1);
  });
});

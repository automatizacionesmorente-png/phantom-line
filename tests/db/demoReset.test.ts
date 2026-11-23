import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { localDateOf, sessionsOn } from "@/lib/booking";
import { toShopRules } from "@/lib/conversation/shopProfile";
import { buildCuratedSet, TEST_BOOKING_NAMES } from "@/lib/demo/curated";
import { checkResetTarget } from "@/lib/demo/guard";
import { resetDemo } from "@/lib/demo/reset";
import { bookings, calls, messages, ownerActions } from "@/lib/db/schema";
import { lolaSeedProfile } from "@/lib/db/seed";
import { computeWeekStats } from "@/lib/owner/weekStats";
import { DEMO_SHOP_ID } from "@/lib/owner/demo";
import { runDemoRetention } from "@/lib/owner/demoRetention";
import { ACTOR, addBooking, addCall, addMessage, fullSnapshot, ownerRepoOf, realProfile } from "./ownerFixtures";
import { insertShop } from "./helpers";
import { createTestDb, type TestDb } from "./pglite";

const D = DEMO_SHOP_ID;
const R = realProfile.id;
/** Monday 21 December 2026, 12:00 Madrid. */
const NOW = Temporal.Instant.from("2026-12-21T11:00:00Z");

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 120_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaSeedProfile);
  await insertShop(t, { ...lolaSeedProfile, id: R, name: "Barbería Real" });
});

const run = (now = NOW) => resetDemo(t.handle, { now, newId: () => randomUUID() });
const rowsOf = async (shopId: string) => ({
  calls: await t.handle.db.select().from(calls).where(eq(calls.shopId, shopId)),
  messages: await t.handle.db.select().from(messages).where(eq(messages.shopId, shopId)),
  bookings: await t.handle.db.select().from(bookings).where(eq(bookings.shopId, shopId)),
});
/** The content of a shop's rows without ids, so two runs can be compared. */
const content = async (shopId: string) => {
  const r = await rowsOf(shopId);
  const strip = <T extends object>(x: T) => {
    const { id: _id, callId: _c, bookingId: _b, ...rest } = x as Record<string, unknown>;
    void _id; void _c; void _b;
    return JSON.stringify(rest, Object.keys(rest).sort());
  };
  return {
    messages: r.messages.map(strip).sort(),
    bookings: r.bookings.map(strip).sort(),
    calls: r.calls.map(strip).sort(),
  };
};

describe("buildCuratedSet", () => {
  const instants = [
    NOW,
    Temporal.Instant.from("2026-12-19T18:30:00Z"), // Saturday 19:30 Madrid
    Temporal.Instant.from("2026-12-20T09:00:00Z"), // Sunday
    Temporal.Instant.from("2026-03-27T22:00:00Z"), // Friday night before the DST change
    Temporal.Instant.from("2026-12-23T08:59:00Z"), // Wednesday just before opening
  ];
  const tz = lolaSeedProfile.timeZone;

  it.each(instants.map((i) => [i.toString(), i] as const))("is valid at %s", (_label, now) => {
    const set = buildCuratedSet({ now, shop: lolaSeedProfile, newId: () => randomUUID() });
    const shop = toShopRules(lolaSeedProfile);
    expect(set.bookings.length).toBeGreaterThanOrEqual(10);
    expect(new Set(set.bookings.map((b) => b.resourceId))).toEqual(new Set(["chair-1", "chair-2"]));
    const today = localDateOf(now, tz);
    for (const b of set.bookings) {
      const svc = lolaSeedProfile.services.find((s) => s.id === b.serviceId);
      expect(svc, b.serviceId).toBeDefined();
      expect(b.endsAt.epochMilliseconds - b.startsAt.epochMilliseconds).toBe(svc!.durationMin * 60_000);
      expect(Temporal.Instant.compare(b.startsAt, now)).toBeGreaterThan(0);
      const date = localDateOf(b.startsAt, tz);
      expect(Temporal.PlainDate.compare(date, today)).toBeGreaterThanOrEqual(0);
      expect(Temporal.PlainDate.compare(date, today.add({ days: 7 }))).toBeLessThan(0);
      const inside = sessionsOn(date, shop).some(
        (s) => Temporal.Instant.compare(b.startsAt, s.open) >= 0 && Temporal.Instant.compare(b.endsAt, s.close) <= 0,
      );
      expect(inside, `${b.serviceId} ${b.startsAt}`).toBe(true);
    }
    for (const chair of ["chair-1", "chair-2"]) {
      const own = set.bookings.filter((b) => b.resourceId === chair);
      for (let i = 1; i < own.length; i++) {
        expect(Temporal.Instant.compare(own[i].startsAt, own[i - 1].endsAt)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("has the four Messages: urgent, English, booking confirmed, answered", () => {
    const set = buildCuratedSet({ now: NOW, shop: lolaSeedProfile, newId: () => randomUUID() });
    expect(set.messages).toHaveLength(4);
    expect(set.messages.filter((m) => m.urgency === "urgent")).toHaveLength(1);
    const english = set.calls.filter((c) => c.language === "en");
    expect(english).toHaveLength(1);
    expect(set.messages.find((m) => m.callId === english[0].id)!.suggestedReply).toMatch(/Lola/);
    const booked = set.messages.filter((m) => m.outcome === "booked");
    expect(booked).toHaveLength(1);
    const b = set.bookings.find((x) => x.id === booked[0].bookingId)!;
    expect(b.ownerConfirmed).toBe(true);
    expect(b.callId).toBe(booked[0].callId);
    expect(set.messages.filter((m) => m.outcome === "answered")).toHaveLength(1);
    for (const m of set.messages) expect(set.calls.some((c) => c.id === m.callId)).toBe(true);
  });
});

describe("resetDemo", () => {
  it("replaces everything of the demo shop, test bookings included", async () => {
    const call = await addCall(t, D, { startedAt: NOW.subtract({ hours: 5 }) });
    const b = await addBooking(t, D, { start: NOW.add({ hours: 30 }), name: TEST_BOOKING_NAMES[0], callId: call });
    await addBooking(t, D, { start: NOW.add({ hours: 60 }), name: TEST_BOOKING_NAMES[1] });
    const m = await addMessage(t, D, call, { bookingId: b });
    await t.handle.db.insert(ownerActions).values({
      shopId: D, action: "confirm", bookingId: b, actorSession: ACTOR.sessionId, actorLabel: "Lola", before: {}, after: {},
    });
    void m;
    const r = await run();
    expect(r.deleted).toEqual({ calls: 1, messages: 1, bookings: 2, testBookings: 2 });
    const after = await rowsOf(D);
    expect(after.messages).toHaveLength(4);
    expect(after.bookings.map((x) => x.customerName)).not.toContain(TEST_BOOKING_NAMES[0]);
    expect(after.bookings.map((x) => x.customerName)).not.toContain(TEST_BOOKING_NAMES[1]);
    expect([...after.calls, ...after.messages, ...after.bookings].every((x) => x.curated)).toBe(true);
    expect(await t.handle.db.select().from(ownerActions)).toHaveLength(0);
  });

  it("is idempotent: a second run leaves the same content", async () => {
    await run();
    const first = await content(D);
    const r2 = await run();
    expect(await content(D)).toEqual(first);
    expect(r2.deleted.messages).toBe(4);
    expect((await rowsOf(D)).messages).toHaveLength(4);
  });

  it("changes only the demo shop", async () => {
    const call = await addCall(t, R, { startedAt: NOW.subtract({ hours: 5 }) });
    const b = await addBooking(t, R, { start: NOW.add({ hours: 30 }), name: TEST_BOOKING_NAMES[0], callId: call });
    await addMessage(t, R, call, { bookingId: b });
    const before = await fullSnapshot(t, R);
    await run();
    expect(await fullSnapshot(t, R)).toBe(before);
  });

  it("fails without writing when the demo shop does not exist", async () => {
    await t.reset();
    await expect(run()).rejects.toThrow(/does not exist/);
  });

  it("loads the whole week through the no-overlap constraint", async () => {
    await run();
    const rows = (await rowsOf(D)).bookings;
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });
});

describe("Demo_Retention keeps the curated set", () => {
  it("neither erases nor deletes curated rows, even long after the reset", async () => {
    const loaded = (await run()).loaded;
    const later = NOW.add({ hours: 24 * 30 });
    const owner = ownerRepoOf(t);
    await runDemoRetention({ repo: owner, clock: () => later, newId: () => randomUUID(), log: () => {} });
    const after = await rowsOf(D);
    expect(after.calls).toHaveLength(loaded.calls);
    expect(after.messages).toHaveLength(4);
    expect(after.messages.every((m) => m.erasedAt === null)).toBe(true);
    expect(after.bookings.length).toBeGreaterThanOrEqual(10);
    // No sample was added on top: the curated Messages already fill the Tape.
    expect(after.messages.every((m) => m.sampleKey === null)).toBe(true);
  });

  it("still forgets an ordinary old row next to them", async () => {
    const loaded = (await run()).loaded;
    const old = await addCall(t, D, { startedAt: NOW.subtract({ hours: 240 }) });
    await addMessage(t, D, old, { createdAt: NOW.subtract({ hours: 240 }) });
    await runDemoRetention({ repo: ownerRepoOf(t), clock: () => NOW, newId: () => randomUUID(), log: () => {} });
    const after = await rowsOf(D);
    expect(after.calls).toHaveLength(loaded.calls);
    expect(after.messages).toHaveLength(4);
  });
});

describe("checkResetTarget", () => {
  const neon = "postgresql://user:secret@ep-cool-1234.eu-central-1.aws.neon.tech/db?sslmode=require";
  it("refuses a remote database without --allow-remote", () => {
    expect(checkResetTarget(neon, [])).toEqual({ ok: false, reason: "remote_needs_flag" });
    expect(checkResetTarget(neon, ["--other"])).toEqual({ ok: false, reason: "remote_needs_flag" });
  });
  it("accepts a remote database with the flag", () => {
    expect(checkResetTarget(neon, ["--allow-remote"])).toEqual({ ok: true, remote: true });
  });
  it("accepts local hosts without the flag", () => {
    for (const u of ["postgres://u:p@localhost:5432/d", "postgres://u:p@127.0.0.1/d", "postgres://u:p@[::1]:5432/d"]) {
      expect(checkResetTarget(u, [])).toEqual({ ok: true, remote: false });
    }
  });
  it("refuses a missing or malformed URL, flag or not", () => {
    expect(checkResetTarget(undefined, ["--allow-remote"])).toEqual({ ok: false, reason: "no_url" });
    expect(checkResetTarget("not a url", ["--allow-remote"])).toEqual({ ok: false, reason: "bad_url" });
    expect(checkResetTarget("postgres://localhost.evil.com/d", [])).toEqual({ ok: false, reason: "remote_needs_flag" });
  });
});

describe("the curated set's last 7 days (BACKLOG 17)", () => {
  /** Mondays, mornings, Sunday nights, a DST week: the last 7 days always hold rows. */
  const AT = [
    "2026-12-21T00:30:00Z",
    "2026-12-21T11:00:00Z",
    "2026-12-22T00:05:00Z",
    "2026-12-23T12:00:00Z",
    "2026-12-26T18:00:00Z",
    "2026-12-27T22:30:00Z",
    "2027-03-29T09:00:00Z",
    "2026-10-27T09:00:00Z",
  ];
  it.each(AT)("gives non-zero, consistent numbers at %s", (iso) => {
    const now = Temporal.Instant.from(iso);
    const set = buildCuratedSet({ now, shop: lolaSeedProfile, newId: () => randomUUID() });
    const s = computeWeekStats({
      now,
      shop: lolaSeedProfile,
      calls: set.calls.map((c) => ({ id: c.id, status: "completed", startedAt: c.startedAt, updatedAt: c.endedAt, endedAt: c.endedAt })),
      bookings: set.bookings.map((b) => ({
        id: b.id,
        serviceId: b.serviceId,
        callId: b.callId,
        rescheduledFrom: null,
        status: "confirmed",
        createdAt: b.createdAt ?? now,
      })),
    });
        expect(s.bookings).toBeGreaterThanOrEqual(1);
    expect(s.revenueCents).toBeGreaterThan(0);
    expect(s.timeSavedSeconds).toBeGreaterThan(0);
    expect(s.lostCalls).toBeGreaterThanOrEqual(1);
    expect(s.lostCalls).toBeLessThanOrEqual(s.callsAnswered);
    // Believable on any day: most calls are inside the hours, and a few are not.
    expect(s.callsAnswered).toBeGreaterThanOrEqual(10);
    expect(s.lostCalls).toBeLessThan(s.callsAnswered / 2);
    // Every call ended by now, and every booking came after its call began.
    for (const c of set.calls) expect(Temporal.Instant.compare(c.endedAt, now)).toBeLessThanOrEqual(0);
    for (const b of set.bookings.filter((x) => x.callId)) {
      expect(Temporal.Instant.compare(b.createdAt ?? now, now)).toBeLessThanOrEqual(0);
      expect(set.calls.some((c) => c.id === b.callId)).toBe(true);
    }
  });
});

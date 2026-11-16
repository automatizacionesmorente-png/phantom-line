import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { bookings } from "@/lib/db/schema";
import type { AgendaItem, PollChanged, SlotDto, TapeItem } from "@/lib/owner/api";
import { addBooking, addCall, addMessage, auditRows, bookingRow, messageRow, versionOf } from "../db/ownerFixtures";
import { createTestDb, type TestDb } from "../db/pglite";
import { DEMO, PIN, REAL, SECRET, client, createMachineEnv, seedShops, tokenFor, type MachineEnv } from "./machineHarness";

/**
 * Owner-machine task 10.6: the Message and Booking actions and the Move_Slots through real
 * `Request` objects on PGlite (Requirements 7.4, 7.6, 8.2, 10.1–10.9, 14.3).
 * Clock: Tuesday 10 November 2026, 09:00 in Madrid (08:00 UTC). Thursday 12 November is CET.
 */

const THU_10 = "2026-11-12T09:00:00Z";
const THU_17 = "2026-11-12T16:00:00Z";
const OTHER_SHOP_SECRETS = ["Zacarías Otro", "+34699000111", "Quiero un tinte para el sábado"];

let t: TestDb;
let env: MachineEnv;
let api: ReturnType<typeof client>;
let token: string;
let b1: string;
let m1: string;
let m2: string;
let demoMessage: string;
let demoBooking: string;

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

  const call1 = await addCall(t, REAL, { transcript: [{ caller: "Hola, quiero una cita", receptionist: "Claro, ¿qué día?" }] });
  b1 = await addBooking(t, REAL, { start: THU_10, callId: call1 });
  m1 = await addMessage(t, REAL, call1, { bookingId: b1, createdAt: "2026-11-10T07:30:00Z" });
  const call2 = await addCall(t, REAL, { transcript: [{ caller: "¿Cuánto cuesta?", receptionist: "Quince euros" }] });
  m2 = await addMessage(t, REAL, call2, { name: "Luis", reason: "Pregunta el precio", createdAt: "2026-11-10T07:40:00Z" });

  // Another shop's data: no answer for the Real_Shop's session may ever contain it (14.3).
  const demoCall = await addCall(t, DEMO, { transcript: [{ caller: OTHER_SHOP_SECRETS[2], receptionist: "Vale" }] });
  demoBooking = await addBooking(t, DEMO, { start: THU_10, name: OTHER_SHOP_SECRETS[0], phone: OTHER_SHOP_SECRETS[1], callId: demoCall });
  demoMessage = await addMessage(t, DEMO, demoCall, {
    bookingId: demoBooking,
    name: OTHER_SHOP_SECRETS[0],
    phone: OTHER_SHOP_SECRETS[1],
    createdAt: "2026-11-10T07:50:00Z",
  });
});
afterEach(() => {
  // 14.3: whatever the test did, no body held the PIN, its hash, the secret, a token or another shop's data.
  for (const body of api.seen) {
    for (const s of [PIN, SECRET, "scrypt$", "v1.", ...OTHER_SHOP_SECRETS]) expect(body).not.toContain(s);
  }
});

const open = (o: object = {}) => ({ token, ...o });
const poll = async (since: number | null = null) => (await api.poll(REAL, since, open())).json as unknown as PollChanged;
const item = (tape: TapeItem[], id: string) => tape.find((x) => x.id === id);
const agendaItem = (p: PollChanged, id: string) => p.agenda.flatMap((d) => d.items).find((x) => x.id === id) as AgendaItem;

describe("the Poll", () => {
  it("sends the Tape without Transcripts and the 8-day Agenda, then the small body for the same version", async () => {
    const first = await poll();
    expect(first.changed).toBe(true);
    expect(first.counts).toEqual({ new: 2, unheard: 2 });
    expect(first.tape.map((x) => x.id)).toEqual([m2, m1]); // newest first
    expect(first.agenda).toHaveLength(8);
    expect(first.agenda[0].date).toBe("2026-11-10");
    expect(JSON.stringify(first)).not.toContain("Hola, quiero una cita"); // no Transcript (14.2)

    const booked = item(first.tape, m1)!;
    expect(booked.agreed).toHaveProperty("byLang");
    expect(item(first.tape, m2)!.agreed).toEqual({ stored: "Cita de corte" });
    expect(agendaItem(first, b1)).toMatchObject({ status: "booked", actions: ["confirm", "move", "cancel"], revision: 0 });

    const again = await api.poll(REAL, first.version, open());
    expect(again.json).toEqual({ changed: false, version: first.version, counts: { new: 2, unheard: 2 } });
    expect(again.text.length).toBeLessThan(200);
  });
});

describe("play and erase", () => {
  it("play returns the Transcript and marks the Message heard once", async () => {
    const before = await versionOf(t, REAL);
    const r = await api.message(REAL, m1, { action: "play" }, open());
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      transcript: [{ caller: "Hola, quiero una cita", receptionist: "Claro, ¿qué día?" }],
      lang: "es",
      version: before + 1,
    });
    expect((await messageRow(t, m1)).readAt).not.toBeNull();
    expect((await auditRows(t)).map((a) => a.action)).toEqual(["play"]);

    const second = await api.message(REAL, m1, { action: "play" }, open());
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ version: before + 1 }); // nothing changed
    expect((await auditRows(t)).map((a) => a.action)).toEqual(["play"]); // only the first play is recorded

    const p = await poll();
    expect(item(p.tape, m1)!.heard).toBe(true);
    expect(p.counts).toEqual({ new: 2, unheard: 1 });
  });

  it("erase twice is idempotent: the same answer, one Audit_Record, and the Message leaves the Tape", async () => {
    const first = await api.message(REAL, m2, { action: "erase" }, open());
    const second = await api.message(REAL, m2, { action: "erase" }, open());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.json).toEqual(first.json);
    expect((await auditRows(t)).filter((a) => a.action === "erase")).toHaveLength(1);

    const p = await poll();
    expect(p.tape.map((x) => x.id)).toEqual([m1]);
    expect(p.counts).toEqual({ new: 1, unheard: 1 });
    // Erasing a Message leaves its Booking alone (8.4), and a play after it is a 404 (8.1).
    expect(agendaItem(p, b1).status).toBe("booked");
    expect((await api.message(REAL, m2, { action: "play" }, open())).json).toEqual({ error: "message_not_found" });
  });

  it("answers 404 for an unknown id, a malformed id and another shop's Message, and leaves that Message alone", async () => {
    for (const id of ["00000000-0000-4000-8000-00000000abcd", "not-a-uuid", demoMessage]) {
      for (const action of ["play", "erase"] as const) {
        const r = await api.message(REAL, id, { action }, open());
        expect(r.status).toBe(404);
        expect(r.json).toEqual({ error: "message_not_found" });
      }
    }
    const row = await messageRow(t, demoMessage);
    expect(row.readAt).toBeNull();
    expect(row.erasedAt).toBeNull();
    expect(await auditRows(t)).toEqual([]);
  });

  it("rejects an unknown action and an extra field with 400", async () => {
    expect((await api.message(REAL, m1, { action: "delete" }, open())).status).toBe(400);
    expect((await api.message(REAL, m1, { action: "play", extra: 1 }, open())).status).toBe(400);
    expect((await api.message(REAL, m1, {}, open())).status).toBe(400);
  });
});

describe("confirm, cancel and the revision", () => {
  it("confirm answers the booking as confirmed; confirming again is a no-op, and an old revision is stale", async () => {
    const r = await api.booking(REAL, b1, { action: "confirm", revision: 0 }, open());
    expect(r.status).toBe(200);
    const booking = (r.json as unknown as { booking: AgendaItem; version: number }).booking;
    expect(booking).toMatchObject({ status: "confirmed", actions: ["move", "cancel"], revision: 1 });
    expect(booking.lastOwnerAction).toMatchObject({ action: "confirm", label: "Lola" });

    const version = await versionOf(t, REAL);
    const noop = await api.booking(REAL, b1, { action: "confirm", revision: 1 }, open());
    expect(noop.status).toBe(200);
    expect(await versionOf(t, REAL)).toBe(version);
    expect((await auditRows(t)).filter((a) => a.action === "confirm")).toHaveLength(1);

    const stale = await api.booking(REAL, b1, { action: "confirm", revision: 0 }, open());
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ error: "stale", booking: { id: b1, status: "confirmed", revision: 1 } });
  });

  it("a Booking the caller cancelled since the screen loaded answers stale with the current row", async () => {
    expect(await t.repo.commit([{ type: "cancelBooking", bookingId: b1 }])).toEqual({ ok: true });
    for (const body of [
      { action: "confirm", revision: 0 },
      { action: "cancel", revision: 0 },
      { action: "move", revision: 0, start: THU_17 },
    ]) {
      const r = await api.booking(REAL, b1, body, open());
      expect(r.status).toBe(409);
      expect(r.json).toMatchObject({ error: "stale", booking: { id: b1, status: "cancelled", cancelledBy: "caller", actions: [] } });
    }
    expect(await auditRows(t)).toEqual([]);
  });

  it("cancel records the Owner as who cancelled, and a cancelled booking allows nothing (10.1)", async () => {
    const r = await api.booking(REAL, b1, { action: "cancel", revision: 0 }, open());
    expect(r.status).toBe(200);
    expect((r.json as unknown as { booking: AgendaItem }).booking).toMatchObject({
      status: "cancelled",
      cancelledBy: "owner",
      actions: [],
      revision: 1,
    });
    expect((await bookingRow(t, b1)).cancelledBy).toBe("owner");
    for (const action of ["confirm", "cancel"] as const) {
      const again = await api.booking(REAL, b1, { action, revision: 1 }, open());
      expect(again.status).toBe(409);
      expect(again.json).toEqual({ error: "not_allowed" });
    }
    expect((await api.booking(REAL, b1, { action: "move", revision: 1, start: THU_17 }, open())).json).toEqual({ error: "not_allowed" });
  });

  it("a booking that has started allows no action (10.1)", async () => {
    const started = await addBooking(t, REAL, { start: "2026-11-10T07:30:00Z", resourceId: "chair-2" });
    for (const body of [
      { action: "confirm", revision: 0 },
      { action: "cancel", revision: 0 },
      { action: "move", revision: 0, start: THU_17 },
    ]) {
      const r = await api.booking(REAL, started, body, open());
      expect(r.status).toBe(409);
      expect(r.json).toEqual({ error: "not_allowed" });
    }
    expect((await bookingRow(t, started)).status).toBe("confirmed");
  });

  it("answers 404 for an unknown, malformed or other shop's booking, and 400 for a missing revision or extra field", async () => {
    for (const id of ["00000000-0000-4000-8000-00000000abcd", "nope", demoBooking]) {
      const r = await api.booking(REAL, id, { action: "cancel", revision: 0 }, open());
      expect(r.status).toBe(404);
      expect(r.json).toEqual({ error: "booking_not_found" });
    }
    expect((await bookingRow(t, demoBooking)).status).toBe("confirmed");
    for (const bad of [{ action: "cancel" }, { action: "move", revision: 0 }, { action: "confirm", revision: -1 }, { action: "cancel", revision: 0, x: 1 }, { action: "move", revision: 0, start: "2026-11-12T17:00:00" }]) {
      expect((await api.booking(REAL, b1, bad, open())).status).toBe(400);
    }
  });
});

describe("moving a booking", () => {
  const move = (start: string, revision = 0, id = b1) => api.booking(REAL, id, { action: "move", revision, start }, open());

  it("accepts a slot the rules accept: new time on the same chair, confirmation dropped, recorded", async () => {
    const r = await move(THU_17);
    expect(r.status).toBe(200);
    const booking = (r.json as unknown as { booking: AgendaItem }).booking;
    expect(booking).toMatchObject({ start: THU_17, resourceId: "chair-1", status: "booked", revision: 1 });
    expect(booking.lastOwnerAction).toMatchObject({ action: "move", label: "Lola" });
    const row = await bookingRow(t, b1);
    expect(row.startsAt.toISOString()).toBe("2026-11-12T16:00:00.000Z");
    expect((await auditRows(t)).map((a) => a.action)).toEqual(["move"]);
  });

  it("takes an ISO instant with an offset", async () => {
    expect((await move("2026-11-12T17:00:00+01:00")).status).toBe(200);
    expect((await bookingRow(t, b1)).startsAt.toISOString()).toBe("2026-11-12T16:00:00.000Z");
  });

  it("takes the other chair when its own is busy, and a confirmed booking comes back unconfirmed", async () => {
    await api.booking(REAL, b1, { action: "confirm", revision: 0 }, open());
    await addBooking(t, REAL, { start: THU_17, resourceId: "chair-1" });
    const r = await move(THU_17, 1);
    expect(r.status).toBe(200);
    expect((r.json as unknown as { booking: AgendaItem }).booking).toMatchObject({ resourceId: "chair-2", status: "booked" });
  });

  it("rejects what the Booking_Rules reject, with the day's fresh slots, and writes nothing", async () => {
    const r = await move("2026-11-12T14:00:00Z"); // 15:00 Madrid: between sessions
    expect(r.status).toBe(409);
    const body = r.json as unknown as { error: string; reason: string; slots: SlotDto[] };
    expect(body).toMatchObject({ error: "rejected", reason: "outside_hours" });
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots.map((s) => s.start)).toContain(THU_17);
    for (const s of body.slots) expect(["chair-1", "chair-2"]).toContain(s.resourceId);
    expect((await bookingRow(t, b1)).startsAt.toISOString()).toBe("2026-11-12T09:00:00.000Z");
    expect(await auditRows(t)).toEqual([]);

    expect((await move("2026-11-15T10:00:00Z")).json).toMatchObject({ error: "rejected", reason: "closed_day", slots: [] }); // Sunday
  });

  it("rejects a day outside today … today + 13 with no slots", async () => {
    for (const start of ["2026-11-09T09:00:00Z", "2026-11-24T09:00:00Z"]) {
      const r = await move(start);
      expect(r.status).toBe(409);
      expect(r.json).toEqual({ error: "rejected", reason: "outside_move_window", slots: [] });
    }
    expect((await move("2026-11-23T11:00:00Z")).json).toMatchObject({ reason: "closed_day" }); // the 14th day is allowed, and closed on a Monday
  });

  it("answers taken, with fresh slots, when the time was taken between listing and saving, and writes nothing", async () => {
    await addBooking(t, REAL, { start: THU_17, resourceId: "chair-1" });
    await addBooking(t, REAL, { start: THU_17, resourceId: "chair-2" });
    // The first read sees an agenda from before those two bookings, as a request that raced with them would.
    let first = true;
    const racing = createMachineEnv(t, {
      core: { listBookings: (...a) => (first ? ((first = false), Promise.resolve([])) : t.repo.listBookings(...a)) },
    });
    const c = client(racing.handlers, api.seen);
    const r = await c.booking(REAL, b1, { action: "move", revision: 0, start: THU_17 }, open());
    expect(r.status).toBe(409);
    const body = r.json as unknown as { error: string; slots: SlotDto[] };
    expect(body.error).toBe("taken");
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots.map((s) => s.start)).not.toContain(THU_17);
    expect((await bookingRow(t, b1)).startsAt.toISOString()).toBe("2026-11-12T09:00:00.000Z");
    expect(await auditRows(t)).toEqual([]);
  });

  it("two Owners moving two bookings to the same last slot: one wins, the other gets taken or rejected", async () => {
    await addBooking(t, REAL, { start: THU_17, resourceId: "chair-2" });
    const b2 = await addBooking(t, REAL, { start: "2026-11-12T10:00:00Z", resourceId: "chair-2" });
    const [a, b] = await Promise.all([move(THU_17, 0, b1), move(THU_17, 0, b2)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const active = await t.handle.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.shopId, REAL), eq(bookings.startsAt, new Date(THU_17)), eq(bookings.status, "confirmed")));
    expect(active.length).toBe(2); // chair-2's own booking plus exactly one mover
  });
});

describe("the Move_Slots route", () => {
  it("lists the day's slots, the booking's own current slot included, from the caller's Booking_Rules", async () => {
    const r = await api.slots(REAL, b1, "2026-11-12", open());
    expect(r.status).toBe(200);
    const slots = (r.json as unknown as { slots: SlotDto[] }).slots;
    expect(slots[0]).toEqual({ start: THU_10, resourceId: "chair-1" }); // its own chair first
    expect(slots.map((s) => s.start)).toContain(THU_17);
    const starts = slots.map((s) => s.start);
    expect([...starts].sort()).toEqual(starts);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("does not offer a time both chairs are busy", async () => {
    await addBooking(t, REAL, { start: THU_17, resourceId: "chair-1" });
    await addBooking(t, REAL, { start: THU_17, resourceId: "chair-2" });
    const slots = ((await api.slots(REAL, b1, "2026-11-12", open())).json as unknown as { slots: SlotDto[] }).slots;
    expect(slots.map((s) => s.start)).not.toContain(THU_17);
    expect(slots.map((s) => s.start)).toContain("2026-11-12T16:30:00Z");
  });

  it("lists nothing for a closed day, and refuses a date outside today … today + 13", async () => {
    expect((await api.slots(REAL, b1, "2026-11-15", open())).json).toEqual({ slots: [] });
    for (const date of ["2026-11-09", "2026-11-24", "2027-01-01"]) {
      const r = await api.slots(REAL, b1, date, open());
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ error: "invalid_request" });
    }
    for (const date of ["2026-02-30", "mañana", "2026-11-1"]) expect((await api.slots(REAL, b1, date, open())).status).toBe(400);
  });

  it("is 409 for a booking that allows no move, and 404 for an unknown or other shop's booking", async () => {
    await api.booking(REAL, b1, { action: "cancel", revision: 0 }, open());
    expect((await api.slots(REAL, b1, "2026-11-12", open())).json).toEqual({ error: "not_allowed" });
    for (const id of ["00000000-0000-4000-8000-00000000abcd", "nope", demoBooking]) {
      expect((await api.slots(REAL, id, "2026-11-12", open())).status).toBe(404);
    }
  });
});

describe("every route needs a session", () => {
  it("answers an empty 401 without a valid cookie, for every route, and changes nothing", async () => {
    const before = await versionOf(t, REAL);
    const none = {};
    const answers = [
      await api.poll(REAL, null, none),
      await api.message(REAL, m1, { action: "erase" }, none),
      await api.booking(REAL, b1, { action: "cancel", revision: 0 }, none),
      await api.slots(REAL, b1, "2026-11-12", none),
    ];
    for (const a of answers) {
      expect(a.status).toBe(401);
      expect(a.text).toBe("");
    }
    expect(await versionOf(t, REAL)).toBe(before);
    expect(await auditRows(t)).toEqual([]);
  });
});

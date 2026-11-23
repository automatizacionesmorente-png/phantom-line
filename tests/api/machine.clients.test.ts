import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { ClientsResponse } from "@/lib/clients/api";
import { clients } from "@/lib/db/schema";
import { addBooking, addCall, auditRows } from "../db/ownerFixtures";
import { createTestDb, type TestDb } from "../db/pglite";
import { DEMO, REAL, client, createMachineEnv, seedShops, tokenFor, type MachineEnv } from "./machineHarness";

/**
 * BACKLOG 14, 15: the customer book through real `Request` objects on PGlite. The session is
 * required on both routes, a client id of another shop is a 404 that changes nothing, bodies
 * are validated, and the lapsed list carries the real-slot WhatsApp text.
 * Clock: Tuesday 10 November 2026, 09:00 in Madrid.
 */
const PHONE = "+34612345678";
const OTHER = { name: "Zacarías Otro", phone: "+34699000111", note: "Nota secreta de otra tienda" };

let t: TestDb;
let env: MachineEnv;
let api: ReturnType<typeof client>;
let token: string;
let mine: string;
let theirs: string;
let pastBooking: string;
let futureBooking: string;

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

  // A client who came twice, a month apart, the last time 70 days ago, and has a no-show candidate.
  await addCall(t, REAL);
  await addBooking(t, REAL, { start: "2026-08-01T08:00:00Z", name: "Carlos Vega", phone: PHONE });
  pastBooking = await addBooking(t, REAL, { start: "2026-09-01T08:00:00Z", name: "Carlos Vega", phone: PHONE });
  futureBooking = await addBooking(t, REAL, { start: "2026-11-20T08:00:00Z", name: "Carlos Vega", phone: PHONE, status: "cancelled" });
  const [row] = await t.handle.db
    .insert(clients)
    .values({ shopId: REAL, phone: PHONE, name: "Carlos Vega", language: "es" })
    .returning({ id: clients.id });
  mine = row.id;
  const [other] = await t.handle.db
    .insert(clients)
    .values({ shopId: DEMO, phone: OTHER.phone, name: OTHER.name, note: OTHER.note })
    .returning({ id: clients.id });
  theirs = other.id;
  await addBooking(t, DEMO, { start: "2026-09-01T08:00:00Z", name: OTHER.name, phone: OTHER.phone });
});

const book = (a: { json: Record<string, unknown> | null }) => a.json as unknown as ClientsResponse;

describe("session required on every client route", () => {
  it("answers 401 locked, with no body, without a session, with another shop's session, or an expired one", async () => {
    const bad = [
      {},
      { token: tokenFor(DEMO) },
      { token: tokenFor(REAL, { exp: 1 }) },
      { token: "garbage" },
    ];
    for (const o of bad) {
      const get = await api.clients(REAL, o);
      expect(get.status).toBe(401);
      expect(get.text).toBe("");
      const post = await api.clientAction(REAL, mine, { action: "note", note: "x" }, o);
      expect(post.status).toBe(401);
      expect(post.text).toBe("");
    }
    expect((await t.handle.db.select().from(clients).where(eq(clients.id, mine)))[0].note).toBe("");
  });

  it("an unknown shop is 404, and a POST from another origin is 403 before anything is read", async () => {
    expect((await api.clients("no-such-shop", { token })).status).toBe(404);
    const cross = await api.clientAction(REAL, mine, { action: "note", note: "x" }, { token, origin: "https://evil.example" });
    expect(cross.status).toBe(403);
  });
});

describe("GET the customer book", () => {
  it("lists the shop's clients only, with visits, last visit, usual service and the lapsed list", async () => {
    const a = await api.clients(REAL, { token });
    expect(a.status).toBe(200);
    const b = book(a);
    expect(b.clients).toHaveLength(1);
    expect(b.clients[0]).toMatchObject({
      id: mine,
      name: "Carlos Vega",
      totalVisits: 2,
      noShows: 0,
      lastVisit: "2026-09-01T08:00:00Z",
      upcoming: null,
      intervalDays: 31,
      usualServices: [{ serviceId: "haircut", count: 2 }],
    });
    // 70 days since the last visit against a 31-day rhythm.
    expect(b.lapsed).toHaveLength(1);
    expect(b.lapsed[0]).toMatchObject({ clientId: mine, daysSince: 70, thresholdDays: 31, overdueDays: 39, language: "es" });
    expect(b.lapsed[0].whatsappUrl.startsWith("https://wa.me/34612345678?text=")).toBe(true);
    expect(decodeURIComponent(b.lapsed[0].whatsappUrl.split("?text=")[1])).toBe(b.lapsed[0].text);
    expect(b.lapsed[0].text).toContain("Hola Carlos");
    // Nothing of the other shop, in any form.
    expect(a.text).not.toContain(OTHER.name);
    expect(a.text).not.toContain(OTHER.phone);
    expect(a.text).not.toContain(OTHER.note);
  });

  it("the win-back text names only real free slots of this week", async () => {
    const b = book(await api.clients(REAL, { token }));
    const text = b.lapsed[0].text;
    expect(text).toContain("Esta semana tenemos hueco");
    // The shop is open at those times: the slots come from the Booking_Rules, never from the model.
    expect(text).toMatch(/(Miércoles|Jueves|Viernes|Sábado|Lunes|Martes) \d+ a las \d\d:\d\d/);
  });
});

describe("POST a client action", () => {
  it("saves the private note (trimmed) and returns the refreshed book", async () => {
    const a = await api.clientAction(REAL, mine, { action: "note", note: "  Prefiere el sillón 2  " }, { token });
    expect(a.status).toBe(200);
    expect(book(a).clients[0].note).toBe("Prefiere el sillón 2");
    expect((await t.handle.db.select().from(clients).where(eq(clients.id, mine)))[0].note).toBe("Prefiere el sillón 2");
  });

  it("another shop's client id is 404, reads nothing and changes nothing", async () => {
    const before = await t.handle.db.select().from(clients).where(eq(clients.id, theirs));
    const note = await api.clientAction(REAL, theirs, { action: "note", note: "hacked" }, { token });
    expect(note.status).toBe(404);
    expect(note.json).toEqual({ error: "client_not_found" });
    const noShow = await api.clientAction(REAL, theirs, { action: "no_show", bookingId: pastBooking, noShow: true }, { token });
    expect(noShow.status).toBe(404);
    expect(noShow.text).not.toContain(OTHER.name);
    expect(await t.handle.db.select().from(clients).where(eq(clients.id, theirs))).toEqual(before);
    expect(await auditRows(t)).toHaveLength(0);
    // And a made-up or malformed id.
    expect((await api.clientAction(REAL, "not-a-uuid", { action: "note", note: "x" }, { token })).status).toBe(404);
    expect((await api.clientAction(REAL, "00000000-0000-4000-8000-000000000999", { action: "note", note: "x" }, { token })).status).toBe(404);
  });

  it("validates the body: unknown action, extra keys, a note over 500 characters, a bad booking id, wrong types", async () => {
    const bad: unknown[] = [
      { action: "delete" },
      { action: "note" },
      { action: "note", note: "x", extra: 1 },
      { action: "note", note: "x".repeat(501) },
      { action: "note", note: 42 },
      { action: "note", note: "a\u0000b" },
      { action: "no_show", bookingId: "nope", noShow: true },
      { action: "no_show", bookingId: pastBooking, noShow: "yes" },
      {},
      [],
    ];
    for (const body of bad) {
      const a = await api.clientAction(REAL, mine, body, { token });
      expect(a.status, JSON.stringify(body)).toBe(400);
      expect(a.json?.error).toBe("invalid_request");
    }
    const type = await api.clientAction(REAL, mine, { action: "note", note: "x" }, { token, contentType: "text/plain" });
    expect(type.status).toBe(415);
    expect((await t.handle.db.select().from(clients).where(eq(clients.id, mine)))[0].note).toBe("");
  });

  it("accepts a note of exactly 500 characters", async () => {
    const a = await api.clientAction(REAL, mine, { action: "note", note: "ñ".repeat(500) }, { token });
    expect(a.status).toBe(200);
  });

  it('"No vino": marks a finished booking, audits it, counts it, and can be undone', async () => {
    const a = await api.clientAction(REAL, mine, { action: "no_show", bookingId: pastBooking, noShow: true }, { token });
    expect(a.status).toBe(200);
    expect(book(a).clients[0]).toMatchObject({ totalVisits: 1, noShows: 1 });
    const audit = await auditRows(t);
    expect(audit).toMatchObject([{ action: "no_show", shopId: REAL, bookingId: pastBooking }]);
    const undo = await api.clientAction(REAL, mine, { action: "no_show", bookingId: pastBooking, noShow: false }, { token });
    expect(book(undo).clients[0]).toMatchObject({ totalVisits: 2, noShows: 0 });
  });

  it('"No vino" refuses a cancelled booking (409) and a booking of someone else (404)', async () => {
    const cancelled = await api.clientAction(REAL, mine, { action: "no_show", bookingId: futureBooking, noShow: true }, { token });
    expect(cancelled.status).toBe(409);
    expect(cancelled.json).toEqual({ error: "not_allowed" });
    const strangers = await addBooking(t, REAL, { start: "2026-09-05T08:00:00Z", name: "Otra", phone: "+34600000077" });
    const other = await api.clientAction(REAL, mine, { action: "no_show", bookingId: strangers, noShow: true }, { token });
    expect(other.status).toBe(404);
  });

  it("a client with a future booking is not on the lapsed list", async () => {
    await addBooking(t, REAL, { start: "2026-11-18T08:00:00Z", name: "Carlos Vega", phone: PHONE, resourceId: "chair-2" });
    const b = book(await api.clients(REAL, { token }));
    expect(b.clients[0].upcoming).not.toBeNull();
    expect(b.lapsed).toEqual([]);
  });
});

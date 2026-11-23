import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { SESSION_COOKIE } from "@/lib/owner/session";
import { addBooking, addCall, addMessage } from "../db/ownerFixtures";
import { createTestDb, type TestDb } from "../db/pglite";
import { CLOCK0, DEMO, PIN, REAL, client, createMachineEnv, pinHash, seedShops, tokenFor, type ReqOptions } from "./machineHarness";

/**
 * Owner-machine task 10.8, property M17: nothing personal without a session.
 *
 * For every route, method, body and query, with no cookie or a malformed, expired, other-shop or
 * wrong-signature cookie, no response contains a seeded name, phone, reason, Transcript line or
 * booking time (14.1, 1.2, 1.8). The shop behind the routes holds generated personal data, so a
 * handler that read it before checking the session would show up.
 */

const ROUTES = [
  "login",
  "logout",
  "poll",
  "message",
  "booking",
  "slots",
  "createBooking",
  "blocks",
  "createBlock",
  "deleteBlock",
  "pay",
  "note",
  "getNote",
  "sale",
  "payments",
] as const;
const COOKIES = ["none", "malformed", "expired", "otherShop", "badSignature"] as const;
type Route = (typeof ROUTES)[number];
type CookieKind = (typeof COOKIES)[number];

const word = fc.stringMatching(/^[a-z]{8,12}$/);
const seededData = fc.record({
  first: word,
  last: word,
  phone: fc.stringMatching(/^[0-9]{8}$/),
  reason: word,
  line: word,
  quarter: fc.integer({ min: 0, max: 20 }),
});

const arbCase = fc.record({
  route: fc.constantFrom(...ROUTES),
  cookie: fc.constantFrom(...COOKIES),
  origin: fc.constantFrom("ok", "ok", "ok", "ok", "ok", "ok", "evil", "missing"),
  contentType: fc.constantFrom("json", "json", "json", "json", "json", "json", "json", "text"),
  shop: fc.constantFrom("real", "real", "real", "real", "real", "real", "real", "real", "real", "demo", "unknown"),
  ids: fc.constantFrom("real", "real", "real", "random", "junk"),
  validBody: fc.constantFrom(true, true, true, true, true, true, false),
  junk: fc.oneof(fc.jsonValue(), fc.string()),
  action: fc.constantFrom("play", "erase", "confirm", "cancel", "move"),
  revision: fc.integer({ min: 0, max: 3 }),
  since: fc.option(fc.integer({ min: 0, max: 500 }), { nil: null }),
  date: fc.constantFrom("2026-11-12", "2026-11-13", "2026-11-20", "2026-12-25", "not-a-date"),
  pin: fc.stringMatching(/^[0-9]{6}$/),
  malformed: fc.oneof(fc.stringMatching(/^[A-Za-z0-9_.-]{0,80}$/), fc.constantFrom("v1.a.b", "v1..", "v2.x.y", "garbage")),
  ip: fc.stringMatching(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/),
});

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  await pinHash();
}, 120_000);
afterAll(async () => {
  await t.close();
});

function cookieOptions(kind: CookieKind, malformed: string, shopId: string): ReqOptions {
  switch (kind) {
    case "none":
      return {};
    case "malformed":
      return { cookie: `${SESSION_COOKIE}=${malformed}` };
    case "expired":
      return { token: tokenFor(REAL, {}, undefined, CLOCK0.subtract({ hours: 13 })) };
    case "otherShop":
      // A valid session of a shop other than the one addressed. A DEMO token sent to the
      // Demo_Shop would be a real session, not "other shop" (found by M17, seed 267098037).
      return { token: tokenFor(shopId === DEMO ? REAL : DEMO) };
    case "badSignature":
      return { token: tokenFor(REAL, {}, "another-secret-of-at-least-32-characters") };
  }
}

describe("M17. Nothing personal without a session", () => {
  it("no response of any route, without a valid cookie, contains seeded personal data (numRuns 100)", async () => {
    const reached = { statuses: new Map<number, number>(), cookies: new Set<CookieKind>(), routes: new Set<Route>() };

    await fc.assert(
      fc.asyncProperty(seededData, arbCase, async (data, c) => {
        await t.reset();
        await seedShops(t);
        const name = `Zq${data.first} Zq${data.last}`;
        const phone = `+346${data.phone}`;
        const reason = `Motivo zq${data.reason}`;
        const line = `Linea zq${data.line}`;
        const start = new Date(Date.parse("2026-11-12T08:00:00Z") + data.quarter * 15 * 60_000);
        const call = await addCall(t, REAL, { transcript: [{ caller: line, receptionist: "Vale" }] });
        const booking = await addBooking(t, REAL, { start: start.toISOString(), name, phone, callId: call });
        const message = await addMessage(t, REAL, call, { name, phone, reason, bookingId: booking });
        const seeded = [`Zq${data.first}`, `Zq${data.last}`, phone, `zq${data.reason}`, `zq${data.line}`, start.toISOString().slice(0, 16)];

        const env = createMachineEnv(t);
        const api = client(env.handlers);
        const shopId = c.shop === "real" ? REAL : c.shop === "demo" ? DEMO : "no-existe";
        const pick = (real: string) => (c.ids === "real" ? real : c.ids === "random" ? "00000000-0000-4000-8000-0000000000ff" : "x%20y");
        const opts: ReqOptions = {
          ...cookieOptions(c.cookie, c.malformed, shopId),
          origin: c.origin === "ok" ? undefined : c.origin === "evil" ? "https://evil.example" : null,
          contentType: c.contentType === "json" ? undefined : "text/plain",
          ip: c.ip,
        };
        const json = (valid: unknown) => (c.validBody ? valid : c.junk);

        let answer;
        switch (c.route) {
          case "login":
            answer = await api.login(shopId, json({ pin: c.pin }), opts);
            break;
          case "logout":
            answer = await api.logout(shopId, opts);
            break;
          case "poll":
            answer = await api.poll(shopId, c.since, opts);
            break;
          case "message":
            answer = await api.message(shopId, pick(message), json({ action: c.action === "erase" ? "erase" : "play" }), opts);
            break;
          case "booking":
            answer = await api.booking(
              shopId,
              pick(booking),
              json(
                c.action === "move"
                  ? { action: "move", revision: c.revision, start: "2026-11-12T16:00:00Z" }
                  : { action: c.action === "cancel" ? "cancel" : "confirm", revision: c.revision },
              ),
              opts,
            );
            break;
          case "slots":
            answer = await api.slots(shopId, pick(booking), c.date, opts);
            break;
          case "createBooking":
            answer = await api.createBooking(
              shopId,
              json({ resourceId: "chair-1", serviceId: "haircut", start: start.toISOString(), name, phone }),
              opts,
            );
            break;
          case "blocks":
            answer = await api.blocks(shopId, { ...opts, query: "?from=2026-11-01T00:00:00Z&to=2026-12-31T00:00:00Z" });
            break;
          case "createBlock":
            answer = await api.createBlock(
              shopId,
              json({ resourceId: null, start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), reason: reason }),
              opts,
            );
            break;
          case "deleteBlock":
            answer = await api.deleteBlock(shopId, pick(booking), opts);
            break;
          case "pay":
            answer = await api.pay(shopId, pick(booking), json({ amountCents: 1500, method: "cash" }), opts);
            break;
          case "note":
            answer = await api.note(shopId, pick(booking), json({ note: line }), opts);
            break;
          case "getNote":
            answer = await api.getNote(shopId, pick(booking), opts);
            break;
          case "sale":
            answer = await api.sale(shopId, json({ amountCents: 900, method: "card", productLabel: reason }), opts);
            break;
          case "payments":
            answer = await api.payments(shopId, c.date, opts);
            break;
        }

        for (const s of seeded) expect(answer.text).not.toContain(s);
        for (const [k, v] of answer.headers) if (k !== "set-cookie") for (const s of seeded) expect(v).not.toContain(s);
        // A request without a session is never answered with data. Login may succeed only by guessing the PIN.
        if (c.route !== "login" && c.route !== "logout") expect(answer.status).not.toBe(200);
        if (c.route === "login" && c.pin !== PIN) expect(answer.status).not.toBe(204);

        reached.statuses.set(answer.status, (reached.statuses.get(answer.status) ?? 0) + 1);
        if (answer.status === 401 && c.route !== "login") {
          reached.cookies.add(c.cookie);
          reached.routes.add(c.route);
        }
      }),
      { numRuns: 100 },
    );

    // The property is only worth something if it got as far as the session check on every route
    // and with every kind of bad cookie, and also met the checks that come before it.
    expect([...reached.cookies].sort()).toEqual([...COOKIES].sort());
    expect([...reached.routes].sort()).toEqual(
      ["blocks", "booking", "createBlock", "createBooking", "deleteBlock", "getNote", "message", "note", "pay", "payments", "poll", "sale", "slots"].sort(),
    );
    for (const status of [400, 401, 403, 404]) expect(reached.statuses.get(status) ?? 0).toBeGreaterThan(0);
  }, 300_000);

  it("the same requests with a valid session do return the data, so the property has teeth", async () => {
    await t.reset();
    await seedShops(t);
    const call = await addCall(t, REAL, { transcript: [{ caller: "Linea zqabc", receptionist: "Vale" }] });
    const booking = await addBooking(t, REAL, { start: "2026-11-12T09:00:00Z", name: "Zqana Zqperez", phone: "+34612345678", callId: call });
    await addMessage(t, REAL, call, { name: "Zqana Zqperez", phone: "+34612345678", reason: "Motivo zqabc", bookingId: booking });
    const api = client(createMachineEnv(t).handlers);
    const poll = await api.poll(REAL, null, { token: tokenFor(REAL) });
    expect(poll.status).toBe(200);
    for (const s of ["Zqana Zqperez", "+34612345678", "Motivo zqabc", "2026-11-12T09:00"]) expect(poll.text).toContain(s);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { insertShop } from "../db/helpers";
import { addBooking, addCall, addMessage, ownerRepoOf, realProfile } from "../db/ownerFixtures";
import { createTestDb, type TestDb } from "../db/pglite";
import {
  CLOCK0,
  DEMO,
  PIN,
  REAL,
  SECRET,
  client,
  createMachineEnv,
  pinHash,
  seedShops,
  tokenFor,
  type MachineEnv,
} from "./machineHarness";
import { hashPin } from "@/lib/owner/pin";
import { SESSION_COOKIE } from "@/lib/owner/session";

/**
 * Owner-machine task 10.5: login, lock and session checks through real `Request` objects on PGlite
 * (Requirements 1.3–1.5, 1.7–1.10, 2.2, 2.3, 2.5, 14.4).
 */

let t: TestDb;
let env: MachineEnv;
let api: ReturnType<typeof client>;
/** Every `owner_auth` line written in this file, for the 14.4 check at the end. */
const authLines: string[] = [];

beforeAll(async () => {
  t = await createTestDb();
  await pinHash();
}, 120_000);
beforeEach(async () => {
  await t.reset();
  await seedShops(t);
  env = createMachineEnv(t);
  api = client(env.handlers);
});
afterAll(async () => {
  // 14.4: no log line holds a PIN, a token, a name, a phone, a reason or a Transcript line.
  expect(authLines.length).toBeGreaterThan(0);
  for (const line of authLines) {
    for (const secret of [PIN, "000000", "111111", "Rosalía", "+34611223344", SECRET, "203.0.113", "scrypt$", "Lola Admin"]) {
      expect(line).not.toContain(secret);
    }
    expect(JSON.parse(line).event).toBe("owner_auth");
  }
  await t.close();
});

const flush = () => {
  for (const e of env.logs) if (e.event === "owner_auth") authLines.push(JSON.stringify(e));
};
const ipOf = (n: number) => `198.51.100.${n}`;

describe("a right PIN", () => {
  it("answers 204 and sets the session cookie with HttpOnly, Secure, SameSite=Strict, Path=/ and 12 hours", async () => {
    const r = await api.login(DEMO, { pin: PIN, label: "  Lola   Admin " });
    expect(r.status).toBe(204);
    expect(r.text).toBe("");
    const cookie = r.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=v1\\.[\\w-]+\\.[\\w-]+;`));
    expect(cookie).toContain("Max-Age=43200");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toMatch(/Domain=/i); // the `__Host-` prefix forbids it
    flush();
  });

  it("opens the machine: the cookie it set works for the Poll, and the label became the Actor's name", async () => {
    const login = await api.login(REAL, { pin: PIN, label: "  Lola   Admin " });
    const token = (login.headers.get("set-cookie") ?? "").split(";")[0].slice(SESSION_COOKIE.length + 1);
    const poll = await api.poll(REAL, null, { token });
    expect(poll.status).toBe(200);
    expect(poll.json).toMatchObject({ changed: true });
    // The label is in the signed payload, collapsed and trimmed (2.5).
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    expect(payload).toMatchObject({ shopId: REAL, label: "Lola Admin", exp: payload.iat + 12 * 3600 });
  });

  it("a cookie for one shop never opens another", async () => {
    const login = await api.login(REAL, { pin: PIN });
    const token = (login.headers.get("set-cookie") ?? "").split(";")[0].slice(SESSION_COOKIE.length + 1);
    // A cookie for one shop never opens another (1.8).
    expect((await api.poll(DEMO, null, { token })).status).toBe(401);
  });
});

describe("a wrong PIN", () => {
  it("gets the same answer every time, whatever the PIN", async () => {
    const a = await api.login(REAL, { pin: "000000" });
    const b = await api.login(REAL, { pin: "111111" });
    const c = await api.login(DEMO, { pin: "000000" });
    for (const r of [a, b, c]) {
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ error: "wrong_pin" });
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    expect(b.text).toBe(a.text);
    flush();
  });

  it("is logged with window counts and nothing else (14.4)", async () => {
    await api.login(REAL, { pin: "000000" }, { ip: ipOf(1) });
    await api.login(REAL, { pin: "111111" }, { ip: ipOf(1) });
    expect(env.logs).toEqual([
      { event: "owner_auth", outcome: "wrong_pin", shopId: REAL, counts: { visitor: 1, shop: 1 } },
      { event: "owner_auth", outcome: "wrong_pin", shopId: REAL, counts: { visitor: 2, shop: 2 } },
    ]);
    flush();
  });
});

describe("PIN attempt limits", () => {
  it("blocks the 6th try in 15 minutes with 429, even with the right PIN, and does not check the PIN", async () => {
    for (let k = 0; k < 5; k++) expect((await api.login(REAL, { pin: "000000" })).status).toBe(401);
    const sixth = await api.login(REAL, { pin: PIN });
    expect(sixth.status).toBe(429);
    expect(sixth.json).toEqual({ error: "too_many_tries" });
    expect(sixth.headers.get("set-cookie")).toBeNull();
    const line = env.logs.at(-1);
    expect(line).toEqual({
      event: "owner_auth",
      outcome: "rate_limited",
      shopId: REAL,
      limit: "visitor",
      counts: { visitor: 6, shop: 6 },
    });
    flush();
  });

  it("lets the same Visitor try again in the next 15-minute window, and a different Visitor at once", async () => {
    for (let k = 0; k < 6; k++) await api.login(REAL, { pin: "000000" }, { ip: ipOf(2) });
    expect((await api.login(REAL, { pin: PIN }, { ip: ipOf(2) })).status).toBe(429);
    expect((await api.login(REAL, { pin: PIN }, { ip: ipOf(3) })).status).toBe(204);
    env.setNow(CLOCK0.add({ minutes: 15 }));
    expect((await api.login(REAL, { pin: PIN }, { ip: ipOf(2) })).status).toBe(204);
    flush();
  });

  it("caps a Real_Shop at 30 tries an hour across Visitors: the 31st from 31 Visitors is 429", async () => {
    const answers = [];
    for (let k = 1; k <= 31; k++) answers.push(await api.login(REAL, { pin: "000000" }, { ip: ipOf(k) }));
    expect(answers.slice(0, 30).map((a) => a.status)).toEqual(Array(30).fill(401));
    expect(answers[30].status).toBe(429);
    // A right PIN from a new Visitor is blocked too: the shop-wide cap counts first-time Visitors as well.
    expect((await api.login(REAL, { pin: PIN }, { ip: ipOf(40) })).status).toBe(429);
    expect(env.logs.at(-1)).toMatchObject({ outcome: "rate_limited", limit: "shop" });
    flush();
  });

  it("does not cap the Demo_Shop per shop: 31 Visitors are all answered (2.3)", async () => {
    const statuses = [];
    for (let k = 1; k <= 31; k++) statuses.push((await api.login(DEMO, { pin: "000000" }, { ip: ipOf(k) })).status);
    expect(statuses).toEqual(Array(31).fill(401));
    // …and a Visitor with the right PIN still gets in, which a shop-wide cap would have denied.
    expect((await api.login(DEMO, { pin: PIN }, { ip: ipOf(99) })).status).toBe(204);
    // The per-Visitor cap still holds for the Demo_Shop.
    for (let k = 0; k < 5; k++) await api.login(DEMO, { pin: "000000" }, { ip: ipOf(50) });
    expect((await api.login(DEMO, { pin: PIN }, { ip: ipOf(50) })).status).toBe(429);
    flush();
  });

  it("counts a shop's tries apart from another shop's", async () => {
    for (let k = 0; k < 5; k++) await api.login(REAL, { pin: "000000" });
    expect((await api.login(DEMO, { pin: PIN })).status).toBe(204);
    flush();
  });

  it("reads the caps from the dependencies (PIN_LIMIT_… variables)", async () => {
    const tight = createMachineEnv(t, { pinLimits: { perVisitorPer15Min: 1, perShopPerHour: 30 } });
    const a = client(tight.handlers);
    expect((await a.login(REAL, { pin: "000000" })).status).toBe(401);
    expect((await a.login(REAL, { pin: PIN })).status).toBe(429);
  });
});

describe("the request checks", () => {
  it("refuses a wrong Origin, and a missing one, with 403 before anything else happens", async () => {
    const evil = await api.login(REAL, { pin: PIN }, { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.json).toEqual({ error: "bad_origin" });
    expect((await api.login(REAL, { pin: PIN }, { origin: null })).status).toBe(403);
    // Same host on another port or scheme is another origin.
    expect((await api.login(REAL, { pin: PIN }, { origin: "http://localhost:4000" })).status).toBe(403);
    expect((await api.login(REAL, { pin: PIN }, { origin: "https://localhost" })).status).toBe(403);
    expect((await api.logout(REAL, { origin: "https://evil.example" })).status).toBe(403);
    expect(env.logs).toEqual([]); // no attempt was counted or checked
    const counted = await t.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM rate_limits");
    expect(counted.rows[0].n).toBe(0);
  });

  it("answers 415 for a body that is not JSON by its content type, and 400 for invalid or extra fields", async () => {
    expect((await api.login(REAL, { pin: PIN }, { contentType: "text/plain" })).status).toBe(415);
    expect((await api.login(REAL, { pin: PIN }, { contentType: "application/json; charset=utf-8" })).status).toBe(204);
    for (const bad of [{ pin: "12345" }, { pin: "abcdef" }, { pin: PIN, extra: 1 }, { pin: PIN, label: "x".repeat(31) }, {}, "not json {"]) {
      const r = await api.login(REAL, bad);
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ error: "invalid_request" });
    }
    // Invalid requests are not PIN attempts.
    expect(env.logs).toEqual([]);
  });

  it("answers 404 for an unknown shop, with no PIN form to probe", async () => {
    const r = await api.login("no-existe", { pin: PIN });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "shop_not_found" });
    expect((await api.login("%E0%A4%A", { pin: PIN })).status).toBe(404); // malformed escape
  });

  it("answers 409 no_pin when the shop has no PIN, and does not count the try", async () => {
    await insertShop(t, { ...realProfile, id: "sin-pin", name: "Taller Sin PIN" });
    const r = await api.login("sin-pin", { pin: PIN });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "no_pin" });
    expect(env.logs).toEqual([{ event: "owner_auth", outcome: "no_pin", shopId: "sin-pin" }]);
    flush();
  });

  it("answers 503 machine_not_configured when OWNER_SESSION_SECRET is missing or too short, and every session is then invalid", async () => {
    env.setSecret(undefined);
    const missing = await api.login(REAL, { pin: PIN });
    expect(missing.status).toBe(503);
    expect(missing.json).toEqual({ error: "machine_not_configured" });
    env.setSecret("too-short");
    expect((await api.login(REAL, { pin: PIN })).status).toBe(503);
    expect(env.logs.map((e) => e.event === "owner_auth" && e.outcome)).toEqual(["misconfigured", "misconfigured"]);
    // A token signed before the variable went missing does not open the machine.
    env.setSecret(undefined);
    expect((await api.poll(REAL, null, { token: tokenFor(REAL) })).status).toBe(401);
    flush();
  });

  it("keeps the PIN, its hash and the token out of every response body", async () => {
    await api.login(REAL, { pin: "000000" });
    await api.login(REAL, { pin: PIN });
    await api.login(REAL, { pin: "bad" });
    for (const body of api.seen) {
      expect(body).not.toContain(PIN);
      expect(body).not.toContain("scrypt$");
      expect(body).not.toContain("v1.");
    }
  });
});

describe("locking and expiry", () => {
  it("DELETE on the session clears the cookie, and the next Poll without it is 401 (1.9)", async () => {
    const token = tokenFor(REAL);
    expect((await api.poll(REAL, null, { token })).status).toBe(200);
    const out = await api.logout(REAL, { token });
    expect(out.status).toBe(204);
    const cleared = out.headers.get("set-cookie") ?? "";
    expect(cleared).toContain(`${SESSION_COOKIE}=;`);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Path=/");
    expect(cleared).toContain("Secure");
    // The browser drops the cookie, so the next Poll carries none.
    const next = await api.poll(REAL, null);
    expect(next.status).toBe(401);
    expect(next.text).toBe("");
  });

  it("a session ends after 12 hours, and a PIN change ends every session of that shop (1.8)", async () => {
    const token = tokenFor(REAL);
    env.setNow(CLOCK0.add({ hours: 12 }).subtract({ seconds: 1 }));
    expect((await api.poll(REAL, null, { token })).status).toBe(200);
    env.setNow(CLOCK0.add({ hours: 12 }));
    expect((await api.poll(REAL, null, { token })).status).toBe(401);

    env.setNow(CLOCK0);
    await ownerRepoOf(t).setOwnerPin(REAL, await hashPin("135790"), Temporal.Instant.from("2026-11-09T10:00:00Z"));
    expect((await api.poll(REAL, null, { token })).status).toBe(401);
    // The other shop's PIN did not change.
    expect((await api.poll(DEMO, null, { token: tokenFor(DEMO) })).status).toBe(200);
  });

  it("a Poll for an unknown shop is 404 and for a known shop without a session is an empty 401", async () => {
    expect((await api.poll("no-existe", null, { token: tokenFor("no-existe") })).status).toBe(404);
    const r = await api.poll(REAL, null);
    expect(r.status).toBe(401);
    expect(r.text).toBe("");
  });

  it("does not read personal data before the session is checked (14.1)", async () => {
    const call = await addCall(t, REAL, { transcript: [{ caller: "Me llamo Rosalía", receptionist: "Hola" }] });
    await addMessage(t, REAL, call, { name: "Rosalía Fernández", phone: "+34611223344" });
    await addBooking(t, REAL, { start: "2026-11-12T09:00:00Z", name: "Rosalía Fernández", phone: "+34611223344", callId: call });
    const reads: string[] = [];
    const base = ownerRepoOf(t);
    const watched = createMachineEnv(t, {
      repo: {
        ...base,
        listTape: (...a) => (reads.push("listTape"), base.listTape(...a)),
        listAgenda: (...a) => (reads.push("listAgenda"), base.listAgenda(...a)),
        getTranscript: (...a) => (reads.push("getTranscript"), base.getTranscript(...a)),
        getBooking: (...a) => (reads.push("getBooking"), base.getBooking(...a)),
      },
    });
    const w = client(watched.handlers);
    for (const o of [{}, { cookie: "x=1" }, { cookie: `${SESSION_COOKIE}=garbage` }, { token: tokenFor(DEMO) }]) {
      const r = await w.poll(REAL, null, o);
      expect(r.status).toBe(401);
      expect(r.text).toBe("");
      expect((await w.message(REAL, "00000000-0000-4000-8000-000000000001", { action: "play" }, o)).status).toBe(401);
      expect((await w.slots(REAL, "00000000-0000-4000-8000-000000000001", "2026-11-12", o)).status).toBe(401);
    }
    expect(reads).toEqual([]);
  });
});

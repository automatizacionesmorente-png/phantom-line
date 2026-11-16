import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeMachineHandlers, readCookie } from "@/app/api/machine/handlers";
import { SESSION_COOKIE } from "@/lib/owner/session";
import { createTestDb, type TestDb } from "../db/pglite";
import { DEMO, PIN, REAL, client, createMachineEnv, seedShops, tokenFor, type MachineEnv } from "./machineHarness";

/**
 * Owner-machine task 10.3: what the handlers do when something is not a normal answer. A database
 * that is down is `503 unavailable` and one `owner_error` line with the error's summary only (14.4);
 * the dependencies are built on first use, so a missing DATABASE_URL never breaks `next build`.
 */

let t: TestDb;
let env: MachineEnv;
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
});

describe("a failure that is not a normal answer", () => {
  it("answers 503 unavailable and logs one owner_error with the route, the shop and the error summary", async () => {
    const broken = createMachineEnv(t, {
      repo: { ...env.deps.repo, pollHead: () => Promise.reject(new Error("connection refused")) },
    });
    const r = await client(broken.handlers).poll(REAL, null, { token: tokenFor(REAL) });
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ error: "unavailable" });
    expect(broken.logs).toHaveLength(1);
    expect(broken.logs[0]).toMatchObject({ event: "owner_error", route: "poll", shopId: REAL, error: { message: "connection refused" } });
    expect(JSON.stringify(broken.logs[0])).not.toContain(tokenFor(REAL));
  });

  it("builds its dependencies on first use: a throwing factory is a 503 on that request, not at import", async () => {
    const logged: string[] = [];
    const spy = console.error;
    console.error = (line: unknown) => logged.push(String(line));
    try {
      const handlers = makeMachineHandlers({
        owner: () => {
          throw new Error("DATABASE_URL is not set");
        },
        salt: () => "s",
      });
      const r = await client(handlers).login(REAL, { pin: PIN });
      expect(r.status).toBe(503);
      expect(r.json).toEqual({ error: "unavailable" });
    } finally {
      console.error = spy;
    }
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0])).toMatchObject({ event: "owner_error", route: "session", shopId: REAL });
  });

  it("a failing login step never reveals whether the PIN was right", async () => {
    const broken = createMachineEnv(t, {
      repo: { ...env.deps.repo, hitCounters: () => Promise.reject(new Error("db down")) },
    });
    const r = await client(broken.handlers).login(REAL, { pin: PIN });
    expect(r.status).toBe(503);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});

describe("the request checks", () => {
  it("rejects a body larger than 4 KB and one that is not JSON", async () => {
    const api = client(env.handlers);
    expect((await api.login(REAL, { pin: PIN, label: "x".repeat(5000) })).status).toBe(400);
    expect((await api.login(REAL, "{ not json")).status).toBe(400);
    expect((await api.login(REAL, "")).status).toBe(400);
  });

  it("an unknown query key on the Poll or the slots route is a 400", async () => {
    const h = env.handlers;
    const res = await h.poll(new Request("http://localhost/api/machine/x?since=1&extra=1"), { shopId: REAL });
    expect(res.status).toBe(400);
    expect((await h.poll(new Request("http://localhost/api/machine/x?since=-1"), { shopId: REAL })).status).toBe(400);
    expect((await h.poll(new Request("http://localhost/api/machine/x?since=abc"), { shopId: REAL })).status).toBe(400);
  });

  it("reads the session cookie among others, and nothing else", () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=tok.en.x; b=2`, SESSION_COOKIE)).toBe("tok.en.x");
    expect(readCookie(`x${SESSION_COOKIE}=nope`, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(null, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie("", SESSION_COOKIE)).toBeUndefined();
  });

  it("the Poll of a shop with a valid session is 200 for the Demo_Shop too", async () => {
    expect((await client(env.handlers).poll(DEMO, null, { token: tokenFor(DEMO) })).status).toBe(200);
  });
});

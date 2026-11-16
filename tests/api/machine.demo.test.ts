import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeCronHandler } from "@/app/api/cron/demo-retention/handler";
import { bookings, calls, messages } from "@/lib/db/schema";
import { addBooking, addCall, addMessage } from "../db/ownerFixtures";
import { createTestDb, type TestDb } from "../db/pglite";
import { CLOCK0, DEMO, PIN, REAL, client, createMachineEnv, seedShops, tokenFor, type MachineEnv } from "./machineHarness";

/**
 * Owner-machine task 10.7: when Demo_Retention runs (16.6, 16.8). A demo login with old data runs
 * it before the 204; a Poll a minute later does not run it again; a Real_Shop never calls it; the
 * cron route needs `Authorization: Bearer ${CRON_SECRET}`.
 */

const NAME = "Rosalía Fernández";
const PHONE = "+34611223344";

let t: TestDb;
let env: MachineEnv;
let api: ReturnType<typeof client>;
let oldCall: string;

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
  // Ten days old: past both the 24-hour erase and the 7-day delete.
  oldCall = await addCall(t, DEMO, {
    startedAt: CLOCK0.subtract({ hours: 240 }),
    transcript: [{ caller: "Quiero mechas", receptionist: "Vale" }],
  });
  const oldBooking = await addBooking(t, DEMO, { start: CLOCK0.subtract({ hours: 239 }), callId: oldCall, name: NAME, phone: PHONE });
  await addMessage(t, DEMO, oldCall, { createdAt: CLOCK0.subtract({ hours: 240 }), bookingId: oldBooking, name: NAME, phone: PHONE });
  // The same data in a Real_Shop must never be touched.
  const realCall = await addCall(t, REAL, { startedAt: CLOCK0.subtract({ hours: 240 }) });
  await addMessage(t, REAL, realCall, { createdAt: CLOCK0.subtract({ hours: 240 }) });
});

const count = async (table: typeof calls | typeof messages | typeof bookings, shopId: string) =>
  (await t.handle.db.select().from(table).where(eq(table.shopId, shopId))).length;
const sampleCount = async () =>
  (await t.handle.db.select().from(messages).where(eq(messages.shopId, DEMO))).filter((m) => m.sampleKey !== null && m.erasedAt === null).length;
/** The ten-day-old Call: the Sample_Messages bring Calls of their own, so the shop's total is not the measure. */
const oldCallRows = async () => (await t.handle.db.select().from(calls).where(eq(calls.id, oldCall))).length;

describe("login", () => {
  it("a demo login with 10-day-old data runs retention before the 204 is answered", async () => {
    expect(await oldCallRows()).toBe(1);
    const r = await api.login(DEMO, { pin: PIN });
    expect(r.status).toBe(204);
    // Already done when the answer arrives: the old Call, its Message and Booking are gone, and the Tape is refilled.
    expect(await oldCallRows()).toBe(0);
    expect(await count(bookings, DEMO)).toBe(0);
    expect(await sampleCount()).toBe(3);
    expect(env.spy).toEqual({ claims: 1, cutoffs: 1 });
    expect(env.logs.filter((e) => e.event === "demo_retention")).toMatchObject([
      { step: "samples", outcome: "ok", counts: { deletedCalls: 1, deletedBookings: 1, samplesAdded: 3 } },
    ]);
    expect(JSON.stringify(env.logs)).not.toContain(NAME);
    expect(JSON.stringify(env.logs)).not.toContain(PHONE);
  });

  it("a Real_Shop's data is never touched, and its login and Poll never call retention", async () => {
    expect((await api.login(REAL, { pin: PIN })).status).toBe(204);
    expect((await api.poll(REAL, null, { token: tokenFor(REAL) })).status).toBe(200);
    env.setNow(CLOCK0.add({ hours: 1 }));
    expect((await api.poll(REAL, null, { token: tokenFor(REAL, {}, undefined, CLOCK0.add({ hours: 1 })) })).status).toBe(200);
    expect(env.spy).toEqual({ claims: 0, cutoffs: 0 });
    expect(await count(calls, REAL)).toBe(1);
    expect(await count(messages, REAL)).toBe(1);
  });

  it("never runs without a right PIN or a valid session: no write can be triggered from the PIN gate", async () => {
    expect((await api.login(DEMO, { pin: "000000" })).status).toBe(401);
    expect((await api.poll(DEMO, null)).status).toBe(401);
    expect((await api.poll(DEMO, null, { token: tokenFor(REAL) })).status).toBe(401);
    expect((await api.message(DEMO, "00000000-0000-4000-8000-000000000001", { action: "play" })).status).toBe(401);
    expect(env.spy).toEqual({ claims: 0, cutoffs: 0 });
    expect(await oldCallRows()).toBe(1);
  });

  it("a failing retention step does not fail the login (16.7)", async () => {
    const broken = createMachineEnv(t, {
      repo: {
        ...env.deps.repo,
        applyDemoCutoffs: () => Promise.reject(new Error("boom")),
      },
    });
    const r = await client(broken.handlers).login(DEMO, { pin: PIN });
    expect(r.status).toBe(204);
    expect(broken.logs.filter((e) => e.event === "demo_retention")).toMatchObject([{ step: "cutoffs", outcome: "failed" }]);
    expect(await oldCallRows()).toBe(1); // nothing changed
  });
});

describe("the Poll", () => {
  it("a Poll a minute after the run does not run it again, and one after 10 minutes does", async () => {
    await api.login(DEMO, { pin: PIN });
    expect(env.spy).toEqual({ claims: 1, cutoffs: 1 });

    const first = await api.poll(DEMO, null, { token: tokenFor(DEMO) });
    expect(first.status).toBe(200);
    expect(env.spy.cutoffs).toBe(1); // same instant: the claim refused

    env.setNow(CLOCK0.add({ minutes: 1 }));
    const minute = await api.poll(DEMO, null, { token: tokenFor(DEMO, {}, undefined, CLOCK0.add({ minutes: 1 })) });
    expect(minute.status).toBe(200);
    expect(env.spy).toEqual({ claims: 3, cutoffs: 1 }); // the claim was tried and refused: one conditional UPDATE

    env.setNow(CLOCK0.add({ minutes: 11 }));
    expect((await api.poll(DEMO, null, { token: tokenFor(DEMO, {}, undefined, CLOCK0.add({ minutes: 11 })) })).status).toBe(200);
    expect(env.spy.cutoffs).toBe(2);
  });

  it("a machine left open cleans up after itself: a Poll with old data in the demo shop erases it and shows the samples", async () => {
    const p = await api.poll(DEMO, null, { token: tokenFor(DEMO) });
    const body = p.json as unknown as { counts: { new: number }; tape: { sample: string | null }[] };
    expect(body.counts.new).toBe(3);
    expect(body.tape.map((m) => m.sample).sort()).toEqual(["booking", "question", "urgent"]);
    expect(await oldCallRows()).toBe(0);
  });
});

describe("the cron route (16.8)", () => {
  const SECRET = "cron-secret-for-tests";
  const handler = (secret: string | undefined) =>
    makeCronHandler({
      deps: () => ({ repo: env.deps.repo, clock: () => CLOCK0, newId: () => crypto.randomUUID(), log: (e) => env.logs.push(e) }),
      secret: () => secret,
    });
  const get = (h: ReturnType<typeof handler>, authorization?: string) =>
    h(new Request("http://localhost/api/cron/demo-retention", { headers: authorization === undefined ? {} : { authorization } }));

  it("answers 401 with no body, and runs nothing, without the secret, with a wrong one, or in another form", async () => {
    const h = handler(SECRET);
    for (const auth of [undefined, "", "Bearer", "Bearer ", "Bearer wrong", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, `bearer ${SECRET}`, `Basic ${SECRET}`, SECRET]) {
      const r = await get(h, auth);
      expect(r.status).toBe(401);
      expect(await r.text()).toBe("");
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    expect(env.spy).toEqual({ claims: 0, cutoffs: 0 });
    expect(await oldCallRows()).toBe(1);
  });

  it("answers 401 to every request when CRON_SECRET is not set, even to 'Bearer undefined' or an empty bearer", async () => {
    for (const secret of [undefined, ""]) {
      const h = handler(secret);
      for (const auth of [undefined, "Bearer ", "Bearer undefined", "Bearer null", `Bearer ${SECRET}`]) {
        expect((await get(h, auth)).status).toBe(401);
      }
    }
    expect(env.spy).toEqual({ claims: 0, cutoffs: 0 });
  });

  it("answers 204 with the right secret and runs Demo_Retention", async () => {
    const r = await get(handler(SECRET), `Bearer ${SECRET}`);
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
    expect(env.spy).toEqual({ claims: 1, cutoffs: 1 });
    expect(await oldCallRows()).toBe(0);
    expect(await sampleCount()).toBe(3);
    expect(await count(calls, REAL)).toBe(1); // a Real_Shop keeps everything (16.1)
  });

  it("answers 204 and writes nothing more when another request already holds the 10-minute claim", async () => {
    await get(handler(SECRET), `Bearer ${SECRET}`);
    const before = await count(messages, DEMO);
    expect((await get(handler(SECRET), `Bearer ${SECRET}`)).status).toBe(204);
    expect(env.spy.cutoffs).toBe(1);
    expect(await count(messages, DEMO)).toBe(before);
  });

  it("answers 503, empty, and logs one owner_error line when the dependencies cannot be built", async () => {
    const h = makeCronHandler({
      deps: () => {
        throw new Error("no database");
      },
      secret: () => SECRET,
    });
    const logs: string[] = [];
    const spy = console.error;
    console.error = (line: unknown) => logs.push(String(line));
    try {
      const r = await get(h, `Bearer ${SECRET}`);
      expect(r.status).toBe(503);
      expect(await r.text()).toBe("");
    } finally {
      console.error = spy;
    }
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toMatchObject({ event: "owner_error", route: "cron", shopId: DEMO });
    expect(logs[0]).not.toContain(SECRET);
  });
});

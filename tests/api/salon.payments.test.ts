import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { payments } from "@/lib/db/schema";
import { addBooking, auditRows, bookingRow, versionOf } from "../db/ownerFixtures";
import { createTestDb, type TestDb } from "../db/pglite";
import { DEMO, REAL, client, createMachineEnv, mreq, seedShops, tokenFor, type MachineEnv } from "./machineHarness";

/**
 * Salon task 5: the cash desk and the visit note through real `Request` objects on PGlite.
 * Clock: Tuesday 10 November 2026, 09:00 in Madrid (08:00 UTC).
 */
const PAST = "2026-11-10T07:00:00Z"; // ended at 07:30Z, before the clock
const SOON = "2026-11-10T18:00:00Z"; // 10 h ahead
const LATER = "2026-11-12T09:00:00Z"; // two days ahead

let t: TestDb;
let env: MachineEnv;
let api: ReturnType<typeof client>;
let token: string;

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
});

const open = () => ({ token });
const pay = (o: object = {}) => ({ amountCents: 1500, method: "cash", ...o });
type Item = { id: string; state: string; paidCents: number | null; visitNote: string; source: string };
const items = async (): Promise<Item[]> => {
  const poll = await api.poll(REAL, null, open());
  return (poll.json!.agenda as { items: Item[] }[]).flatMap((d) => d.items);
};
const rows = () => t.handle.db.select().from(payments);

describe("POST /bookings/[id]/pay", () => {
  it("pay marks done and appears in poll", async () => {
    const id = await addBooking(t, REAL, { start: PAST });
    expect((await items()).find((i) => i.id === id)).toMatchObject({ state: "to_collect", paidCents: null });
    const before = await versionOf(t, REAL);
    const r = await api.pay(REAL, id, pay({ amountCents: 1800, method: "bizum", productCents: 300, productLabel: "Champú" }), open());
    expect(r.status).toBe(201);
    expect(r.json!.booking).toMatchObject({ id, state: "done", paidCents: 1800 });

    const [p] = await rows();
    expect(p).toMatchObject({ shopId: REAL, bookingId: id, amountCents: 1800, productCents: 300, productLabel: "Champú", method: "bizum" });
    expect(p.paidAt.getTime()).toBe(env.now().epochMilliseconds);

    const audit = (await auditRows(t)).filter((a) => a.action === "pay");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ bookingId: id, shopId: REAL, actorLabel: "Lola", after: { paidCents: 1800, method: "bizum" } });

    // Another open machine notices: the version moved, and its poll says done.
    expect(await versionOf(t, REAL)).toBeGreaterThan(before);
    expect((await items()).find((i) => i.id === id)).toMatchObject({ state: "done", paidCents: 1800 });
  });

  it("a zero amount is a payment too (a free visit)", async () => {
    const id = await addBooking(t, REAL, { start: PAST });
    expect((await api.pay(REAL, id, pay({ amountCents: 0, method: "voucher" }), open())).status).toBe(201);
  });

  it("second payment is 409 already_paid", async () => {
    const id = await addBooking(t, REAL, { start: PAST });
    expect((await api.pay(REAL, id, pay(), open())).status).toBe(201);
    const again = await api.pay(REAL, id, pay({ amountCents: 999 }), open());
    expect([again.status, again.json]).toEqual([409, { error: "already_paid" }]);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0].amountCents).toBe(1500);
    expect((await auditRows(t)).filter((a) => a.action === "pay")).toHaveLength(1);
  });

  it("refuses a cancelled booking (409 cancelled)", async () => {
    const id = await addBooking(t, REAL, { start: PAST, status: "cancelled" });
    const r = await api.pay(REAL, id, pay(), open());
    expect([r.status, r.json]).toEqual([409, { error: "cancelled" }]);
    expect(await rows()).toHaveLength(0);
  });

  it("refuses a booking more than 12 h ahead (422 not_yet) and takes one inside 12 h", async () => {
    const far = await addBooking(t, REAL, { start: LATER });
    const r = await api.pay(REAL, far, pay(), open());
    expect([r.status, r.json]).toEqual([422, { error: "not_yet" }]);
    const edge = await addBooking(t, REAL, { start: env.now().add({ hours: 12 }).toString(), resourceId: "chair-2" });
    expect((await api.pay(REAL, edge, pay(), open())).status).toBe(201);
    const over = await addBooking(t, REAL, { start: env.now().add({ hours: 12, seconds: 1 }).toString(), resourceId: "chair-1" });
    expect((await api.pay(REAL, over, pay(), open())).status).toBe(422);
    expect(await rows()).toHaveLength(1);
  });

  it("a race on the same booking writes one payment and one audit row", async () => {
    const id = await addBooking(t, REAL, { start: SOON });
    const both = await Promise.all([api.pay(REAL, id, pay(), open()), api.pay(REAL, id, pay({ method: "card" }), open())]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await rows()).toHaveLength(1);
    expect((await auditRows(t)).filter((a) => a.action === "pay")).toHaveLength(1);
  });

  it("validates the body", async () => {
    const id = await addBooking(t, REAL, { start: PAST });
    for (const body of [
      pay({ amountCents: -1 }),
      pay({ amountCents: 1_000_001 }),
      pay({ amountCents: 10.5 }),
      pay({ method: "bitcoin" }),
      pay({ productCents: 2000 }), // more than the total
      pay({ productLabel: "x".repeat(61) }),
      pay({ extra: true }),
      { method: "cash" },
    ]) {
      expect((await api.pay(REAL, id, body, open())).status).toBe(400);
    }
    expect(await rows()).toHaveLength(0);
  });

  it("cross-shop is not_found, and nothing is written", async () => {
    const id = await addBooking(t, REAL, { start: PAST });
    const r = await api.pay(DEMO, id, pay(), { token: tokenFor(DEMO) });
    expect([r.status, r.json]).toEqual([404, { error: "booking_not_found" }]);
    expect((await api.pay(REAL, "not-a-uuid", pay(), open())).status).toBe(404);
    expect((await api.pay(REAL, "00000000-0000-4000-8000-0000000000ff", pay(), open())).status).toBe(404);
    expect(await rows()).toHaveLength(0);
    expect((await bookingRow(t, id)).revision).toBe(0);
  });

  it("no session is 401; origin and content type are checked", async () => {
    const id = await addBooking(t, REAL, { start: PAST });
    expect((await api.pay(REAL, id, pay())).status).toBe(401);
    expect((await api.pay(REAL, id, pay(), { token: tokenFor(DEMO) })).status).toBe(401);
    expect((await api.pay(REAL, id, pay(), { ...open(), origin: "https://evil.example" })).status).toBe(403);
    expect((await api.pay(REAL, id, pay(), { ...open(), contentType: "text/plain" })).status).toBe(415);
    expect(await rows()).toHaveLength(0);
  });
});

describe("payments without a booking", () => {
  it("product sale without booking", async () => {
    const r = await api.sale(REAL, { amountCents: 1200, method: "card", productLabel: "Laca" }, open());
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ booking: null });
    expect((await rows())[0]).toMatchObject({ shopId: REAL, bookingId: null, amountCents: 1200, productCents: 1200, productLabel: "Laca", method: "card" });
    expect((await api.sale(REAL, { amountCents: 0, method: "cash" }, open())).status).toBe(400);
    expect((await api.sale(REAL, { amountCents: 100, method: "cash", productCents: 200 }, open())).status).toBe(400);
    expect((await api.sale(REAL, { amountCents: 100, method: "cash" })).status).toBe(401);
  });

  it("GET ?day sums the shop's local day by method, with Madrid midnights as the edges", async () => {
    const at = (iso: string) => createMachineEnv(t, { clock: () => Temporal.Instant.from(iso) });
    const sale = async (iso: string, amountCents: number, method: string) =>
      client(at(iso).handlers).sale(REAL, { amountCents, method }, { token: tokenFor(REAL, {}, undefined, Temporal.Instant.from(iso)) });
    await sale("2026-11-09T22:59:00Z", 700, "cash"); // 23:59 on the 9th in Madrid
    await sale("2026-11-09T23:00:00Z", 1000, "cash"); // 00:00 on the 10th
    await sale("2026-11-10T08:00:00Z", 500, "card");
    await sale("2026-11-10T08:30:00Z", 250, "cash");
    await sale("2026-11-10T22:59:00Z", 300, "bizum"); // 23:59 on the 10th
    await sale("2026-11-10T23:00:00Z", 900, "voucher"); // 00:00 on the 11th
    const r = await api.payments(REAL, "2026-11-10", open());
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ day: "2026-11-10", totalCents: 2050, byMethod: { cash: 1250, card: 500, bizum: 300, voucher: 0 }, count: 4 });
    expect((await api.payments(REAL, "2026-11-11", open())).json).toMatchObject({ totalCents: 900, count: 1 });
    expect((await api.payments(REAL, "2026-11-12", open())).json).toMatchObject({ totalCents: 0, count: 0 });
  });

  it("the day total never includes another shop's payments", async () => {
    await api.sale(REAL, { amountCents: 1200, method: "card" }, open());
    const other = await api.payments(DEMO, "2026-11-10", { token: tokenFor(DEMO) });
    expect(other.json).toMatchObject({ totalCents: 0, count: 0 });
  });

  it("rejects a bad day and extra query keys; no session is 401", async () => {
    expect((await api.payments(REAL, "10-11-2026", open())).status).toBe(400);
    const extra = await env.handlers.payments(mreq("GET", `/api/machine/${REAL}/payments`, { ...open(), query: "?day=2026-11-10&x=1" }), { shopId: REAL });
    expect(extra.status).toBe(400);
    expect((await api.payments(REAL, "2026-11-10")).status).toBe(401);
  });
});

describe("POST /bookings/[id]/note", () => {
  it("visit note round-trip and 500-char limit", async () => {
    const id = await addBooking(t, REAL, { start: PAST });
    const ok = await api.note(REAL, id, { note: "  Tinte 6.3 + 20 vol, 35 min  " }, open());
    expect([ok.status, ok.json]).toEqual([200, { ok: true }]);
    expect((await bookingRow(t, id)).visitNote).toBe("Tinte 6.3 + 20 vol, 35 min");
    expect((await items()).find((i) => i.id === id)?.visitNote).toBe("Tinte 6.3 + 20 vol, 35 min");

    expect((await api.note(REAL, id, { note: "x".repeat(500) }, open())).status).toBe(200);
    expect((await api.note(REAL, id, { note: "x".repeat(501) }, open())).status).toBe(400);
    expect((await bookingRow(t, id)).visitNote).toHaveLength(500);
    // A note is cleared with an empty text.
    expect((await api.note(REAL, id, { note: "" }, open())).status).toBe(200);
    expect((await bookingRow(t, id)).visitNote).toBe("");
    expect((await api.note(REAL, id, { note: "a", extra: 1 }, open())).status).toBe(400);
  });

  it("cross-shop is not_found, and no session is 401", async () => {
    const id = await addBooking(t, REAL, { start: PAST });
    const r = await api.note(DEMO, id, { note: "hola" }, { token: tokenFor(DEMO) });
    expect([r.status, r.json]).toEqual([404, { error: "booking_not_found" }]);
    expect((await api.note(REAL, "nope", { note: "hola" }, open())).status).toBe(404);
    expect((await api.note(REAL, id, { note: "hola" })).status).toBe(401);
    expect((await bookingRow(t, id)).visitNote).toBe("");
  });
});

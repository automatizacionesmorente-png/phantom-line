import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { expenses, outbox, payments } from "@/lib/db/schema";
import { addBooking } from "../db/ownerFixtures";
import { mreq } from "./machineHarness";
import { createTestDb, type TestDb } from "../db/pglite";
import { DEMO, REAL, client, createMachineEnv, seedShops, tokenFor, type MachineEnv } from "./machineHarness";

/**
 * Salon task 7: the month report, the expenses and the accountant's export through real `Request`
 * objects on PGlite. Clock: Tuesday 10 November 2026, 09:00 in Madrid (08:00 UTC).
 */
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
const spend = (o: object = {}) => ({ concept: "Luz", amountCents: 8000, category: "utilities", day: "2026-11-03", ...o });
const addPayment = (shopId: string, paidAt: string, amountCents: number, o: Partial<typeof payments.$inferInsert> = {}) =>
  t.handle.db.insert(payments).values({ shopId, amountCents, method: "cash", paidAt: new Date(paidAt), ...o });

describe("sessions", () => {
  it("month and export need a session", async () => {
    await addPayment(REAL, "2026-11-05T10:00:00Z", 1500);
    const bad = [{}, { token: tokenFor(DEMO) }, { token: tokenFor(REAL, { exp: 1 }) }, { token: "garbage" }];
    for (const o of bad) {
      for (const a of [
        await api.month(REAL, "2026-11", o),
        await api.expenses(REAL, "2026-11", o),
        await api.exportMonth(REAL, "?month=2026-11&format=csv", o),
        await api.createExpense(REAL, spend(), o),
        await api.deleteExpense(REAL, "00000000-0000-4000-8000-000000000001", o),
        await api.endExpense(REAL, "00000000-0000-4000-8000-000000000001", { action: "end", lastMonth: "2026-10" }, o),
      ]) {
        expect(a.status).toBe(401);
        expect(a.text).toBe("");
      }
    }
    expect(await t.handle.db.select().from(expenses)).toHaveLength(0);
  });
});

describe("expenses", () => {
  it("adds a one-off and a monthly expense and lists what counts in a month", async () => {
    const one = await api.createExpense(REAL, spend(), open());
    expect(one.status).toBe(201);
    const rent = await api.createExpense(REAL, spend({ concept: "Alquiler", amountCents: 50_000, category: "rent", day: "2026-09-01", recurring: true }), open());
    expect(rent.status).toBe(201);
    const nov = await api.expenses(REAL, "2026-11", open());
    expect(nov.json).toMatchObject({ month: "2026-11", totalCents: 58_000 });
    expect((nov.json!.items as { concept: string; day: string; recurring: boolean }[]).map((i) => [i.concept, i.day, i.recurring])).toEqual([
      ["Alquiler", "2026-11-01", true],
      ["Luz", "2026-11-03", false],
    ]);
    expect((await api.expenses(REAL, "2026-10", open())).json).toMatchObject({ totalCents: 50_000 });
    expect((await api.expenses(REAL, "2026-08", open())).json).toMatchObject({ totalCents: 0 });
    expect((await api.expenses(REAL, null, open())).json).toMatchObject({ month: "2026-11" });
  });

  it("bounds its inputs", async () => {
    const bad: object[] = [
      spend({ amountCents: 0 }),
      spend({ amountCents: 10_000_001 }),
      spend({ amountCents: 1.5 }),
      spend({ concept: "" }),
      spend({ concept: "   " }),
      spend({ concept: "x".repeat(81) }),
      spend({ category: "yacht" }),
      spend({ day: "2026-02-30" }),
      spend({ day: "03/11/2026" }),
      spend({ day: "2027-11-11" }), // more than a year ahead
      spend({ day: "2020-01-01" }), // older than any report can show
      { ...spend(), extra: 1 },
    ];
    for (const body of bad) expect((await api.createExpense(REAL, body, open())).status).toBe(400);
    expect(await t.handle.db.select().from(expenses)).toHaveLength(0);
    for (const ok of [spend({ amountCents: 1 }), spend({ amountCents: 10_000_000, concept: "x".repeat(80) }), spend({ day: "2027-11-10" })]) {
      expect((await api.createExpense(REAL, ok, open())).status).toBe(201);
    }
  });

  it("editing a recurring amount keeps past months", async () => {
    const created = await api.createExpense(REAL, spend({ concept: "Alquiler", amountCents: 50_000, category: "rent", day: "2026-01-01", recurring: true }), open());
    const id = created.json!.id as string;
    const ended = await api.endExpense(REAL, id, { action: "end", lastMonth: "2026-10" }, open());
    expect(ended.status).toBe(200);
    expect((await api.createExpense(REAL, spend({ concept: "Alquiler", amountCents: 55_000, category: "rent", day: "2026-11-01", recurring: true }), open())).status).toBe(201);
    const left = async (m: string) => (await api.month(REAL, m, open())).json!.expensesCents;
    expect(await left("2026-10")).toBe(50_000);
    expect(await left("2026-06")).toBe(50_000);
    expect(await left("2026-11")).toBe(55_000);
    expect(await left("2026-12")).toBe(55_000);
  });

  it("ending a template that starts after `lastMonth` removes it, and a one-off cannot be ended", async () => {
    const id = (await api.createExpense(REAL, spend({ day: "2026-11-01", recurring: true }), open())).json!.id as string;
    expect((await api.endExpense(REAL, id, { action: "end", lastMonth: "2026-10" }, open())).status).toBe(200);
    expect(await t.handle.db.select().from(expenses)).toHaveLength(0);
    const one = (await api.createExpense(REAL, spend(), open())).json!.id as string;
    expect((await api.endExpense(REAL, one, { action: "end", lastMonth: "2026-10" }, open())).status).toBe(404);
    expect((await api.endExpense(REAL, one, { action: "end", lastMonth: "2022-01" }, open())).status).toBe(400);
    expect((await api.endExpense(REAL, one, { action: "stop", lastMonth: "2026-10" }, open())).status).toBe(400);
  });

  it("refuses the 5001st expense of a shop with 409 limit_reached, and another shop is unaffected", async () => {
    await t.pg.query(
      `INSERT INTO expenses (shop_id, concept, category, amount_cents, day) SELECT $1, 'x', 'other', 100, '2026-11-02' FROM generate_series(1, 5000)`,
      [REAL],
    );
    const full = await api.createExpense(REAL, spend(), open());
    expect(full.status).toBe(409);
    expect(full.json).toEqual({ error: "limit_reached" });
    expect(await t.handle.db.select().from(expenses).where(eq(expenses.shopId, REAL))).toHaveLength(5000);
    expect((await api.createExpense(DEMO, spend(), { token: tokenFor(DEMO) })).status).toBe(201);
  });

  it("deletes an expense of this shop", async () => {
    const id = (await api.createExpense(REAL, spend(), open())).json!.id as string;
    expect((await api.deleteExpense(REAL, id, open())).status).toBe(200);
    expect(await t.handle.db.select().from(expenses)).toHaveLength(0);
    expect((await api.deleteExpense(REAL, id, open())).status).toBe(404);
  });

  it("cross-shop expense delete is not_found, and nothing changes", async () => {
    const [mine] = await t.handle.db.insert(expenses).values({ shopId: DEMO, concept: "Secreto", category: "other", amountCents: 100, day: "2026-11-02" }).returning();
    const [tpl] = await t.handle.db
      .insert(expenses)
      .values({ shopId: DEMO, concept: "Alquiler secreto", category: "rent", amountCents: 100, recurring: true, startMonth: "2026-01" })
      .returning();
    const del = await api.deleteExpense(REAL, mine.id, open());
    expect(del.status).toBe(404);
    expect(del.json).toEqual({ error: "expense_not_found" });
    const end = await api.endExpense(REAL, tpl.id, { action: "end", lastMonth: "2026-10" }, open());
    expect(end.status).toBe(404);
    expect(end.text).not.toContain("secreto");
    expect((await api.deleteExpense(REAL, "not-a-uuid", open())).status).toBe(404);
    expect(await t.handle.db.select().from(expenses).where(eq(expenses.shopId, DEMO))).toHaveLength(2);
    expect((await t.handle.db.select().from(expenses).where(eq(expenses.id, tpl.id)))[0].endMonth).toBeNull();
    // And the other shop's rows never show in this shop's month.
    expect((await api.expenses(REAL, "2026-11", open())).json).toMatchObject({ totalCents: 0, items: [] });
  });
});

describe("GET month", () => {
  it("validates the month: format, 24 months back, 1 ahead", async () => {
    for (const m of ["2026-13", "2026-1", "202611", "2026-11-01", "abc", "2024-10", "2027-01"]) {
      const a = await api.month(REAL, m, open());
      expect(a.status, m).toBe(400);
      expect(a.json).toMatchObject({ error: "invalid_request" });
    }
    for (const m of ["2024-11", "2026-12", "2026-11"]) expect((await api.month(REAL, m, open())).status, m).toBe(200);
    expect((await api.month(REAL, null, open())).json).toMatchObject({ month: "2026-11" });
  });

  it("reports the takings, expenses, change on last month, workers, services and the receptionist", async () => {
    const a = await addBooking(t, REAL, { start: "2026-11-05T08:00:00Z", resourceId: "chair-1" });
    const b = await addBooking(t, REAL, { start: "2026-11-06T08:00:00Z", resourceId: "chair-2", phone: "+34600000002" });
    await addPayment(REAL, "2026-11-05T09:00:00Z", 1800, { bookingId: a, productCents: 300 });
    await addPayment(REAL, "2026-11-06T09:00:00Z", 1500, { bookingId: b });
    await addPayment(REAL, "2026-11-07T09:00:00Z", 700, { productCents: 700 });
    await addPayment(REAL, "2026-11-30T23:30:00Z", 9999); // 00:30 on 1 December: not November
    await addPayment(REAL, "2026-10-10T09:00:00Z", 2000); // October
    await addPayment(DEMO, "2026-11-05T09:00:00Z", 77_777); // another shop
    await api.createExpense(REAL, spend({ amountCents: 1000 }), open());
    await api.createExpense(REAL, spend({ amountCents: 500, day: "2026-10-04" }), open());

    const r = await api.month(REAL, "2026-11", open());
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      month: "2026-11",
      takenCents: 4000,
      expensesCents: 1000,
      leftCents: 3000,
      // October took 2000, spent 500, left 1500.
      deltaPct: { taken: 100, expenses: 100, left: 100 },
      noShows: 0,
    });
    expect(r.json!.byWorker).toEqual([
      { resourceId: "chair-1", takenCents: 1800 },
      { resourceId: "chair-2", takenCents: 1500 },
    ]);
    expect(r.json!.topServices).toEqual([{ serviceId: "haircut", count: 2, takenCents: 3000 }]);
    // addBooking writes voice bookings with no price snapshot: the catalogue's 15 EUR each.
    expect(r.json!.receptionist).toMatchObject({ calls: 0, booked: 2, bookedValueCents: 3000, gapsRefilled: 0 });
    expect(r.text).not.toContain("+3460000");
    const dec = await api.month(REAL, "2026-12", open());
    expect(dec.json).toMatchObject({ takenCents: 9999, deltaPct: { taken: 150 } });
  });

  it("works with nothing at all, and counts a sent gap message toward gaps refilled", async () => {
    const empty = await api.month(REAL, "2026-11", open());
    expect(empty.json).toMatchObject({ takenCents: 0, deltaPct: { taken: null, expenses: null, left: null }, topServices: [], byWorker: [] });

    const [row] = await t.handle.db.insert(outbox).values({
      shopId: REAL, kind: "gap", dedupeKey: "gap-1", phone: "+34612345678", language: "es", body: "Hueco", status: "sent", actedAt: new Date("2026-11-04T12:00:00Z"),
    }).returning();
    expect(row.status).toBe("sent");
    await t.handle.db.insert(outbox).values({ shopId: REAL, kind: "gap", dedupeKey: "gap-2", phone: "+34600000002", language: "es", body: "Hueco", status: "prepared" });
    // Created by the DB default (now), so move the booking's creation inside the window.
    const id = await addBooking(t, REAL, { start: "2026-11-12T08:00:00Z" });
    await t.pg.query("UPDATE bookings SET created_at = '2026-11-05T10:00:00Z' WHERE id = $1", [id]);
    expect((await api.month(REAL, "2026-11", open())).json).toMatchObject({ receptionist: { gapsRefilled: 1 } });
  });
});

describe("GET export", () => {
  it("answers a CSV download with the plan's shape", async () => {
    const a = await addBooking(t, REAL, { start: "2026-11-05T08:00:00Z" });
    await addPayment(REAL, "2026-11-05T09:00:00Z", 1800, { bookingId: a, productCents: 300, productLabel: "Champú" });
    await addPayment(REAL, "2026-11-30T23:30:00Z", 9999);
    await api.createExpense(REAL, spend({ concept: "Luz; agua", amountCents: 3333 }), open());
    const r = await api.exportMonth(REAL, "?month=2026-11&format=csv", open());
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("content-disposition")).toBe(`attachment; filename="phantom-line-${REAL}-2026-11.csv"`);
    // Response.text() drops the BOM, so read the bytes: EF BB BF first.
    const raw = await env.handlers.exportMonth(mreq("GET", `/api/machine/${REAL}/export`, { token, query: "?month=2026-11" }), { shopId: REAL });
    expect([...new Uint8Array(await raw.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(r.text.split("\r\n")).toEqual([
      "fecha;tipo;concepto;método;total;base;iva",
      "2026-11-03;gasto;\"Luz; agua\";;33,33;27,55;5,78",
      "2026-11-05;ingreso;corte + Champú;efectivo;18,00;14,88;3,12",
      "IVA incluido al 21 %, revisar con tu gestor",
      "",
    ]);
    const en = await api.exportMonth(REAL, "?month=2026-11&lang=en", open());
    expect(en.text.split("\r\n")[0]).toBe("date;type;concept;method;total;base;vat");
    expect(en.text).toContain("haircut + Champú");
  });

  it("validates the query", async () => {
    for (const q of ["", "?month=2026-11&format=pdf", "?month=2024-10&format=csv", "?month=2026-11&lang=fr", "?month=2026-11&x=1"]) {
      expect((await api.exportMonth(REAL, q, open())).status, q).toBe(400);
    }
  });

  it("never exports another shop's rows", async () => {
    await addPayment(DEMO, "2026-11-05T09:00:00Z", 77_777);
    await t.handle.db.insert(expenses).values({ shopId: DEMO, concept: "Secreto", category: "other", amountCents: 100, day: "2026-11-02" });
    const r = await api.exportMonth(REAL, "?month=2026-11&format=csv", open());
    expect(r.text).not.toContain("777,77");
    expect(r.text).not.toContain("Secreto");
  });
});

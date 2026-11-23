import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { insertShop } from "./helpers";

/** Salon system task 1: the 0009 tables, columns, CHECKs and the booking backfill. */

const SHOP = lolaProfile.id;
const DRIZZLE = path.resolve(import.meta.dirname, "../../drizzle");

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
});

let slot = 0;
async function insertBooking(channel: string, phone: string): Promise<string> {
  slot += 1;
  const r = await t.pg.query<{ id: string }>(
    `INSERT INTO bookings (shop_id, resource_id, service_id, starts_at, ends_at, customer_name, customer_phone, channel)
     VALUES ($1, 'chair-1', 'cut', '2026-12-01T09:00:00Z'::timestamptz + ($4 || ' hours')::interval, '2026-12-01T09:30:00Z'::timestamptz + ($4 || ' hours')::interval, 'Ana', $2, $3) RETURNING id`,
    [SHOP, phone, channel, String(slot)],
  );
  return r.rows[0].id;
}

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.code ?? err.cause?.code;
  }
}

describe("salon schema 0009", () => {
  it("migrations reach 0009", async () => {
    const r = await t.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
    expect(r.rows[0].n).toBe(10);
  });

  it("payments reject a second payment for one booking", async () => {
    const id = await insertBooking("voice", "+34600000001");
    const ins = () =>
      t.pg.query(
        `INSERT INTO payments (shop_id, booking_id, amount_cents, method, paid_at) VALUES ($1, $2, 2500, 'cash', now())`,
        [SHOP, id],
      );
    await ins();
    expect(await code(ins())).toBe("23505");
  });

  it("expenses reject a recurring row without start_month", async () => {
    const ins = (recurring: boolean, startMonth: string | null, day: string | null) =>
      t.pg.query(
        `INSERT INTO expenses (shop_id, concept, category, amount_cents, recurring, start_month, day) VALUES ($1, 'Alquiler', 'rent', 50000, $2, $3, $4)`,
        [SHOP, recurring, startMonth, day],
      );
    expect(await code(ins(true, null, null))).toBe("23514");
    expect(await code(ins(false, null, null))).toBe("23514");
    expect(await code(ins(true, "2026-11", null))).toBeUndefined();
    expect(await code(ins(false, null, "2026-11-03"))).toBeUndefined();
  });

  it("bookings accept channel manual with empty phone", async () => {
    const id = await insertBooking("manual", "");
    const r = await t.pg.query<{ client_id: string | null; visit_note: string; price_cents: number | null }>(
      "SELECT client_id, visit_note, price_cents FROM bookings WHERE id = $1",
      [id],
    );
    expect(r.rows[0]).toEqual({ client_id: null, visit_note: "", price_cents: null });
    expect(await code(insertBooking("fax", ""))).toBe("23514");
  });

  it("outbox dedupe_key is unique per shop", async () => {
    const ins = () =>
      t.pg.query(
        `INSERT INTO outbox (shop_id, kind, dedupe_key, phone, language, body) VALUES ($1, 'reminder', 'k1', '+34600000001', 'es', 'Hola')`,
        [SHOP],
      );
    await ins();
    expect(await code(ins())).toBe("23505");
  });

  it("deleting a booking keeps its payment with booking_id null", async () => {
    const id = await insertBooking("voice", "+34600000001");
    await t.pg.query(`INSERT INTO payments (shop_id, booking_id, amount_cents, method, paid_at) VALUES ($1, $2, 2500, 'cash', now())`, [SHOP, id]);
    await t.pg.query("DELETE FROM bookings WHERE id = $1", [id]);
    const r = await t.pg.query<{ booking_id: string | null; amount_cents: number }>("SELECT booking_id, amount_cents FROM payments");
    expect(r.rows).toEqual([{ booking_id: null, amount_cents: 2500 }]);
  });

  it("deleting a booking or a client keeps its outbox message with the link null", async () => {
    const id = await insertBooking("voice", "+34600000001");
    const c = await t.pg.query<{ id: string }>(`INSERT INTO clients (shop_id, phone, name) VALUES ($1, '+34600000001', 'Ana') RETURNING id`, [SHOP]);
    await t.pg.query(
      `INSERT INTO outbox (shop_id, kind, dedupe_key, client_id, booking_id, phone, language, body) VALUES ($1, 'reminder', 'k', $2, $3, '+34600000001', 'es', 'Hola')`,
      [SHOP, c.rows[0].id, id],
    );
    await t.pg.query("DELETE FROM bookings WHERE id = $1", [id]);
    await t.pg.query("DELETE FROM clients WHERE id = $1", [c.rows[0].id]);
    const r = await t.pg.query<{ booking_id: string | null; client_id: string | null }>("SELECT booking_id, client_id FROM outbox");
    expect(r.rows).toEqual([{ booking_id: null, client_id: null }]);
  });

  it("owner_actions accept book and pay", async () => {
    const id = await insertBooking("manual", "");
    for (const action of ["book", "pay"]) {
      expect(
        await code(
          t.pg.query(
            `INSERT INTO owner_actions (shop_id, action, booking_id, actor_session, actor_label, before, after) VALUES ($1, $2, $3, 's', 'l', '{}', '{}')`,
            [SHOP, action, id],
          ),
        ),
      ).toBeUndefined();
    }
  });

  // Two phases: a temp copy of drizzle/ holding only 0000-0008 is migrated, the rows are inserted,
  // then the real folder (with 0009) is migrated on the same database.
  it("backfill links existing bookings to clients by phone", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
    fs.mkdirSync(path.join(tmp, "meta"));
    const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 9);
    fs.writeFileSync(path.join(tmp, "meta/_journal.json"), JSON.stringify(journal));
    for (const e of journal.entries) fs.copyFileSync(path.join(DRIZZLE, `${e.tag}.sql`), path.join(tmp, `${e.tag}.sql`));

    const pg = await PGlite.create({ extensions: { btree_gist } });
    try {
      const db = drizzle({ client: pg });
      await migrate(db, { migrationsFolder: tmp });
      await pg.query(
        `INSERT INTO shops (id, name, sector_pack_id, time_zone, profile) VALUES ($1, 'Lola', 'hair', 'Europe/Madrid', '{}'), ('other', 'Other', 'hair', 'Europe/Madrid', '{}')`,
        [SHOP],
      );
      await pg.query(`INSERT INTO clients (shop_id, phone, name) VALUES ($1, '+34600000001', 'Ana'), ('other', '+34600000002', 'Zoe')`, [SHOP]);
      let n = 0;
      const ins = (shop: string, phone: string) => {
        n += 1;
        return pg.query<{ id: string }>(
          `INSERT INTO bookings (shop_id, resource_id, service_id, starts_at, ends_at, customer_name, customer_phone, channel)
           VALUES ($1, 'chair-1', 'cut', '2026-12-01T09:00:00Z'::timestamptz + ($3 || ' hours')::interval, '2026-12-01T09:30:00Z'::timestamptz + ($3 || ' hours')::interval, 'X', $2, 'voice') RETURNING id`,
          [shop, phone, String(n)],
        );
      };
      const a = (await ins(SHOP, "+34600000001")).rows[0].id;
      const noClient = (await ins(SHOP, "+34600000009")).rows[0].id;
      // Same phone as Zoe but another shop: it must not link across shops.
      const otherShop = (await ins("other", "+34600000001")).rows[0].id;

      await migrate(db, { migrationsFolder: DRIZZLE });

      const r = await pg.query<{ id: string; cid: string | null; cphone: string | null }>(
        `SELECT b.id, b.client_id AS cid, c.phone AS cphone FROM bookings b LEFT JOIN clients c ON c.id = b.client_id`,
      );
      const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
      expect(by[a].cphone).toBe("+34600000001");
      expect(by[noClient].cid).toBeNull();
      expect(by[otherShop].cid).toBeNull();
    } finally {
      await pg.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});

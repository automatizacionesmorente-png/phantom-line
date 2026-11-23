import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { createWaitlistRepository } from "@/lib/db/waitlistRepository";
import { waitlist } from "@/lib/db/schema";
import { createTestDb, type TestDb } from "../db/pglite";

const NOW = Temporal.Instant.from("2026-12-01T10:30:00Z");
const entry = { shopName: "Peluquería Lola", city: "Madrid", email: "lola@example.com", language: "es", consent: true } as const;

// PGlite starts slowly when the machine is busy.
const SLOW = 60_000;
let t: TestDb;
afterAll(async () => t?.close());
beforeEach(async () => {
  t ??= await createTestDb();
  await t.reset();
}, SLOW);

describe("waitlist repository (PGlite, migration 0005)", () => {
  it("stores an entry with its consent time", async () => {
    const store = createWaitlistRepository(t.handle);
    expect(await store.add(entry, NOW)).toEqual({ created: true });
    const rows = await t.handle.db.select().from(waitlist);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ shopName: "Peluquería Lola", city: "Madrid", email: "lola@example.com", language: "es" });
    expect(rows[0]?.consentAt.toISOString()).toBe("2026-12-01T10:30:00.000Z");
  });

  it("a repeated email creates no second row", async () => {
    const store = createWaitlistRepository(t.handle);
    await store.add(entry, NOW);
    expect(await store.add({ ...entry, shopName: "Otra" }, NOW)).toEqual({ created: false });
    expect(await t.handle.db.select().from(waitlist).where(eq(waitlist.email, "lola@example.com"))).toHaveLength(1);
  });

  it("the database rejects an unknown language", async () => {
    await expect(
      t.pg.query(`INSERT INTO waitlist (shop_name, city, email, language, consent_at) VALUES ('a','b','c@d.ee','fr', now())`),
    ).rejects.toThrow();
  });

  it("counts hits per visitor and per day", async () => {
    const store = createWaitlistRepository(t.handle);
    expect(await store.hit("v1", NOW)).toEqual({ visitor: 1, day: 1 });
    expect(await store.hit("v1", NOW)).toEqual({ visitor: 2, day: 2 });
    expect(await store.hit("v2", NOW)).toEqual({ visitor: 1, day: 3 });
    // The next hour resets the visitor count, not the daily one.
    expect(await store.hit("v1", NOW.add({ hours: 1 }))).toEqual({ visitor: 1, day: 4 });
  });
});

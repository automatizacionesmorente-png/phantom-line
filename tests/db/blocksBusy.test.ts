import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { timeBlocks } from "@/lib/db/schema";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { bookingWrite, callWrite, insertShop } from "./helpers";

const SHOP = lolaProfile.id;
const at = (s: string) => new Date(s);
let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
});

describe("listBookings and time blocks", () => {
  it("listBookings includes a whole-shop block once per resource", async () => {
    const [blk] = await t.handle.db
      .insert(timeBlocks)
      .values({ shopId: SHOP, resourceId: null, startsAt: at("2026-12-01T09:00:00Z"), endsAt: at("2026-12-01T11:00:00Z") })
      .returning();
    const from = Temporal.Instant.from("2026-12-01T00:00:00Z");
    const to = Temporal.Instant.from("2026-12-02T00:00:00Z");
    const got = await t.repo.listBookings(SHOP, from, to);
    expect(got.map((x) => x.id).sort()).toEqual(lolaProfile.resources.map((r) => `block:${blk.id}:${r.id}`).sort());
    expect(got.map((x) => x.resourceId).sort()).toEqual(lolaProfile.resources.map((r) => r.id).sort());
  });

  it("a resource block is one entry, a block outside the window or of another shop is left out, bookings still come", async () => {
    const r0 = lolaProfile.resources[0].id;
    await t.handle.db.insert(timeBlocks).values([
      { shopId: SHOP, resourceId: r0, startsAt: at("2026-12-01T09:00:00Z"), endsAt: at("2026-12-01T10:00:00Z") },
      { shopId: SHOP, resourceId: r0, startsAt: at("2026-12-05T09:00:00Z"), endsAt: at("2026-12-05T10:00:00Z") },
    ]);
    const call = callWrite(SHOP);
    await t.repo.commit([call]);
    const b = bookingWrite({ shopId: SHOP, callId: call.call.id, start: "2026-12-01T13:00:00Z" });
    await t.repo.commit([b]);
    const got = await t.repo.listBookings(SHOP, Temporal.Instant.from("2026-12-01T00:00:00Z"), Temporal.Instant.from("2026-12-02T00:00:00Z"));
    expect(got).toHaveLength(2);
    expect(got.filter((x) => x.id.startsWith("block:"))).toHaveLength(1);
    expect(got.some((x) => x.id === b.booking.id)).toBe(true);
  });
});

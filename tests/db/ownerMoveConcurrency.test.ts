import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { bookings } from "@/lib/db/schema";
import { decideMove } from "@/lib/owner/move";
import type { OwnerRepository } from "@/lib/owner/types";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { bookingWrite, callWrite, insertShop, messageWrite } from "./helpers";
import { ACTOR, addBooking, auditRows, ownerRepoOf } from "./ownerFixtures";

/**
 * M9, database half (owner-machine 15.5, 10.5): 10 owner moves and 10 caller bookings for
 * the same chair and time, all started before the first one settles. Every move was accepted
 * by decideMove against the agenda read beforehand, as the handler does, so only the
 * bookings_no_overlap constraint can stop a double booking. PGlite runs the statements one
 * after another inside one backend (see concurrency.test.ts).
 */
const SHOP = lolaProfile.id;
/** Tuesday 10 November 2026, 09:00 Madrid. */
const NOW = Temporal.Instant.from("2026-11-10T08:00:00Z");
/** Thursday 12 November 17:00 Madrid, chair 1. */
const TARGET = Temporal.Instant.from("2026-11-12T16:00:00Z");
const N = 10;

let t: TestDb;
let owner: OwnerRepository;
beforeAll(async () => {
  t = await createTestDb();
  owner = ownerRepoOf(t);
  await insertShop(t, lolaProfile);
}, 120_000);
afterAll(async () => {
  await t.close();
});

describe("M9, database half: 20 concurrent owner moves and caller bookings for one chair and time", () => {
  it("leave exactly one active row there; every loser gets overlap or a caller-side conflict", async () => {
    // 10 bookings on chair 1 on Wednesday 11 and Friday 13, each the Owner will try to move to TARGET.
    const days = ["2026-11-11", "2026-11-13"];
    const toMove: string[] = [];
    for (let k = 0; k < N; k++) {
      const day = days[k % 2];
      const minutes = 9 * 60 + 30 * Math.floor(k / 2); // 10:00, 10:30, … Madrid (UTC+1)
      const start = Temporal.Instant.from(`${day}T00:00:00Z`).add({ minutes });
      toMove.push(await addBooking(t, SHOP, { start, resourceId: "chair-1", name: `Mover ${k}` }));
    }
    const pack = getSectorPack("hair-salon");
    const existing = await t.repo.listBookings(SHOP, NOW, NOW.add({ hours: 24 * 14 }));
    const moves = [];
    for (const id of toMove) {
      const booking = (await owner.getBooking(SHOP, id))!;
      const d = decideMove({ booking, start: TARGET, now: NOW, shop: lolaProfile, pack, existing });
      expect(d.ok).toBe(true);
      if (!d.ok) throw new Error("unreachable");
      expect(d.verdict.resourceId).toBe("chair-1");
      moves.push({ id, revision: booking.revision, verdict: d.verdict });
    }
    const callIds: string[] = [];
    for (let k = 0; k < N; k++) {
      const w = callWrite(SHOP);
      await t.repo.commit([w]);
      callIds.push(w.call.id);
    }

    let inFlight = 0;
    let maxInFlight = 0;
    const track = <T,>(p: Promise<T>) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return p.finally(() => inFlight--);
    };
    const all: Promise<{ who: "owner" | "caller"; ok: boolean; status: string }>[] = [];
    for (let k = 0; k < N; k++) {
      const m = moves[k];
      all.push(
        track(
          owner.applyOwnerCommand({
            kind: "move", shopId: SHOP, bookingId: m.id, revision: m.revision, actor: ACTOR, now: NOW,
            to: { start: m.verdict.start, end: m.verdict.end, resourceId: m.verdict.resourceId },
          }),
        ).then((r) => ({ who: "owner" as const, ok: r.status === "applied", status: r.status })),
      );
      const b = bookingWrite({ shopId: SHOP, callId: callIds[k], start: TARGET.toString(), resourceId: "chair-1", customerName: `Caller ${k}` });
      all.push(
        track(t.repo.commit([b, messageWrite(SHOP, callIds[k], b.booking.id)])).then((r) => ({
          who: "caller" as const,
          ok: r.ok,
          status: r.ok ? "ok" : r.conflict,
        })),
      );
    }
    expect(maxInFlight).toBe(2 * N);
    const results = await Promise.all(all);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) {
      expect(r.status).toBe(r.who === "owner" ? "overlap" : "booking_overlap");
    }
    const there = await t.handle.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.shopId, SHOP), eq(bookings.resourceId, "chair-1"), eq(bookings.status, "confirmed"), eq(bookings.startsAt, new Date(TARGET.epochMilliseconds))));
    expect(there).toHaveLength(1);
    // A losing move wrote nothing: one Audit_Record at most, and only for a winning move.
    const audit = await auditRows(t);
    const ownerWon = results.some((r) => r.who === "owner" && r.ok);
    expect(audit).toHaveLength(ownerWon ? 1 : 0);
    // Every losing move's Booking is still where it was.
    const moved = await t.handle.db.select().from(bookings).where(eq(bookings.shopId, SHOP));
    const stillThere = moved.filter((b) => toMove.includes(b.id) && b.startsAt.getTime() !== TARGET.epochMilliseconds);
    expect(stillThere).toHaveLength(ownerWon ? N - 1 : N);
  });
});

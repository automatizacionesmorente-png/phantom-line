import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import type { OwnerRepository } from "@/lib/owner/types";
import { lolaProfile } from "../fixtures/lola";
import { createTestDb, type TestDb } from "./pglite";
import { insertShop } from "./helpers";
import { ACTOR, addBooking, addCall, addMessage, auditRows, bookingRow, messageRow, ownerRepoOf } from "./ownerFixtures";

/**
 * M16. Audit_Records match applied actions exactly (owner-machine 11.1–11.4). Over sequences
 * of owner commands on PGlite, with stale revisions, overlapping moves, started Bookings and
 * repeats: one new owner_actions row per `applied` result and none otherwise; its `before`
 * is the row as it was and its `after` the row as it is right after; and no Audit_Record ever
 * holds a seeded customer name or phone. numRuns 50 (design).
 */
const SHOP = lolaProfile.id;
const NOW = Temporal.Instant.from("2026-11-10T08:00:00Z");
/** Thursday 12 November 10:00 Madrid + k × 15 min; slot −1 has already started at NOW. */
const slot = (k: number) =>
  k < 0 ? Temporal.Instant.from("2026-11-10T07:45:00Z") : Temporal.Instant.from("2026-11-12T09:00:00Z").add({ minutes: 15 * k });

const arbName = fc.stringMatching(/^[a-z]{6}$/).map((s) => `Nombre-${s}`);
const arbPhone = fc.stringMatching(/^[0-9]{8}$/).map((s) => `+346${s}`);
const arbSeed = fc.record({
  // Seeded Bookings 30 minutes apart (k even) cannot overlap each other; moves use every k.
  bookings: fc.uniqueArray(fc.record({ k: fc.constantFrom(-1, 0, 2, 4), res: fc.constantFrom("chair-1", "chair-2"), name: arbName, phone: arbPhone }), {
    minLength: 1,
    maxLength: 4,
    selector: (b) => `${b.k}:${b.res}`,
  }),
  messages: fc.array(fc.record({ name: arbName, phone: arbPhone }), { minLength: 1, maxLength: 3 }),
});
const arbCmd = fc.oneof(
  fc.record({
    target: fc.constant("booking" as const),
    j: fc.nat({ max: 3 }),
    kind: fc.constantFrom("confirm" as const, "cancel" as const, "move" as const),
    revisionDelta: fc.constantFrom(0, 0, 0, -1, 1),
    k: fc.integer({ min: 0, max: 5 }),
    res: fc.constantFrom("chair-1", "chair-2"),
  }),
  fc.record({ target: fc.constant("message" as const), j: fc.nat({ max: 2 }), kind: fc.constantFrom("play" as const, "erase" as const) }),
);

const iso = (d: Date) => d.toISOString();
const bookingState = (b: Awaited<ReturnType<typeof bookingRow>>) => ({
  start: iso(b.startsAt),
  end: iso(b.endsAt),
  resourceId: b.resourceId,
  status: b.status,
  ownerConfirmed: b.ownerConfirmedAt !== null,
});
const messageState = (m: Awaited<ReturnType<typeof messageRow>>) => ({ heard: m.readAt !== null, erased: m.erasedAt !== null });

let t: TestDb;
let owner: OwnerRepository;
beforeAll(async () => {
  t = await createTestDb();
  owner = ownerRepoOf(t);
}, 120_000);
afterAll(async () => {
  await t.close();
});

describe("M16: Audit_Records match applied actions", () => {
  it("one record per applied command, with the row's before and after, and no name or phone", async () => {
    const seen = { applied: 0, notApplied: 0, overlap: 0, stale: 0, staleSent: 0 };
    await fc.assert(
      fc.asyncProperty(arbSeed, fc.array(arbCmd, { minLength: 1, maxLength: 20 }), async (seed, cmds) => {
        await t.reset();
        await insertShop(t, lolaProfile);
        const bookingIds: string[] = [];
        for (const b of seed.bookings) {
          bookingIds.push(await addBooking(t, SHOP, { start: slot(b.k), resourceId: b.res, name: b.name, phone: b.phone }));
        }
        const messageIds: string[] = [];
        for (const m of seed.messages) {
          messageIds.push(await addMessage(t, SHOP, await addCall(t, SHOP), { name: m.name, phone: m.phone, reason: `Llama ${m.name}` }));
        }
        const secrets = [...seed.bookings, ...seed.messages].flatMap((x) => [x.name, x.phone]);
        let applied = 0;

        for (const c of cmds) {
          const auditBefore = new Set((await auditRows(t)).map((a) => a.id));
          let status: string;
          let before: object;
          let after: () => Promise<object>;
          let sentStale = false;
          if (c.target === "booking") {
            const id = bookingIds[c.j % bookingIds.length];
            const row = await bookingRow(t, id);
            before = bookingState(row);
            after = async () => bookingState(await bookingRow(t, id));
            const revision = Math.max(0, row.revision + c.revisionDelta);
            sentStale = revision !== row.revision;
            if (sentStale) seen.staleSent++;
            const base = { shopId: SHOP, bookingId: id, revision, actor: ACTOR, now: NOW };
            const r =
              c.kind === "move"
                ? await owner.applyOwnerCommand({ ...base, kind: "move", to: { start: slot(c.k), end: slot(c.k).add({ minutes: 30 }), resourceId: c.res } })
                : await owner.applyOwnerCommand({ ...base, kind: c.kind });
            status = r.status;
          } else {
            const id = messageIds[c.j % messageIds.length];
            before = messageState(await messageRow(t, id));
            after = async () => messageState(await messageRow(t, id));
            status = (await owner.applyOwnerCommand({ kind: c.kind, shopId: SHOP, messageId: id, actor: ACTOR, now: NOW })).status;
          }
          const audit = await auditRows(t);
          const added = audit.filter((a) => !auditBefore.has(a.id));
          if (status === "applied") {
            // 10.7: only the revision the Owner saw can apply.
            expect(sentStale).toBe(false);
            applied++;
            seen.applied++;
            expect(added).toHaveLength(1);
            expect(added[0].action).toBe(c.kind);
            expect(added[0].before).toEqual(before);
            expect(added[0].after).toEqual(await after());
            expect(added[0]).toMatchObject({ actorSession: ACTOR.sessionId, actorLabel: ACTOR.label });
          } else {
            seen.notApplied++;
            if (status === "overlap") seen.overlap++;
            if (status === "stale") seen.stale++;
            expect(added).toHaveLength(0);
            expect(await after()).toEqual(before); // nothing was applied (11.3)
          }
        }

        const all = await auditRows(t);
        expect(all).toHaveLength(applied);
        const json = JSON.stringify(all.map((a) => ({ before: a.before, after: a.after, label: a.actorLabel, session: a.actorSession })));
        for (const s of secrets) expect(json).not.toContain(s);
      }),
      { numRuns: 50 },
    );
    expect(seen.applied).toBeGreaterThan(0);
    expect(seen.overlap).toBeGreaterThan(0);
    expect(seen.stale).toBeGreaterThan(0);
    expect(seen.staleSent).toBeGreaterThan(0);
  }, 600_000);
});

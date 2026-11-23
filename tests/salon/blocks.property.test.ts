import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { daySlots, firstSlotsFrom, overlaps } from "@/lib/booking";
import { blocksAsBusy } from "@/lib/salon/blocks";
import type { TimeBlock } from "@/lib/salon/types";
import { moveContext } from "@/lib/owner/move";
import { NUM_RUNS, arbCase, ctxOf, profileOf, wallInstant, type Case } from "../booking/arbitraries";

const arbBlocks = (c: Case): fc.Arbitrary<TimeBlock[]> =>
  fc.array(
    fc.record({
      resource: fc.option(fc.integer({ min: 0, max: c.shop.resources.length - 1 }), { nil: null }),
      dayOffset: fc.integer({ min: 0, max: 14 }),
      wholeDay: fc.boolean(),
      startMin: fc.integer({ min: 0, max: 24 * 60 }),
      durMin: fc.integer({ min: 15, max: 3 * 24 * 60 }),
    }),
    { maxLength: 6 },
  ).map((xs) =>
    xs.map((x, i) => {
      const day = c.now.toZonedDateTimeISO(c.shop.timeZone).toPlainDate().add({ days: x.dayOffset });
      const start = x.wholeDay ? wallInstant(day, 0, c.shop.timeZone) : wallInstant(day, 0, c.shop.timeZone).add({ minutes: x.startMin });
      const end = x.wholeDay ? wallInstant(day.add({ days: 1 }), 0, c.shop.timeZone) : start.add({ minutes: x.durMin });
      return {
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        resourceId: x.resource === null ? null : c.shop.resources[x.resource].id,
        start,
        end,
        reason: "",
      };
    }),
  );

describe("time blocks are busy time", () => {
  it("no offered slot overlaps a block", { timeout: 300_000 }, () => {
    fc.assert(
      fc.property(arbCase.chain((c) => arbBlocks(c).map((blocks) => ({ c, blocks }))), ({ c, blocks }) => {
        const busy = blocksAsBusy(blocks, c.shop.resources);
        const ctx = ctxOf({ ...c, existing: [...c.existing, ...busy] });
        const clash = (s: { resourceId: string; start: Temporal.Instant; end: Temporal.Instant }) =>
          blocks.some((b) => (b.resourceId === null || b.resourceId === s.resourceId) && overlaps(b, s));

        for (const s of firstSlotsFrom({ serviceId: c.req.serviceId, from: c.now }, ctx, { limit: 40, windowDays: 14 })) {
          expect(clash(s)).toBe(false);
        }
        const day = c.now.toZonedDateTimeISO(c.shop.timeZone).toPlainDate();
        const { profile, sectorPack } = profileOf(c);
        const mctx = moveContext({ resourceId: c.shop.resources[0].id }, profile, sectorPack, c.now, [...c.existing, ...busy]);
        for (let d = 0; d < 15; d++) {
          for (const s of daySlots({ serviceId: c.req.serviceId }, day.add({ days: d }), mctx)) expect(clash(s)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a whole-shop block expands to one entry per resource, a resource block to one", () => {
    const b = (resourceId: string | null): TimeBlock => ({
      id: "u1",
      resourceId,
      start: Temporal.Instant.from("2026-12-01T09:00:00Z"),
      end: Temporal.Instant.from("2026-12-01T10:00:00Z"),
      reason: "",
    });
    const rs = [{ id: "a" }, { id: "b" }];
    expect(blocksAsBusy([b(null)], rs).map((x) => x.id)).toEqual(["block:u1:a", "block:u1:b"]);
    expect(blocksAsBusy([b("b")], rs).map((x) => x.id)).toEqual(["block:u1:b"]);
    expect(blocksAsBusy([b("gone")], rs)).toEqual([]);
  });
});

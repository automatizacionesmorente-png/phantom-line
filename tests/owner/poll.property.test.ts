import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { AgendaDayDto } from "@/lib/owner/api";
import { pollResponse, type Snapshot } from "@/lib/owner/poll";
import { NUM_RUNS } from "../messages/arbitraries";
import { arbLeakyTapeRow } from "./pollFixtures";

const arbVersion = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
const arbCount = fc.integer({ min: 0, max: 200 });
const arbHead = fc
  .tuple(arbVersion, arbCount, arbCount)
  .map(([version, total, unheard]) => ({ version, counts: { new: total, unheard: Math.min(unheard, total) } }));

const arbAgenda: fc.Arbitrary<AgendaDayDto[]> = fc.array(
  fc.record({ date: fc.constantFrom("2026-03-29", "2026-10-25", "2026-11-12"), items: fc.constant([]) }),
  { maxLength: 8 },
);
const arbSnapshot: fc.Arbitrary<Snapshot> = fc.record({
  now: fc.constant("2026-11-12T10:00:00Z"),
  tape: fc.array(arbLeakyTapeRow, { maxLength: 12 }),
  agenda: arbAgenda,
});

/** `since` equal to the version half of the time, else any other value or none. */
const arbCase = arbHead.chain((head) =>
  fc.record({
    head: fc.constant(head),
    since: fc.oneof(fc.constant(head.version), fc.constant(null), arbVersion),
    snapshot: arbSnapshot,
  }),
);

/** Every key anywhere in a JSON value. */
function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe("M14: the Poll body (owner-machine 12.2, 12.3, 14.2)", () => {
  it("is the small body under 200 bytes when since === version, else the full one, never with a transcript", async () => {
    await fc.assert(
      fc.asyncProperty(arbCase, async ({ head, since, snapshot }) => {
        let loaded = 0;
        const res = await pollResponse(since, head, async () => {
          loaded += 1;
          return snapshot;
        });
        const json = JSON.stringify(res);
        if (since === head.version) {
          expect(Object.keys(res).sort()).toEqual(["changed", "counts", "version"]);
          expect(res).toEqual({ changed: false, version: head.version, counts: head.counts });
          expect(new TextEncoder().encode(json).length).toBeLessThan(200);
          expect(loaded).toBe(0);
        } else {
          expect(res.changed).toBe(true);
          if (!res.changed) return;
          expect(res.version).toBe(head.version);
          expect(res.counts).toEqual(head.counts);
          expect(res.tape.map((t) => t.id)).toEqual(snapshot.tape.map((t) => t.id));
          expect(res.agenda).toEqual(snapshot.agenda);
          for (const item of res.tape) {
            expect(Object.keys(item)).not.toContain("transcript");
            expect(Object.keys(item)).not.toContain("visitorKey");
          }
          expect(keysDeep(JSON.parse(json)).has("transcript")).toBe(false);
          expect(loaded).toBe(1);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

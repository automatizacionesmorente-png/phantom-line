import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Urgency } from "@/lib/conversation/types";
import { lightState, orderTape, tapeCounts, type TapeEntry } from "@/lib/messages/tape";
import { NUM_RUNS } from "./arbitraries";

// ---------------------------------------------------------------------------
// Generators. Few distinct instants, so equal times (and the id tie-break) happen often;
// each instant is written with a Z or with an offset, so a string sort would be wrong.

const BASE_MS = Date.UTC(2026, 9, 25, 0, 0); // 25 October 2026, the Madrid DST night

const isoWithOffset = (ms: number, offsetMin: number): string => {
  if (offsetMin === 0) return new Date(ms).toISOString();
  const local = new Date(ms + offsetMin * 60_000).toISOString().slice(0, -1);
  const sign = offsetMin > 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};

const arbEntry: fc.Arbitrary<TapeEntry> = fc
  .record({
    id: fc.stringMatching(/^[a-z0-9-]{1,6}$/),
    urgency: fc.constantFrom<Urgency>("low", "normal", "urgent"),
    heard: fc.boolean(),
    minute: fc.integer({ min: 0, max: 12 }).map((k) => k * 30),
    offsetMin: fc.constantFrom(0, 60, 120, -300),
  })
  .map(({ id, urgency, heard, minute, offsetMin }) => ({
    id,
    urgency,
    heard,
    createdAt: isoWithOffset(BASE_MS + minute * 60_000, offsetMin),
  }));

/** A Tape: ids are unique, as message ids are. */
const arbTape = fc.uniqueArray(arbEntry, { selector: (e) => e.id, maxLength: 30 });

// ---------------------------------------------------------------------------
// The oracle: Tape_Order as a tuple key, with Date.parse instead of Temporal.

const URGENCY_KEY: Record<Urgency, number> = { urgent: 0, normal: 1, low: 2 };
const oracleKey = (e: TapeEntry): [number, number, number, string] => [
  e.heard ? 1 : 0,
  URGENCY_KEY[e.urgency],
  -Date.parse(e.createdAt),
  e.id,
];
const compareKeys = (a: TapeEntry, b: TapeEntry): number => {
  const ka = oracleKey(a);
  const kb = oracleKey(b);
  for (let k = 0; k < 3; k++) if (ka[k] !== kb[k]) return (ka[k] as number) - (kb[k] as number);
  return ka[3] < kb[3] ? -1 : ka[3] > kb[3] ? 1 : 0;
};

describe("M6: Tape order, counts and light (owner-machine 7.1, 6.3, 6.4)", () => {
  it("orderTape is a permutation of its input, in Tape_Order", () => {
    fc.assert(
      fc.property(arbTape, (tape) => {
        const ordered = orderTape(tape);
        // A permutation: the same items, each once.
        expect(ordered).toHaveLength(tape.length);
        expect(new Set(ordered)).toEqual(new Set(tape));
        // In Tape_Order: ids are unique, so the order is total and the oracle's sort is the only answer.
        expect(ordered.map((e) => e.id)).toEqual([...tape].sort(compareKeys).map((e) => e.id));
        for (let k = 1; k < ordered.length; k++) {
          expect(compareKeys(ordered[k - 1], ordered[k])).toBeLessThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("orderTape does not depend on the input order", () => {
    fc.assert(
      fc.property(
        arbTape.chain((tape) => fc.tuple(fc.constant(tape), fc.shuffledSubarray(tape, { minLength: tape.length }))),
        ([tape, shuffled]) => {
          expect(orderTape(shuffled).map((e) => e.id)).toEqual(orderTape(tape).map((e) => e.id));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("tapeCounts matches a direct count, and lightState is exactly as defined", () => {
    fc.assert(
      fc.property(arbTape, (tape) => {
        const counts = tapeCounts(tape);
        const unheard = tape.filter((e) => e.heard === false).length;
        expect(counts).toEqual({ new: tape.length, unheard });

        // 6.4: blinking while at least one is unheard; steady with messages but none unheard; off with none.
        const expected = unheard >= 1 ? "blinking" : tape.length >= 1 ? "steady" : "off";
        expect(lightState(counts)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("lightState over every pair of counts with unheard ≤ new", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 300 }).chain((n) => fc.tuple(fc.constant(n), fc.nat({ max: n }))),
        ([n, u]) => {
          const state = lightState({ new: n, unheard: u });
          expect(state === "blinking").toBe(u > 0);
          expect(state === "steady").toBe(n > 0 && u === 0);
          expect(state === "off").toBe(n === 0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

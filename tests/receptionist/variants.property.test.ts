import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { pickVariant, type Variants } from "@/lib/receptionist/variants";

/**
 * N8. Variant choice is deterministic and approved. For all call ids, turns
 * and keys: pickVariant returns the same element on repeated calls, and always
 * an element of the list. Over 500 consecutive turns of one call, every
 * variant of a 2-variant template is chosen at least once.
 * Validates 9.4, 13.4.
 */

const arbCallId = fc.oneof(fc.uuid(), fc.string({ maxLength: 40 }), fc.string({ unit: "grapheme", maxLength: 20 }));
const arbTurn = fc.nat({ max: 10_000 });
const arbKey = fc.oneof(
  fc.constantFrom("greeting", "askName", "askPhone", "readBack", "offer", "confirmed", "goodbye"),
  fc.string({ maxLength: 30 }),
);
/** Distinct objects, so "an element of the list" is checked by identity, not only by value. */
const arbVariants: fc.Arbitrary<Variants<{ id: number }>> = fc
  .integer({ min: 1, max: 8 })
  .map((n) => Array.from({ length: n }, (_, id) => ({ id })) as unknown as Variants<{ id: number }>);

describe("N8: pickVariant", () => {
  it("is deterministic and always returns one of the approved variants", () => {
    fc.assert(
      fc.property(arbCallId, arbTurn, arbKey, arbVariants, (callId, turn, key, variants) => {
        const first = pickVariant({ callId, turn }, key, variants);
        const again = pickVariant({ callId, turn }, key, variants);
        expect(variants).toContain(first);
        expect(again).toBe(first);
        // A fresh but equal seed object gives the same choice: only the values matter.
        expect(pickVariant({ callId: `${callId}`, turn: turn + 0 }, `${key}`, variants)).toBe(first);
      }),
      { numRuns: 1000 },
    );
  });

  it("reaches every variant of a 2-variant template over 500 consecutive turns of one call", () => {
    fc.assert(
      fc.property(arbCallId, arbKey, (callId, key) => {
        const variants = ["a", "b"] as const;
        const seen = new Set<string>();
        for (let turn = 0; turn < 500; turn++) seen.add(pickVariant({ callId, turn }, key, variants));
        expect(seen).toEqual(new Set(variants));
      }),
      { numRuns: 300 },
    );
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Urgency } from "@/lib/conversation/types";
import type { TapeEntry } from "@/lib/messages/tape";
import { initialTapePlayer, tapePlayer, type TapePlayerEvent, type TapePlayerState } from "@/lib/owner/tapePlayer";
import { NUM_RUNS } from "../messages/arbitraries";

// ---------------------------------------------------------------------------
// Generators: a small universe of ids, so the same Message shows up in many snapshots,
// is played, erased and listed again by snapshots of any version, in any order.

const IDS = ["m0", "m1", "m2", "m3", "m4", "m5", "m6"] as const;
const arbId = fc.constantFrom(...IDS);

const arbItem: fc.Arbitrary<TapeEntry> = fc.record({
  id: arbId,
  urgency: fc.constantFrom<Urgency>("low", "normal", "urgent"),
  heard: fc.boolean(),
  createdAt: fc.integer({ min: 0, max: 59 }).map((m) => `2026-11-12T10:${String(m).padStart(2, "0")}:00Z`),
});
const arbItems = fc.uniqueArray(arbItem, { selector: (i) => i.id, maxLength: IDS.length });
/** Versions from a small range, so older, equal and newer snapshots all arrive. */
const arbVersion = fc.integer({ min: 0, max: 30 });

const arbEvent: fc.Arbitrary<TapePlayerEvent> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ type: fc.constant("SNAPSHOT" as const), version: arbVersion, items: arbItems }) },
  { weight: 2, arbitrary: fc.constant({ type: "PLAY" as const }) },
  { weight: 3, arbitrary: fc.constant({ type: "NEXT" as const }) },
  { weight: 1, arbitrary: fc.constant({ type: "STOP" as const }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant("ERASE" as const), id: arbId }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant("ERASED" as const), id: arbId, version: arbVersion }) },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("TRANSCRIPT" as const),
      id: arbId,
      lines: fc.constant([{ caller: "Hola", receptionist: "¡Hola!" }]),
    }),
  },
);

const arbRun = fc.record({
  version: arbVersion,
  initial: arbItems,
  events: fc.array(arbEvent, { minLength: 1, maxLength: 40 }),
});

describe("M5: erase is permanent on the page (owner-machine 8.1, 7.5, 7.6)", () => {
  it("an erased id never comes back in items, the queue or playing, and version never decreases", () => {
    fc.assert(
      fc.property(arbRun, ({ version, initial, events }) => {
        let s: TapePlayerState = initialTapePlayer(version, initial);
        const erased = new Set<string>();
        for (const e of events) {
          const before = s.version;
          const [next, effects] = tapePlayer(s, e);
          s = next;
          if (e.type === "ERASE" || e.type === "ERASED") erased.add(e.id);

          for (const id of erased) {
            expect(s.items[id], `items holds erased ${id}`).toBeUndefined();
            expect(s.queue.slice(s.index + 1), `rest of queue holds erased ${id}`).not.toContain(id);
            expect(s.queue, `queue holds erased ${id}`).not.toContain(id);
            expect(s.playing, `playing erased ${id}`).not.toBe(id);
            expect(s.transcripts[id], `transcript kept for erased ${id}`).toBeUndefined();
          }
          // The page never asks to play an erased Message.
          for (const fx of effects) if (fx.type === "postPlay") expect(erased.has(fx.id)).toBe(false);
          expect(s.version).toBeGreaterThanOrEqual(before);
          // The Message on screen is always one on the Tape, at its place in the frozen queue.
          if (s.playing !== null) {
            expect(s.items[s.playing]).toBeDefined();
            expect(s.queue[s.index]).toBe(s.playing);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("each id is sent to the server for erasing at most once", () => {
    fc.assert(
      fc.property(arbRun, ({ version, initial, events }) => {
        let s: TapePlayerState = initialTapePlayer(version, initial);
        const sent: string[] = [];
        for (const e of events) {
          const [next, effects] = tapePlayer(s, e);
          s = next;
          for (const fx of effects) if (fx.type === "postErase") sent.push(fx.id);
        }
        expect(new Set(sent).size).toBe(sent.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

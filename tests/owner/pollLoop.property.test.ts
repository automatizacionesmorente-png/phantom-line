import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { PollResponse } from "@/lib/owner/api";
import { pollLoop, startPollLoop, type PollEffect, type PollEvent } from "@/lib/owner/pollLoop";
import { NUM_RUNS } from "../messages/arbitraries";
import { tapeItem } from "./pollFixtures";

// ---------------------------------------------------------------------------
// Generators: event sequences with non-decreasing `at`. Gaps mix a few seconds with
// minutes up to 20, so 15-minute Idle stretches start and end inside one sequence.

const IDS = ["m0", "m1", "m2", "m3", "m4", "m5"] as const;
const T0 = 1_000_000;
const MIN = 60_000;

const arbGap = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 0, max: 10_000 }) },
  { weight: 2, arbitrary: fc.integer({ min: 10_000, max: 20 * MIN }) },
  // Right around the 15-minute edge.
  { weight: 1, arbitrary: fc.integer({ min: 15 * MIN - 2, max: 15 * MIN + 2 }) },
);

const arbResponse: fc.Arbitrary<PollResponse> = fc.oneof(
  fc
    .integer({ min: 8, max: 20 })
    .map((version): PollResponse => ({ changed: false, version, counts: { new: 1, unheard: 0 } })),
  fc.record({ version: fc.integer({ min: 8, max: 20 }), ids: fc.subarray([...IDS]) }).map(
    ({ version, ids }): PollResponse => ({
      changed: true,
      version,
      counts: { new: ids.length, unheard: 0 },
      now: "2026-11-12T10:00:00Z",
      tape: ids.map((id) => tapeItem(id)),
      agenda: [],
    }),
  ),
);

type Step =
  | { kind: "TICK" | "VISIBLE" | "INPUT"; gap: number }
  | { kind: "HIDDEN" | "FAILED" | "UNAUTHORIZED"; gap: number }
  | { kind: "OK"; gap: number; res: PollResponse };

const arbStep: fc.Arbitrary<Step> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("TICK" as const), gap: arbGap }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("VISIBLE" as const), gap: arbGap }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("HIDDEN" as const), gap: arbGap }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("INPUT" as const), gap: arbGap }) },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant("OK" as const), gap: arbGap, res: arbResponse }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("FAILED" as const), gap: arbGap }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("UNAUTHORIZED" as const), gap: arbGap }) },
);

const arbRun = fc.record({
  visible: fc.boolean(),
  tapeIds: fc.subarray([...IDS]),
  steps: fc.array(arbStep, { minLength: 1, maxLength: 40 }),
});

/** Turn steps into events with absolute, non-decreasing times. */
function eventsOf(steps: readonly Step[]): { event: PollEvent; at: number }[] {
  let at = T0;
  return steps.map((s) => {
    at += s.gap;
    switch (s.kind) {
      case "HIDDEN":
      case "FAILED":
      case "UNAUTHORIZED":
        return { event: { type: s.kind }, at };
      case "OK":
        return { event: { type: "OK", res: s.res, at }, at };
      default:
        return { event: { type: s.kind, at }, at };
    }
  });
}

const fetchesIn = (effects: PollEffect[]) => effects.filter((f) => f.type === "fetch").length;
const schedulesIn = (effects: PollEffect[]) =>
  effects.flatMap((f) => (f.type === "schedule" ? [f.ms] : []));

describe("M18: the Poll loop (owner-machine 12.1, 12.6, 12.7)", () => {
  it("never fetches while hidden or after a 401, keeps every schedule in 5–60 s, and fetches at once when visible", () => {
    let visibleAfterHidden = 0;
    fc.assert(
      fc.property(arbRun, ({ visible, tapeIds, steps }) => {
        const started = startPollLoop({ version: 10, tapeIds, at: T0, visible });
        let s = started[0];
        for (const ms of schedulesIn(started[1])) expect(ms).toBe(5_000);
        let hidden = !visible;
        let locked = false;
        for (const { event } of eventsOf(steps)) {
          const wasHidden = hidden;
          if (event.type === "HIDDEN") hidden = true;
          if (event.type === "VISIBLE") hidden = false;
          const [next, effects] = pollLoop(s, event);
          s = next;

          for (const ms of schedulesIn(effects)) {
            expect(ms).toBeGreaterThanOrEqual(5_000);
            expect(ms).toBeLessThanOrEqual(60_000);
          }
          if (hidden || locked) {
            expect(fetchesIn(effects)).toBe(0);
            if (!locked) expect(schedulesIn(effects)).toEqual([]);
          }
          if (locked) expect(effects).toEqual([]);
          if (event.type === "VISIBLE" && wasHidden && !locked) {
            visibleAfterHidden += 1;
            expect(effects).toContainEqual({ type: "fetch", since: s.version });
          }
          if (event.type === "UNAUTHORIZED" && !locked) {
            expect(effects).toContainEqual({ type: "toGate" });
            locked = true;
          }
          expect(s.phase === "hidden").toBe(hidden && !locked);
        }
      }),
      { numRuns: NUM_RUNS },
    );
    expect(visibleAfterHidden).toBeGreaterThan(0);
  });
});

describe("M19: Idle slowdown (owner-machine 15.8, 12.9)", () => {
  it("schedules backoff while failing, else 30 s exactly when 15 minutes passed with no input or new Message, else 5 s", () => {
    const seen = { idleSchedule: 0, idleInputFetch: 0, newIdWake: 0, backoff: 0 };
    const BACKOFF = [5_000, 10_000, 20_000, 40_000, 60_000];
    fc.assert(
      fc.property(arbRun, ({ visible, tapeIds, steps }) => {
        let [s] = startPollLoop({ version: 10, tapeIds, at: T0, visible });
        // The oracle, recomputed from the sequence itself.
        let lastActivity = T0;
        let known = new Set<string>(tapeIds);
        let maxVersion = 10;
        let failures = 0;
        let hidden = !visible;
        let locked = false;
        let afterIdleInput = false;

        for (const { event, at } of eventsOf(steps)) {
          const [next, effects] = pollLoop(s, event);
          s = next;
          if (locked) continue;
          const scheduled = schedulesIn(effects);

          switch (event.type) {
            case "HIDDEN":
              hidden = true;
              break;
            case "VISIBLE":
              hidden = false;
              break;
            case "UNAUTHORIZED":
              locked = true;
              break;
            case "TICK":
              expect(fetchesIn(effects)).toBe(hidden ? 0 : 1);
              break;
            case "INPUT": {
              const wasIdle = at - lastActivity >= 15 * MIN;
              lastActivity = Math.max(lastActivity, at);
              expect(fetchesIn(effects)).toBe(wasIdle && !hidden ? 1 : 0);
              if (wasIdle && !hidden) {
                seen.idleInputFetch += 1;
                afterIdleInput = true;
              }
              break;
            }
            case "FAILED": {
              failures += 1;
              if (!hidden) {
                expect(scheduled).toEqual([BACKOFF[Math.min(failures, BACKOFF.length) - 1]]);
                seen.backoff += 1;
              }
              break;
            }
            case "OK": {
              failures = 0;
              let woke = false;
              const res = event.res;
              if (res.changed && res.version >= maxVersion) {
                if (res.tape.some((t) => !known.has(t.id))) {
                  lastActivity = Math.max(lastActivity, at);
                  woke = true;
                }
                known = new Set(res.tape.map((t) => t.id));
                maxVersion = res.version;
              }
              if (hidden) {
                expect(scheduled).toEqual([]);
                break;
              }
              const idle = at - lastActivity >= 15 * MIN;
              expect(scheduled).toEqual([idle ? 30_000 : 5_000]);
              if (idle) seen.idleSchedule += 1;
              if (woke) {
                expect(scheduled).toEqual([5_000]);
                seen.newIdWake += 1;
              }
              if (afterIdleInput && !idle) expect(scheduled).toEqual([5_000]);
              afterIdleInput = false;
              break;
            }
          }
          if (event.type !== "OK" && event.type !== "FAILED") expect(scheduled).toEqual([]);
          expect(s.failures).toBe(failures);
        }
      }),
      { numRuns: NUM_RUNS },
    );
    // Every branch of the rule was reached, so the property is not passing vacuously.
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
  });
});

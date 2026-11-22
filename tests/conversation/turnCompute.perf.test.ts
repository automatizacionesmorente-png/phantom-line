import { describe, expect, it } from "vitest";
import { lolaSeedProfile } from "@/lib/db/seed";
import { UTTERANCE_POOL } from "./brain/arbitraries";
import { SAT_1930 } from "./brainCall";
import { CoreCaller, coreHarness, switchModel } from "./coreCall";

/**
 * front-desk-brain 17.4 (Requirement 19.1): the Code_Brain's Reading plus `decideTurn` take under
 * 50 ms of compute per Turn. Measured as the `brain` stage of `handleTurnTimed` (exactly those two,
 * plus `factsFromReading` / `factsFromModel`), on the in-memory repository, so database round trips
 * are not in it (the Latency_Script measures those on the deployed demo, 22.2). The model fails at
 * once (a 503), so a Turn that is not sure still gets the brain's answer and no model time.
 *
 * A shared CI machine can stall one run, so each Turn's number is the median of 5 runs, as the
 * reader's own speed test does (task 6.10). The 50 ms limit itself is not changed.
 */
const shop = lolaSeedProfile;
const LIMIT_MS = 50;
const RUNS = 5;
const REAL_CALL = ["Hola Lola quería cortarme el pelo y hacerme un degradado", "sí", "Me llamo Ana", "612 345 678", "sí"];

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** The `brain` time of each Turn of one Call, in order. */
async function brainTimes(lines: readonly string[]): Promise<number[]> {
  const h = coreHarness({ shops: [shop], now: SAT_1930, model: switchModel({ kind: "503" }) });
  const c = new CoreCaller(h.deps, shop, "es");
  await c.start();
  const out: number[] = [];
  for (const line of lines) {
    const { output, timings } = await c.sayTimed(line);
    out.push(timings.brain);
    if (output.complete) break;
  }
  return out;
}

describe("Reading plus decideTurn stay under 50 ms per Turn (19.1)", () => {
  it("the 50 longest pool utterances, each as the first Turn of a Call", { timeout: 120_000 }, async () => {
    const longest = [...UTTERANCE_POOL].sort((a, b) => b.length - a.length).slice(0, 50);
    expect(longest.length).toBe(Math.min(50, UTTERANCE_POOL.length));
    await brainTimes([longest[0]]); // warm the module caches once, as a running server has them
    const slow: string[] = [];
    for (const u of longest) {
      const runs: number[] = [];
      for (let k = 0; k < RUNS; k++) runs.push((await brainTimes([u]))[0]);
      const m = median(runs);
      if (!(m < LIMIT_MS)) slow.push(`${m.toFixed(1)} ms: ${u}`);
    }
    expect(slow).toEqual([]);
  });

  it("every Turn of the Real_Call_2026_11_16", { timeout: 120_000 }, async () => {
    await brainTimes(REAL_CALL);
    const perTurn: number[][] = REAL_CALL.map(() => []);
    for (let k = 0; k < RUNS; k++) (await brainTimes(REAL_CALL)).forEach((ms, i) => perTurn[i].push(ms));
    expect(perTurn.every((xs) => xs.length === RUNS)).toBe(true); // the Call reached its last Turn every time
    for (const [i, xs] of perTurn.entries()) expect(median(xs), REAL_CALL[i]).toBeLessThan(LIMIT_MS);
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NUM_RUNS, arbCase, REQUEST_DAYS } from "./arbitraries";

const MINUTE = 60_000;
const madridDate = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

// P8. The generators meet the coverage floor of Requirement 9.8.
describe("P8: coverage floor", () => {
  it("every property runs at least 100 requests", () => {
    expect(NUM_RUNS).toBeGreaterThanOrEqual(100);
    // Every property file in this folder uses NUM_RUNS and no smaller literal.
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const files = readdirSync(dir).filter((f) => f.endsWith(".property.test.ts") && !f.startsWith("p8-"));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8");
      const runs = [...src.matchAll(/numRuns:\s*([^\s,}]+)/g)].map((m) => m[1]);
      expect(runs.length, f).toBeGreaterThan(0);
      for (const r of runs) expect(r, f).toBe("NUM_RUNS");
    }
  });

  it("requests are at minute granularity, span at least 7 consecutive days, and hit both DST weekends", () => {
    const cases = fc.sample(arbCase, NUM_RUNS);
    const starts = cases.map((c) => c.req.start.epochMilliseconds);

    // Minute granularity: whole minutes, and not only on a coarser grid.
    for (const s of starts) expect(s % MINUTE).toBe(0);
    expect(starts.some((s) => (s / MINUTE) % 5 !== 0)).toBe(true);

    // At least 7 consecutive days: within one case the offsets span −3 … +21 days,
    // and across the sample the distinct days include a run of 7 consecutive ones.
    expect(REQUEST_DAYS.max - REQUEST_DAYS.min).toBeGreaterThanOrEqual(7);
    const days = [...new Set(starts.map((s) => Math.floor(s / (1440 * MINUTE))))].sort((a, b) => a - b);
    let best = 1;
    let run = 1;
    for (let k = 1; k < days.length; k++) {
      run = days[k] === days[k - 1] + 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    expect(best).toBeGreaterThanOrEqual(7);

    // Both 2026 DST weekends, in Madrid local dates.
    const local = new Set(starts.map(madridDate));
    expect(local.has("2026-03-28") || local.has("2026-03-29")).toBe(true);
    expect(local.has("2026-10-24") || local.has("2026-10-25")).toBe(true);
  });
});

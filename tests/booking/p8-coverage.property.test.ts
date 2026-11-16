import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NUM_RUNS, arbAgendaCase, arbCase, arbDaySlotsCase, arbMoveCase, arbMoveSequence, REQUEST_DAYS } from "./arbitraries";

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

// P8, extended to the owner machine (owner-machine 15.6): M7–M10 run at least 100 cases
// each, and their generators hit both 2026 Madrid DST weekends.
describe("P8: coverage floor for M7–M10", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const files: Record<string, string[]> = {
    "booking/daySlots.property.test.ts": ["M8"],
    "owner/move.property.test.ts": ["M7", "M9"],
    "owner/agenda.property.test.ts": ["M10"],
  };

  it("each property file names its properties and runs NUM_RUNS (≥ 100) cases, no smaller literal", () => {
    expect(NUM_RUNS).toBeGreaterThanOrEqual(100);
    for (const [f, ids] of Object.entries(files)) {
      const src = readFileSync(path.join(root, f), "utf8");
      for (const id of ids) expect(src, f).toContain(`${id}.`);
      const runs = [...src.matchAll(/numRuns:\s*([^\s,}]+)/g)].map((m) => m[1]);
      expect(runs.length, f).toBeGreaterThanOrEqual(ids.length);
      for (const r of runs) expect(r, f).toBe("NUM_RUNS");
    }
  });

  const hitsBothWeekends = (dates: Iterable<string>) => {
    const s = new Set(dates);
    return {
      march: s.has("2026-03-28") || s.has("2026-03-29"),
      october: s.has("2026-10-24") || s.has("2026-10-25"),
    };
  };

  it("M7: move starts are whole minutes and hit both DST weekends", () => {
    const starts = fc.sample(arbMoveCase, NUM_RUNS).map((c) => c.start.epochMilliseconds);
    for (const s of starts) expect(s % MINUTE).toBe(0);
    expect(starts.some((s) => (s / MINUTE) % 5 !== 0)).toBe(true);
    expect(hitsBothWeekends(starts.map(madridDate))).toEqual({ march: true, october: true });
  });

  it("M8: the days listed hit both DST weekends", () => {
    const days = fc.sample(arbDaySlotsCase, NUM_RUNS).map((c) => c.day.toString());
    expect(hitsBothWeekends(days)).toEqual({ march: true, october: true });
  });

  it("M9: the operations' starts hit both DST weekends", () => {
    const starts = fc.sample(arbMoveSequence, NUM_RUNS).flatMap((c) => c.pool.map((p) => madridDate(p.epochMilliseconds)));
    expect(hitsBothWeekends(starts)).toEqual({ march: true, october: true });
  });

  it("M10: the agendas' bookings and windows hit both DST weekends", () => {
    const cases = fc.sample(arbAgendaCase, NUM_RUNS);
    const starts = cases.flatMap((c) => c.rows.map((b) => madridDate(b.start.epochMilliseconds)));
    expect(hitsBothWeekends(starts)).toEqual({ march: true, october: true });
    const nows = cases.map((c) => madridDate(c.now.epochMilliseconds));
    expect(nows.some((d) => d >= "2026-03-22" && d <= "2026-03-29")).toBe(true);
    expect(nows.some((d) => d >= "2026-10-18" && d <= "2026-10-25")).toBe(true);
  });
});

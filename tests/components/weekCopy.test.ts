import { describe, expect, it } from "vitest";
import { formatDuration, formatRevenue, savedFormula } from "@/components/machine/weekCopy";

describe("weekCopy", () => {
  it("formats durations to the minute, never negative", () => {
    expect(formatDuration(0, "en")).toBe("under 1 min");
    expect(formatDuration(-50, "es")).toBe("menos de 1 min");
    expect(formatDuration(42 * 60, "es")).toBe("42 min");
    expect(formatDuration(85 * 60, "en")).toBe("1 h 25 min");
    expect(formatDuration(120 * 60, "en")).toBe("2 h");
  });

  it("formats euros without cents when there are none", () => {
    expect(formatRevenue(12500, "en")).toBe("€125");
    expect(formatRevenue(12550, "en")).toBe("€125.50");
    expect(formatRevenue(12500, "es").replace(/\s/g, " ")).toBe("125 €");
  });

  it("states the time-saved formula with its real inputs, or nothing when it cannot be computed", () => {
    expect(savedFormula({ timeSavedSeconds: null, timedCalls: 0 }, "es")).toBeNull();
    expect(savedFormula({ timeSavedSeconds: 12 * 60, timedCalls: 4 }, "en")).toBe(
      "Time saved = sum of the duration (end minus start) of the 4 finished calls: 12 min, 3 min on average.",
    );
    expect(savedFormula({ timeSavedSeconds: 180, timedCalls: 1 }, "es")).toContain("la llamada terminada");
  });
});

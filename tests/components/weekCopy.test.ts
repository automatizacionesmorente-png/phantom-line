import { describe, expect, it } from "vitest";
import { formatDuration, formatRevenue } from "@/components/machine/weekCopy";

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
});

describe("money grouping and week labels", () => {
  it("groups thousands in Spanish too", () => {
    expect(formatRevenue(121690, "es").replace(/\s/g, " ")).toBe("1.216,90 €");
    expect(formatRevenue(121690, "en")).toBe("€1,216.90");
  });
});

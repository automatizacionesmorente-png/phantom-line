import { describe, expect, it } from "vitest";
import { COMPACT_PX, isCompact, PX_PER_HOUR, STATE_STYLE, TINTS, tintFor } from "@/components/machine/today/dayBookStyle";

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("day book tints", () => {
  it("has six distinct tints and ink text passes AA on each fill", () => {
    expect(new Set(TINTS.map((t) => t.fill)).size).toBe(6);
    for (const t of TINTS) expect(ratio("#14110c", t.fill)).toBeGreaterThanOrEqual(4.5);
  });
  it("gives the hair-salon categories different tints", () => {
    const names = ["cortes", "color", "peinados", "tratamientos", "barba", "unas"].map((c) => tintFor(c).name);
    expect(new Set(names).size).toBe(6);
  });
  it("is stable for unknown categories", () => {
    expect(tintFor("zzz")).toBe(tintFor("zzz"));
    expect(tintFor(undefined)).toBe(TINTS[0]);
  });
  it("chip text passes AA on its background", () => {
    expect(ratio("#2b4a22", "#d9e8cf")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#6b665e", "#f5efe4")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("compact blocks", () => {
  it("20 minutes is compact, 45 is not", () => {
    expect(isCompact(600, 620)).toBe(true);
    expect(isCompact(600, 645)).toBe(false);
    expect((20 / 60) * PX_PER_HOUR).toBeLessThan(COMPACT_PX);
  });
  it("only confirmed has no chip; done has a check; no-show strikes", () => {
    expect(STATE_STYLE.confirmed.chip).toBeNull();
    expect(STATE_STYLE.done.icon).toBe("check");
    expect(STATE_STYLE.no_show.strike).toBe(true);
    expect(STATE_STYLE.pending.chip).toContain("border-gold-text");
  });
});

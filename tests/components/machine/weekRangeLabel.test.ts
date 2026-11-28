import { describe, expect, it } from "vitest";
import { weekRangeLabel } from "@/components/machine/business/businessCopy";

describe("weekRangeLabel", () => {
  it("adds the month abbreviation and an en dash", () => {
    expect(weekRangeLabel("2-8", "2026-11", "es")).toBe("Sem. 2–8 nov");
    expect(weekRangeLabel("30", "2026-11", "es")).toBe("Sem. 30 nov");
    expect(weekRangeLabel("2-8", "2026-11", "en")).toBe("Wk 2–8 Nov");
  });
});

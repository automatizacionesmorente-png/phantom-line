import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";

describe("Temporal from temporal-polyfill", () => {
  it("Temporal.Now.instant() runs under Vitest without a global", () => {
    expect(Temporal.Now.instant()).toBeInstanceOf(Temporal.Instant);
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_LIMITS, checkLimits, limitsFromEnv } from "@/lib/conversation/limits";

describe("checkLimits", () => {
  const config = { perVisitorPerMinute: 12, globalPerHour: 200 };
  it("the 12th Turn in a minute is allowed, the 13th is blocked", () => {
    expect(checkLimits({ visitor: 12, global: 50 }, config)).toEqual({ blocked: false });
    expect(checkLimits({ visitor: 13, global: 50 }, config)).toEqual({ blocked: true, limit: "visitor" });
  });
  it("the global hourly cap blocks too", () => {
    expect(checkLimits({ visitor: 1, global: 200 }, config)).toEqual({ blocked: false });
    expect(checkLimits({ visitor: 1, global: 201 }, config)).toEqual({ blocked: true, limit: "global" });
  });
  it("limits come from the environment, with defaults 12 and 200", () => {
    expect(limitsFromEnv({})).toEqual(DEFAULT_LIMITS);
    expect(DEFAULT_LIMITS).toEqual({ perVisitorPerMinute: 12, globalPerHour: 200 });
    expect(limitsFromEnv({ TURN_LIMIT_PER_VISITOR_PER_MINUTE: "5", TURN_LIMIT_GLOBAL_PER_HOUR: " 900 " })).toEqual({
      perVisitorPerMinute: 5,
      globalPerHour: 900,
    });
    expect(limitsFromEnv({ TURN_LIMIT_PER_VISITOR_PER_MINUTE: "abc", TURN_LIMIT_GLOBAL_PER_HOUR: "0" })).toEqual(DEFAULT_LIMITS);
  });
});

// S6. checkLimits blocks exactly when a count is over its configured limit. Validates 3.9.
describe("S6: checkLimits", () => {
  it("blocks exactly when visitor > perVisitorPerMinute or global > globalPerHour", () => {
    fc.assert(
      fc.property(
        fc.record({ visitor: fc.nat({ max: 1000 }), global: fc.nat({ max: 100_000 }) }),
        fc.record({ perVisitorPerMinute: fc.integer({ min: 1, max: 1000 }), globalPerHour: fc.integer({ min: 1, max: 100_000 }) }),
        (counts, config) => {
          const d = checkLimits(counts, config);
          const over = counts.visitor > config.perVisitorPerMinute || counts.global > config.globalPerHour;
          expect(d.blocked).toBe(over);
          if (d.blocked) {
            expect(d.limit === "visitor" ? counts.visitor > config.perVisitorPerMinute : counts.global > config.globalPerHour).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

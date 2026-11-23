import { describe, expect, it } from "vitest";
import { rateLimitSalt } from "@/app/api/visitorKey";
import { checkLimits, DEFAULT_LIMITS, limitsFromEnv } from "@/lib/conversation/limits";
import { checkTtsLimits, DEFAULT_TTS_LIMITS, ttsLimitsFromEnv } from "@/lib/conversation/ttsLimits";
import nextConfig from "@/next.config";

// Security audit of 23 Nov 2026, before the repo goes public. (Written by Claude.)
describe("RATE_LIMIT_SALT is required", () => {
  it("throws when missing or short, so Visitor keys are never an unsalted hash of the IP", () => {
    expect(() => rateLimitSalt({})).toThrow();
    expect(() => rateLimitSalt({ RATE_LIMIT_SALT: "" })).toThrow();
    expect(() => rateLimitSalt({ RATE_LIMIT_SALT: "short" })).toThrow();
    expect(rateLimitSalt({ RATE_LIMIT_SALT: "a-long-enough-salt" })).toBe("a-long-enough-salt");
  });
});

describe("one visitor cannot take the whole global quota", () => {
  it("blocks the 61st Turn of a visitor in an hour, even under the per-minute and global caps", () => {
    expect(checkLimits({ visitor: 1, visitorHour: 60, global: 100 }, DEFAULT_LIMITS)).toEqual({ blocked: false });
    expect(checkLimits({ visitor: 1, visitorHour: 61, global: 100 }, DEFAULT_LIMITS)).toEqual({ blocked: true, limit: "visitor" });
    expect(limitsFromEnv({ TURN_LIMIT_PER_VISITOR_PER_HOUR: "5" }).perVisitorPerHour).toBe(5);
  });

  it("blocks the 11th neural-voice line of a visitor in a day, below the global 30", () => {
    expect(checkTtsLimits({ visitor: 1, visitorDay: 10, hour: 1, day: 10 }, DEFAULT_TTS_LIMITS)).toEqual({ blocked: false });
    expect(checkTtsLimits({ visitor: 1, visitorDay: 11, hour: 1, day: 11 }, DEFAULT_TTS_LIMITS)).toEqual({ blocked: true, limit: "visitor" });
    expect(ttsLimitsFromEnv({ TTS_LIMIT_PER_VISITOR_PER_DAY: "3" }).perVisitorPerDay).toBe(3);
  });
});

describe("security headers", () => {
  it("forbid framing and sniffing on every path, and allow the microphone only for the site", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!;
    const h = Object.fromEntries(all.headers.map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(h["Permissions-Policy"]).toContain("microphone=(self)");
  });
});

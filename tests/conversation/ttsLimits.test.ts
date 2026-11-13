import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
  checkTtsLimits,
  DEFAULT_TTS_LIMITS,
  exhaustedNow,
  modelsToTry,
  nextQuotaReset,
  pickTtsModel,
  quotaDayStart,
  ttsExhaustedKey,
  ttsLimitsFromEnv,
} from "@/lib/conversation/ttsLimits";

/** Task 8.3: TTS limits, model choice and the midnight-Pacific reset. N13 is in ttsLimits.property.test.ts. */

const I = (s: string) => Temporal.Instant.from(s);

describe("checkTtsLimits", () => {
  it("the defaults: 12 per visitor per minute, 20 an hour, 30 a day, each count including this request", () => {
    expect(DEFAULT_TTS_LIMITS).toEqual({ perVisitorPerMinute: 12, globalPerHour: 20, globalPerDay: 30 });
    expect(checkTtsLimits({ visitor: 12, hour: 20, day: 30 }, DEFAULT_TTS_LIMITS)).toEqual({ blocked: false });
    expect(checkTtsLimits({ visitor: 13, hour: 1, day: 1 }, DEFAULT_TTS_LIMITS)).toEqual({ blocked: true, limit: "visitor" });
    expect(checkTtsLimits({ visitor: 1, hour: 21, day: 1 }, DEFAULT_TTS_LIMITS)).toEqual({ blocked: true, limit: "hour" });
    expect(checkTtsLimits({ visitor: 1, hour: 1, day: 31 }, DEFAULT_TTS_LIMITS)).toEqual({ blocked: true, limit: "day" });
  });

  it("reads the caps from the environment, and ignores bad values", () => {
    expect(
      ttsLimitsFromEnv({ TTS_LIMIT_PER_VISITOR_PER_MINUTE: "5", TTS_LIMIT_GLOBAL_PER_HOUR: " 8 ", TTS_LIMIT_GLOBAL_PER_DAY: "16" }),
    ).toEqual({ perVisitorPerMinute: 5, globalPerHour: 8, globalPerDay: 16 });
    expect(ttsLimitsFromEnv({ TTS_LIMIT_PER_VISITOR_PER_MINUTE: "0", TTS_LIMIT_GLOBAL_PER_HOUR: "-3", TTS_LIMIT_GLOBAL_PER_DAY: "lots" })).toEqual(
      DEFAULT_TTS_LIMITS,
    );
    expect(ttsLimitsFromEnv({})).toEqual(DEFAULT_TTS_LIMITS);
  });
});

describe("the quota day (midnight Pacific)", () => {
  it("in winter (PST, UTC−8): the reset is 08:00 UTC, 09:00 in Madrid, as the spike's 429 said", () => {
    // 22:39:35 UTC on 12 November 2026, the time of the spike's "retry in 9h20m25s".
    const now = I("2026-11-12T22:39:35Z");
    expect(nextQuotaReset(now).toString()).toBe("2026-11-13T08:00:00Z");
    expect(nextQuotaReset(now).since(now).total("seconds")).toBe(9 * 3600 + 20 * 60 + 25);
    expect(quotaDayStart(now).toString()).toBe("2026-11-12T08:00:00Z");
  });

  it("in summer (PDT, UTC−7): the reset is 07:00 UTC", () => {
    expect(nextQuotaReset(I("2026-07-01T12:00:00Z")).toString()).toBe("2026-07-02T07:00:00Z");
  });

  it("across the 2026 US daylight-saving changes (8 March and 1 November)", () => {
    // 7 March 23:00 PST → the next midnight is 8 March 00:00 PST (08:00 UTC); the day then has 23 hours.
    expect(nextQuotaReset(I("2026-03-08T07:00:00Z")).toString()).toBe("2026-03-08T08:00:00Z");
    expect(nextQuotaReset(I("2026-03-08T08:00:00Z")).toString()).toBe("2026-03-09T07:00:00Z");
    // 1 November has 25 hours: from 00:00 PDT (07:00 UTC) to 00:00 PST on 2 November (08:00 UTC).
    expect(nextQuotaReset(I("2026-11-01T07:00:00Z")).toString()).toBe("2026-11-02T08:00:00Z");
    expect(quotaDayStart(I("2026-11-02T07:30:00Z")).toString()).toBe("2026-11-01T07:00:00Z");
  });

  it("exactly at midnight Pacific, the reset is the next midnight, never now", () => {
    const midnight = I("2026-11-13T08:00:00Z");
    expect(nextQuotaReset(midnight).toString()).toBe("2026-11-14T08:00:00Z");
    expect(quotaDayStart(midnight).toString()).toBe(midnight.toString());
  });
});

describe("model choice", () => {
  const models = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview"];

  it("keeps the configured order and skips exhausted models", () => {
    expect(pickTtsModel(models, new Set())).toBe("gemini-3.8-flash-tts");
    expect(pickTtsModel(models, new Set(["gemini-3.8-flash-tts"]))).toBe("gemini-3.8-flash-lite-tts");
    expect(modelsToTry(models, new Set(["gemini-3.8-flash-lite-tts"]))).toEqual(["gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview"]);
    expect(pickTtsModel(models, new Set(models))).toBeNull();
  });

  it("merges this process's marks with the shared rows, and drops marks whose reset has passed", () => {
    const now = I("2026-11-13T10:00:00Z");
    const memory = new Map([
      ["a", now.add({ hours: 1 }).epochMilliseconds],
      ["b", now.epochMilliseconds],
    ]);
    expect([...exhaustedNow(memory, ["c"], now)].sort()).toEqual(["a", "c"]);
  });

  it("the shared row key", () => {
    expect(ttsExhaustedKey("gemini-3.8-flash-tts")).toBe("tts-exhausted:gemini-3.8-flash-tts");
  });
});

import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { DEFAULT_PIN_LIMITS, checkPinAttempts, pinCounterKeys, pinLimitsFromEnv } from "@/lib/owner/limits";

const at = (s: string) => Temporal.Instant.from(s);
/** Temporal objects have no own enumerable keys, so toEqual would call any two Instants equal: compare ISO text. */
const keys = (shopId: string, visitor: string, now: string, demo: boolean) =>
  pinCounterKeys(shopId, visitor, at(now), demo).map((k) => ({ key: k.key, windowStart: k.windowStart.toString() }));

describe("pinLimitsFromEnv", () => {
  it("defaults are 5 per Visitor per 15 minutes and 30 per Shop per hour", () => {
    expect(DEFAULT_PIN_LIMITS).toEqual({ perVisitorPer15Min: 5, perShopPerHour: 30 });
    expect(pinLimitsFromEnv({})).toEqual({ perVisitorPer15Min: 5, perShopPerHour: 30 });
  });

  it("reads both limits from the environment", () => {
    expect(pinLimitsFromEnv({ PIN_LIMIT_PER_VISITOR_PER_15MIN: "3", PIN_LIMIT_PER_SHOP_PER_HOUR: " 100 " })).toEqual({
      perVisitorPer15Min: 3,
      perShopPerHour: 100,
    });
  });

  it("malformed values fall back to 5 and 30", () => {
    for (const bad of ["", " ", "0", "-1", "2.5", "1e3", "abc", "5 tries", "0x10", "9999999999"]) {
      expect(pinLimitsFromEnv({ PIN_LIMIT_PER_VISITOR_PER_15MIN: bad, PIN_LIMIT_PER_SHOP_PER_HOUR: bad })).toEqual({
        perVisitorPer15Min: 5,
        perShopPerHour: 30,
      });
    }
  });
});

describe("checkPinAttempts", () => {
  const cfg = DEFAULT_PIN_LIMITS;
  it("counts include this attempt: the 5th is allowed, the 6th blocked", () => {
    expect(checkPinAttempts({ visitor: 5, shop: 5 }, cfg)).toEqual({ blocked: false });
    expect(checkPinAttempts({ visitor: 6, shop: 6 }, cfg)).toEqual({ blocked: true, limit: "visitor" });
  });
  it("the shop cap blocks the 31st attempt of the hour", () => {
    expect(checkPinAttempts({ visitor: 1, shop: 30 }, cfg)).toEqual({ blocked: false });
    expect(checkPinAttempts({ visitor: 1, shop: 31 }, cfg)).toEqual({ blocked: true, limit: "shop" });
  });
  it("the visitor limit is reported first", () => {
    expect(checkPinAttempts({ visitor: 6, shop: 31 }, cfg)).toEqual({ blocked: true, limit: "visitor" });
  });
  it("the Demo_Shop has no shop count", () => {
    expect(checkPinAttempts({ visitor: 5, shop: null }, cfg)).toEqual({ blocked: false });
    expect(checkPinAttempts({ visitor: 6, shop: null }, cfg)).toEqual({ blocked: true, limit: "visitor" });
  });
});

describe("pinCounterKeys", () => {
  it("a Real_Shop gets the visitor key on a 15-minute window and the shop key on a 1-hour window", () => {
    expect(keys("barberia-paco", "vk", "2026-11-16T10:44:59.999Z", false)).toEqual([
      { key: "pin:v:barberia-paco:vk", windowStart: "2026-11-16T10:30:00Z" },
      { key: "pin:s:barberia-paco", windowStart: "2026-11-16T10:00:00Z" },
    ]);
  });

  it("windows start exactly on 15-minute and hour boundaries", () => {
    expect(keys("x", "vk", "2026-11-16T10:45:00Z", false).map((k) => k.windowStart)).toEqual([
      "2026-11-16T10:45:00Z",
      "2026-11-16T10:00:00Z",
    ]);
    expect(keys("x", "vk", "2026-11-16T11:00:00Z", false).map((k) => k.windowStart)).toEqual([
      "2026-11-16T11:00:00Z",
      "2026-11-16T11:00:00Z",
    ]);
    expect(keys("x", "vk", "2026-11-16T10:59:59.999Z", false).map((k) => k.windowStart)).toEqual([
      "2026-11-16T10:45:00Z",
      "2026-11-16T10:00:00Z",
    ]);
    expect(keys("x", "vk", "2026-11-16T10:14:59.999Z", false).map((k) => k.windowStart)).toEqual([
      "2026-11-16T10:00:00Z",
      "2026-11-16T10:00:00Z",
    ]);
  });

  it("windows are in UTC, so a zone with a half-hour offset does not move them", () => {
    // 15:50 in Asia/Kolkata is 10:20 UTC; the hour window starts at 10:00 UTC, not 15:00 local.
    expect(keys("x", "vk", "2026-11-16T15:50:00+05:30", false).map((k) => k.windowStart)).toEqual([
      "2026-11-16T10:15:00Z",
      "2026-11-16T10:00:00Z",
    ]);
  });

  it("the Demo_Shop gets only the visitor key", () => {
    expect(keys("peluqueria-lola", "vk", "2026-11-16T10:44:00Z", true)).toEqual([
      { key: "pin:v:peluqueria-lola:vk", windowStart: "2026-11-16T10:30:00Z" },
    ]);
  });
});

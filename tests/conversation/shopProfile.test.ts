import { describe, expect, it } from "vitest";
import { ShopProfileSchema, toShopRules } from "@/lib/conversation/shopProfile";
import { ModelTurnSchema, modelTurnJsonSchema } from "@/lib/receptionist/schema";
import { lolaProfile } from "../fixtures/lola";

describe("ShopProfileSchema", () => {
  it("accepts the Lola profile from design.md", () => {
    expect(ShopProfileSchema.safeParse(lolaProfile).success).toBe(true);
  });
  it("Lola: Tue–Sat 10–14 and 17–20, three services, two chairs, hair-salon pack", () => {
    const rules = toShopRules(lolaProfile);
    expect(Object.keys(rules.hours).sort()).toEqual(["2", "3", "4", "5", "6"]);
    expect(rules.services).toEqual([
      { id: "haircut", durationMin: 30 },
      { id: "colour", durationMin: 90 },
      { id: "beard", durationMin: 20 },
    ]);
    expect(lolaProfile.services.map((s) => s.priceCents)).toEqual([1500, 4500, 1000]);
    expect(rules.resources.map((r) => r.id)).toEqual(["chair-1", "chair-2"]);
    expect(lolaProfile.sectorPackId).toBe("hair-salon");
  });
  it("rejects unknown keys, a bad time zone, overlapping sessions and open >= close", () => {
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, extra: 1 }).success).toBe(false);
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, timeZone: "Mars/Olympus" }).success).toBe(false);
    const overlapping = { 2: [{ open: "10:00", close: "14:00" }, { open: "13:00", close: "20:00" }] };
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, hours: overlapping }).success).toBe(false);
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, hours: { 2: [{ open: "14:00", close: "10:00" }] } }).success).toBe(false);
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, services: [] }).success).toBe(false);
  });
});

/** natural-voice 3.2 and 3.5: the new fields are optional, so stored profiles stay valid. */
describe("ShopProfileSchema: spokenName and speechRate", () => {
  // A profile as core-call-loop stored it: no spokenName, no voice, no speechRate.
  const { speechRate: _rate, ...rest } = lolaProfile;
  void _rate;
  const storedProfile = {
    ...rest,
    services: lolaProfile.services.map(({ spokenName: _s, ...s }) => {
      void _s;
      return s;
    }),
  };

  it("an existing stored profile without the new fields stays valid, and reads speechRate as 1.0", () => {
    expect(Object.keys(storedProfile)).not.toContain("speechRate");
    expect(storedProfile.services.every((s) => !("spokenName" in s))).toBe(true);
    const parsed = ShopProfileSchema.parse(storedProfile);
    expect(parsed.speechRate).toBe(1);
    expect(parsed.voice).toBeUndefined();
    expect(parsed.services.map((s) => s.spokenName)).toEqual([undefined, undefined, undefined]);
  });

  it("Lola's spoken names carry their article in both languages", () => {
    expect(lolaProfile.services.map((s) => s.spokenName)).toEqual([
      { es: "un corte", en: "a haircut" },
      { es: "un tinte", en: "a colour" },
      { es: "un arreglo de barba", en: "a beard trim" },
    ]);
  });

  it("a spokenName needs both languages, not empty, and no extra keys", () => {
    const withName = (spokenName: unknown) => ({
      ...lolaProfile,
      services: [{ ...lolaProfile.services[0], spokenName }, ...lolaProfile.services.slice(1)],
    });
    expect(ShopProfileSchema.safeParse(withName({ es: "un corte" })).success).toBe(false);
    expect(ShopProfileSchema.safeParse(withName({ es: "", en: "a haircut" })).success).toBe(false);
    expect(ShopProfileSchema.safeParse(withName({ es: "un corte", en: "a haircut", fr: "une coupe" })).success).toBe(false);
  });

  it("speechRate: the default is 1.0, both bounds are valid, and values outside them fail", () => {
    const withRate = (speechRate: unknown) => ShopProfileSchema.safeParse({ ...storedProfile, speechRate });
    expect(withRate(undefined).data?.speechRate).toBe(1);
    expect(withRate(0.8).data?.speechRate).toBe(0.8);
    expect(withRate(1.25).data?.speechRate).toBe(1.25);
    expect(withRate(1.1).data?.speechRate).toBe(1.1);
    for (const bad of [0.79, 0.7999, 1.2501, 1.3, 0, -1, 2, Number.NaN, Number.POSITIVE_INFINITY, "1.1", null]) {
      expect(withRate(bad).success, String(bad)).toBe(false);
    }
  });

  it("one speechRate per shop, for both languages: a per-language object fails", () => {
    expect(ShopProfileSchema.safeParse({ ...storedProfile, speechRate: { es: 1.1, en: 1 } }).success).toBe(false);
  });

  it("Lola plays at 1.1 (pace option 2 while option 1 waits for quota)", () => {
    expect(ShopProfileSchema.parse(lolaProfile).speechRate).toBe(1.1);
  });
});

describe("ModelTurnSchema", () => {
  const valid = {
    reply: "Hola, ¿en qué te ayudo?",
    language: "es",
    wantsLanguage: null,
    intent: "other",
    name: null,
    phone: null,
    service: null,
    date: null,
    time: null,
    callerConfirmed: false,
    callerWantsToEnd: false,
    outOfProfile: false,
    reason: "Saluda",
    urgency: "normal",
  };
  it("accepts a turn with null fields and rejects extra keys", () => {
    expect(ModelTurnSchema.safeParse(valid).success).toBe(true);
    expect(ModelTurnSchema.safeParse({ ...valid, accepted: true }).success).toBe(false);
    expect(ModelTurnSchema.safeParse({ ...valid, time: "25:00" }).success).toBe(false);
  });
  it("the JSON Schema uses the nullable form task 1.5 confirmed (anyOf with null)", () => {
    const props = (modelTurnJsonSchema as { properties: Record<string, { anyOf?: { type: string }[] }> }).properties;
    expect(props.name.anyOf?.map((x) => x.type)).toEqual(["string", "null"]);
  });
});

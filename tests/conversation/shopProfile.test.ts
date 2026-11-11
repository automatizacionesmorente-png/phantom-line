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

import { describe, expect, it } from "vitest";
import { ShopProfileSchema } from "@/lib/conversation/shopProfile";
import { lolaSeedProfile } from "@/lib/db/seed";
import { VoiceProfileSchema, resolveVoiceProfile } from "@/lib/receptionist/voiceProfile";
import { SectorPackDataSchema, hairSalon, type SectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

/** Task 3.3 and 3.6 of natural-voice: the Voice_Profile, the shop override, and Lola's voice. */
const STYLE_ES = "Una peluquera simpática de Madrid, relajada, a ritmo natural y sonriendo.";

describe("resolveVoiceProfile", () => {
  it("with no override, it is the pack's profile, with the pack's language code", () => {
    expect(resolveVoiceProfile(hairSalon, {}, "es")).toEqual({
      voice: "es-es-commercial-3",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: STYLE_ES,
    });
    expect(resolveVoiceProfile(hairSalon, {}, "en")).toEqual(hairSalon.voice.en);
    expect(resolveVoiceProfile(hairSalon, {}, "en").languageCode).toBe("en-US");
  });

  it("Lola's seed and the test fixture use the pack's Spanish voice: es-es-commercial-3 with Kore", () => {
    for (const shop of [lolaSeedProfile, lolaProfile]) {
      const es = resolveVoiceProfile(hairSalon, shop, "es");
      expect(es.voice).toBe("es-es-commercial-3");
      expect(es.classicVoice).toBe("Kore");
      expect(es.languageCode).toBe("es-ES");
    }
  });

  it("the override wins, field by field, and the other fields stay the pack's", () => {
    expect(resolveVoiceProfile(hairSalon, { voice: { es: { voice: "es-es-techagent-5" } } }, "es")).toEqual({
      voice: "es-es-techagent-5",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: STYLE_ES,
    });
    expect(resolveVoiceProfile(hairSalon, { voice: { es: { classicVoice: "Aoede" } } }, "es")).toEqual({
      voice: "es-es-commercial-3",
      classicVoice: "Aoede",
      languageCode: "es-ES",
      style: STYLE_ES,
    });
    expect(resolveVoiceProfile(hairSalon, { voice: { es: { style: "Muy tranquila." } } }, "es")).toEqual({
      voice: "es-es-commercial-3",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: "Muy tranquila.",
    });
    const all = { voice: "Puck", classicVoice: "Puck", style: "Cheerful." };
    expect(resolveVoiceProfile(hairSalon, { voice: { en: all } }, "en")).toEqual({ ...all, languageCode: "en-US" });
  });

  it("an override for one language never touches the other", () => {
    const shop = { voice: { en: { voice: "Achird", style: "Warm." } } };
    expect(resolveVoiceProfile(hairSalon, shop, "es")).toEqual(hairSalon.voice.es);
    expect(resolveVoiceProfile(hairSalon, shop, "en").voice).toBe("Achird");
  });

  it("validates the merged result: a broken pack profile throws instead of reaching the TTS model", () => {
    const broken: SectorPack = { ...hairSalon, voice: { ...hairSalon.voice, es: { ...hairSalon.voice.es, voice: "" } } };
    expect(() => resolveVoiceProfile(broken, {}, "es")).toThrow();
    const longStyle: SectorPack = {
      ...hairSalon,
      voice: { ...hairSalon.voice, es: { ...hairSalon.voice.es, style: "a".repeat(201) } },
    };
    expect(() => resolveVoiceProfile(longStyle, {}, "es")).toThrow();
  });
});

describe("VoiceProfileSchema", () => {
  const ok = hairSalon.voice.es;

  it("accepts the hair-salon profiles", () => {
    expect(VoiceProfileSchema.safeParse(hairSalon.voice.es).success).toBe(true);
    expect(VoiceProfileSchema.safeParse(hairSalon.voice.en).success).toBe(true);
  });

  it("rejects an invalid voice id", () => {
    for (const voice of ["", " Kore", "Kore ", "es es commercial", "Kore;drop", "3kore", "<Kore>", "a".repeat(65)]) {
      expect(VoiceProfileSchema.safeParse({ ...ok, voice }).success, JSON.stringify(voice)).toBe(false);
      expect(VoiceProfileSchema.safeParse({ ...ok, classicVoice: voice }).success, JSON.stringify(voice)).toBe(false);
    }
  });

  it("a style of 200 characters is valid; 201, empty or blank fails", () => {
    expect(VoiceProfileSchema.safeParse({ ...ok, style: "a".repeat(200) }).success).toBe(true);
    expect(VoiceProfileSchema.safeParse({ ...ok, style: "a".repeat(201) }).success).toBe(false);
    expect(VoiceProfileSchema.safeParse({ ...ok, style: "" }).success).toBe(false);
    expect(VoiceProfileSchema.safeParse({ ...ok, style: "   " }).success).toBe(false);
  });

  it("rejects an unknown language code and extra keys", () => {
    expect(VoiceProfileSchema.safeParse({ ...ok, languageCode: "es-MX" }).success).toBe(false);
    expect(VoiceProfileSchema.safeParse({ ...ok, speakingRate: 1.1 }).success).toBe(false);
  });

  it("the pack schema rejects a missing language, a mismatched language code and a bad voice", () => {
    const { rules: _rules, ...data } = hairSalon;
    void _rules;
    expect(SectorPackDataSchema.safeParse(data).success).toBe(true);
    expect(SectorPackDataSchema.safeParse({ ...data, voice: { es: data.voice.es } }).success).toBe(false);
    expect(
      SectorPackDataSchema.safeParse({ ...data, voice: { es: data.voice.en, en: data.voice.en } }).success,
    ).toBe(false);
    expect(
      SectorPackDataSchema.safeParse({ ...data, voice: { ...data.voice, en: { ...data.voice.en, style: "x".repeat(201) } } })
        .success,
    ).toBe(false);
  });
});

describe("ShopProfileSchema voice override", () => {
  it("accepts a partial override per language", () => {
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, voice: { es: { style: "Tranquila." } } }).success).toBe(true);
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, voice: { en: {} } }).success).toBe(true);
  });

  it("rejects an invalid voice, a style over 200 characters, a language code and unknown languages", () => {
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, voice: { es: { voice: "no spaces" } } }).success).toBe(false);
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, voice: { es: { classicVoice: "" } } }).success).toBe(false);
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, voice: { es: { style: "a".repeat(201) } } }).success).toBe(false);
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, voice: { es: { languageCode: "en-US" } } }).success).toBe(false);
    expect(ShopProfileSchema.safeParse({ ...lolaProfile, voice: { fr: { voice: "Kore" } } }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SectorPackDataSchema, VoiceProfileSchema, allSectorPacks, getSectorPack, hairSalon, term } from "@/lib/sectors";
import { NUM_RUNS, PACKS, arbCase } from "../booking/arbitraries";

const stringsOf = (v: unknown): string[] =>
  typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(stringsOf) : [];

describe("sector pack registry", () => {
  it("every pack passes SectorPackDataSchema and has only function rules", () => {
    expect(allSectorPacks().length).toBeGreaterThan(0);
    for (const pack of allSectorPacks()) {
      const { rules, ...data } = pack;
      expect(SectorPackDataSchema.safeParse(data).success, pack.id).toBe(true);
      for (const r of rules) expect(typeof r).toBe("function");
    }
  });

  it("the schema rejects a broken pack", () => {
    const { rules: _rules, ...data } = hairSalon;
    void _rules;
    expect(SectorPackDataSchema.safeParse({ ...data, slotStepMin: 0 }).success).toBe(false);
    expect(SectorPackDataSchema.safeParse({ ...data, requiredFields: ["service", "service"] }).success).toBe(false);
    expect(SectorPackDataSchema.safeParse({ ...data, vocabulary: { es: data.vocabulary.es } }).success).toBe(false);
    expect(SectorPackDataSchema.safeParse({ ...data, extra: true }).success).toBe(false);
  });

  it("an unknown id throws", () => {
    expect(() => getSectorPack("pet-groomer")).toThrow(/Unknown sector pack/);
  });

  it("term() looks up the vocabulary", () => {
    expect(term(getSectorPack("hair-salon"), "es", "booking")).toBe("cita");
    expect(term(getSectorPack("hair-salon"), "en", "booking")).toBe("appointment");
    expect(term(getSectorPack("hair-salon"), "es", "place")).toBe("la peluquería");
    expect(term(getSectorPack("hair-salon"), "en", "place")).toBe("the salon");
  });

  it("every pack has a valid Voice_Profile per language, with the matching language code", () => {
    for (const pack of allSectorPacks()) {
      expect(VoiceProfileSchema.safeParse(pack.voice.es).success, pack.id).toBe(true);
      expect(VoiceProfileSchema.safeParse(pack.voice.en).success, pack.id).toBe(true);
      expect(pack.voice.es.languageCode).toBe("es-ES");
      expect(pack.voice.en.languageCode).toBe("en-US");
    }
  });

  it("the schema rejects a pack without a place word", () => {
    const { rules: _rules, ...data } = hairSalon;
    void _rules;
    const { place: _place, ...esNoPlace } = data.vocabulary.es;
    void _place;
    expect(SectorPackDataSchema.safeParse({ ...data, vocabulary: { ...data.vocabulary, es: esNoPlace } }).success).toBe(false);
    expect(SectorPackDataSchema.safeParse({ ...data, vocabulary: { ...data.vocabulary, en: { ...data.vocabulary.en, place: "" } } }).success).toBe(false);
  });

  it("the property tests run over every pack in the registry", () => {
    expect(PACKS.map((p) => p.id).sort()).toEqual(allSectorPacks().map((p) => p.id).sort());
    const seen = new Set(fc.sample(arbCase, NUM_RUNS).map((c) => c.packId));
    for (const p of allSectorPacks()) expect(seen.has(p.id), p.id).toBe(true);
  });
});

describe("hair-salon pack", () => {
  it("is an appointment on a chair, asking service → time → name → phone, on a 15-minute grid", () => {
    expect(hairSalon.unit).toBe("appointment");
    expect(hairSalon.resourceKind.es.one).toBe("sillón");
    expect(hairSalon.resourceKind.en.one).toBe("chair");
    expect(hairSalon.requiredFields).toEqual(["service", "requestedTime", "name", "phone"]);
    expect(hairSalon.slotStepMin).toBe(15);
    expect(hairSalon.rules).toEqual([]);
  });

  it("the Spanish vocabulary says cita and never mesa", () => {
    const es = [
      ...stringsOf(hairSalon.vocabulary.es),
      ...stringsOf(hairSalon.resourceKind.es),
      ...stringsOf(hairSalon.sensitiveTopics.es),
      ...stringsOf(hairSalon.neverPromise.es),
    ].join(" ");
    expect(es).toMatch(/\bcita\b/);
    expect(es.toLowerCase()).not.toMatch(/\bmesas?\b/);
    expect(stringsOf(hairSalon.vocabulary.en).join(" ").toLowerCase()).not.toMatch(/\btables?\b/);
  });

  it("lists sensitive topics and things it must never promise in both languages", () => {
    for (const lang of ["es", "en"] as const) {
      expect(hairSalon.sensitiveTopics[lang].length).toBeGreaterThan(0);
      expect(hairSalon.neverPromise[lang].length).toBeGreaterThan(0);
    }
  });
});

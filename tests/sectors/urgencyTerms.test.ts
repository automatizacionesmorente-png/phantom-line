import { describe, expect, it } from "vitest";
import { SectorPackDataSchema, allSectorPacks, hairSalon, term } from "@/lib/sectors";

const dataOf = () => {
  const { rules: _rules, ...data } = hairSalon;
  void _rules;
  return data;
};
const withEs = (es: Partial<(typeof hairSalon.vocabulary)["es"]>) => {
  const data = dataOf();
  return { ...data, vocabulary: { ...data.vocabulary, es: { ...data.vocabulary.es, ...es } } };
};

describe("Urgency_Terms in the sector packs (owner-machine 5.2, 5.12)", () => {
  it("every pack still passes the schema, with urgent and today terms in every language", () => {
    for (const pack of allSectorPacks()) {
      const { rules: _rules, ...data } = pack;
      void _rules;
      const parsed = SectorPackDataSchema.safeParse(data);
      expect(parsed.success, `${pack.id}: ${parsed.error?.message}`).toBe(true);
      for (const lang of ["es", "en"] as const) {
        expect(pack.vocabulary[lang].urgent.length, `${pack.id} ${lang}`).toBeGreaterThan(0);
        expect(pack.vocabulary[lang].today.length, `${pack.id} ${lang}`).toBeGreaterThan(0);
      }
    }
  });

  it("a duplicate term after normalization fails (\"Alergia\", \"alergia\")", () => {
    const r = SectorPackDataSchema.safeParse(withEs({ urgent: [...hairSalon.vocabulary.es.urgent, "Alergia"] }));
    expect(r.success).toBe(false);
    expect(SectorPackDataSchema.safeParse(withEs({ today: ["hoy", "HOY,"] })).success).toBe(false);
    expect(SectorPackDataSchema.safeParse(withEs({ today: ["esta tarde", "esta   tarde"] })).success).toBe(false);
  });

  it("rejects an empty list, more than 40 terms, a term over 40 characters and a term with no letter", () => {
    expect(SectorPackDataSchema.safeParse(withEs({ urgent: [] })).success).toBe(false);
    expect(SectorPackDataSchema.safeParse(withEs({ urgent: Array.from({ length: 41 }, (_, k) => `t${k}`) })).success).toBe(false);
    expect(SectorPackDataSchema.safeParse(withEs({ urgent: Array.from({ length: 40 }, (_, k) => `t${k}`) })).success).toBe(true);
    expect(SectorPackDataSchema.safeParse(withEs({ today: ["x".repeat(41)] })).success).toBe(false);
    expect(SectorPackDataSchema.safeParse(withEs({ today: ["x".repeat(40)] })).success).toBe(true);
    expect(SectorPackDataSchema.safeParse(withEs({ today: ["¡?"] })).success).toBe(false);
    expect(SectorPackDataSchema.safeParse(withEs({ today: [""] })).success).toBe(false);
  });

  it("a pack without the lists fails", () => {
    const data = dataOf();
    const { urgent: _u, ...esNoUrgent } = data.vocabulary.es;
    void _u;
    expect(SectorPackDataSchema.safeParse({ ...data, vocabulary: { ...data.vocabulary, es: esNoUrgent } }).success).toBe(false);
  });

  it("the hair-salon lists contain \"alergia\" and \"today\"", () => {
    expect(hairSalon.vocabulary.es.urgent).toContain("alergia");
    expect(hairSalon.vocabulary.es.today).toContain("hoy");
    expect(hairSalon.vocabulary.en.today).toContain("today");
    expect(hairSalon.vocabulary.en.urgent).toContain("allergy");
  });

  it("term() still returns the string entries", () => {
    expect(term(hairSalon, "es", "service")).toBe("servicio");
    expect(typeof term(hairSalon, "en", "place")).toBe("string");
  });
});

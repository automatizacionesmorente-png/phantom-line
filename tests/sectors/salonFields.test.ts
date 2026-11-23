import { describe, expect, it } from "vitest";
import { SectorPackDataSchema, allSectorPacks, getSectorPack } from "@/lib/sectors";

/** Salon system task 2: the visit-note label and the per-sector client fields. */

describe("sector pack salon fields", () => {
  it("every pack's fields validate and ids are unique", () => {
    for (const pack of allSectorPacks()) {
      const { rules: _rules, ...data } = pack;
      void _rules;
      expect(SectorPackDataSchema.safeParse(data).success, pack.id).toBe(true);
      const ids = (pack.clientFields ?? []).map((f) => f.id);
      expect(new Set(ids).size, pack.id).toBe(ids.length);
    }
  });

  it("the schema rejects bad fields", () => {
    const { rules: _rules, ...data } = getSectorPack("hair-salon");
    void _rules;
    const bad = (clientFields: unknown) => SectorPackDataSchema.safeParse({ ...data, clientFields }).success;
    expect(bad([{ id: "Car", label: { es: "a", en: "b" }, maxLength: 60 }])).toBe(false);
    expect(bad([{ id: "car", label: { es: "a", en: "b" }, maxLength: 0 }])).toBe(false);
    expect(bad([{ id: "car", label: { es: "a", en: "b" }, maxLength: 501 }])).toBe(false);
    expect(
      bad([
        { id: "car", label: { es: "a", en: "b" }, maxLength: 60 },
        { id: "car", label: { es: "c", en: "d" }, maxLength: 60 },
      ]),
    ).toBe(false);
    expect(bad([{ id: "car", label: { es: "a", en: "b" }, maxLength: 60 }])).toBe(true);
  });

  it("each sector has the agreed labels", () => {
    const label = (id: string) => getSectorPack(id).visitNoteLabel;
    for (const id of ["hair-salon", "beauty-centre", "barber-shop"]) {
      expect(label(id), id).toEqual({ es: "Fórmula del color / notas", en: "Colour formula / notes" });
    }
    expect(label("car-workshop")).toEqual({ es: "Trabajo realizado", en: "Work done" });
    expect(getSectorPack("car-workshop").clientFields).toEqual([
      { id: "car", label: { es: "Coche y matrícula", en: "Car and plate" }, maxLength: 60 },
    ]);
    for (const id of ["dental-clinic", "physio-clinic"]) {
      expect(label(id), id).toEqual({ es: "Notas de la visita", en: "Visit notes" });
    }
    for (const id of ["tutoring-academy", "driving-school"]) {
      expect(label(id), id).toEqual({ es: "Lo trabajado en clase", en: "What we covered" });
    }
  });

  it("psychology has no visit note and no client fields", () => {
    const p = getSectorPack("psychology-practice");
    expect(p.visitNoteLabel).toBeUndefined();
    expect(p.clientFields).toBeUndefined();
  });
});

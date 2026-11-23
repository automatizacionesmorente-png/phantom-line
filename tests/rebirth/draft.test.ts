import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ShopProfileSchema } from "@/lib/conversation/shopProfile";
import { buildProfile, CreateRequestSchema, DraftSchema, profileIssues, text } from "@/lib/rebirth/draft";
import { emptyState, parseSavedState, starterFaq, starterServices, toDraft, type WizardState } from "@/lib/rebirth/state";
import { availableSectors, sectorById } from "@/lib/rebirth/sectors";
import { validateStep } from "@/lib/rebirth/validate";
import { createBody, validDraft } from "./fixtures";

describe("the draft and its profile", () => {
  it("a valid draft builds a profile that the existing ShopProfile schema accepts", () => {
    const draft = DraftSchema.parse(validDraft());
    const profile = ShopProfileSchema.parse(buildProfile(draft, "barberia-paco"));
    expect(profile).toMatchObject({
      id: "barberia-paco",
      name: "Barbería Paco",
      ownerName: "Paco",
      address: "Calle Mayor 12, Madrid",
      sectorPackId: "hair-salon",
      languages: ["es", "en"],
    });
    expect(profile.resources.map((r) => r.id)).toEqual(["sillon-1", "sillon-2"]);
    expect(profile.services[1]).toMatchObject({ id: "tinte-de-raiz", priceCents: 3550, priceFrom: true, name: { es: "Tinte de raíz", en: "Tinte de raíz" } });
    expect(profile.services[0].name.en).toBe("Men's cut");
    // The unanswered FAQ row is skipped; the answered one keeps its keywords for each language.
    expect(profile.faq).toHaveLength(1);
    expect(profile.faq?.[0].aliases.en).toEqual(["parking", "car park"]);
  });

  it("resources are the first `concurrent` names", () => {
    const draft = DraftSchema.parse(validDraft({ team: { members: ["Marta", "Luis", "Eva"], concurrent: 2 } }));
    expect(buildProfile(draft, "x").resources.map((r) => r.name.es)).toEqual(["Marta", "Luis"]);
  });

  it("rejects unknown fields, markup, control characters and bad numbers", () => {
    expect(DraftSchema.safeParse({ ...validDraft(), extra: 1 }).success).toBe(false);
    expect(CreateRequestSchema.safeParse({ ...createBody(), admin: true }).success).toBe(false);
    for (const bad of ["<script>alert(1)</script>", "a‮b", "x\u0000y", "a<b"]) {
      const d = validDraft();
      d.business.name = bad;
      expect(DraftSchema.safeParse(d).success, bad).toBe(false);
    }
    const d = validDraft();
    d.services[0].priceEur = 10.123;
    expect(DraftSchema.safeParse(d).success).toBe(false);
    d.services[0].priceEur = Number.NaN;
    expect(DraftSchema.safeParse(d).success).toBe(false);
  });

  it("an answer with digits is not spoken form: reported on its FAQ row", () => {
    const d = DraftSchema.parse(validDraft());
    d.faq[0].answer = "El parking cuesta 3 euros.";
    expect(profileIssues(d).map((i) => i.code)).toContain("faq_spoken");
  });

  it("an FAQ keyword that is a service word is dropped, so the profile stays valid", () => {
    const d = DraftSchema.parse(validDraft());
    d.faq[0].keywords = "corte de hombre, parking";
    expect(profileIssues(d)).toEqual([]);
    expect(ShopProfileSchema.parse(buildProfile(d, "x")).faq?.[0].aliases.es).not.toContain("corte de hombre");
  });

  it("text() collapses whitespace and bounds the length", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const r = text(40).safeParse(s);
        if (r.success) {
          expect(r.data).toBe(r.data.trim());
          expect(r.data).not.toMatch(/\s{2}|[<>]/);
          expect(r.data.length).toBeLessThanOrEqual(40);
        }
      }),
    );
  });

  it("any draft of plain names, prices and hours that the schema accepts builds a valid profile", () => {
    const word = fc.stringMatching(/^[A-Za-zÁÉÍÓÚáéíóúñ][A-Za-zÁÉÍÓÚáéíóúñ ]{1,20}$/);
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 1, maxLength: 6 }),
        fc.array(fc.record({ name: word, durationMin: fc.integer({ min: 5, max: 480 }), cents: fc.integer({ min: 0, max: 100000 }), from: fc.boolean() }), { minLength: 1, maxLength: 8 }),
        word,
        (members, services, shopName) => {
          const draft = DraftSchema.safeParse(
            validDraft({
              business: { ...validDraft().business, name: `${shopName}x` },
              team: { members, concurrent: 1 },
              services: services.map((s) => ({ name: s.name, nameEn: undefined, durationMin: s.durationMin, priceEur: s.cents / 100, from: s.from })),
              faq: [],
            }),
          );
          fc.pre(draft.success);
          if (draft.success) expect(ShopProfileSchema.safeParse(buildProfile(draft.data, "shop")).success).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("step validation", () => {
  const filled = (): WizardState => {
    const sector = sectorById("hair-salon")!;
    const d = validDraft();
    return {
      ...emptyState(),
      sectorId: "hair-salon",
      name: d.business.name,
      address: d.business.address,
      city: d.business.city,
      ownerName: d.business.ownerName,
      members: d.team.members,
      concurrent: "2",
      hours: { 1: [{ open: "10:00", close: "14:00" }] },
      services: starterServices(sector),
      faq: starterFaq(sector),
    };
  };

  it("a complete state passes every step", () => {
    const s = filled();
    for (let step = 0; step <= 4; step++) expect(validateStep(step, s), `step ${step}`).toEqual({});
    expect(validateStep(5, s, { pin: "123456", pinAgain: "123456", acceptTerms: true })).toEqual({});
  });

  it("an empty state fails each step with codes, not text", () => {
    const s = emptyState();
    expect(validateStep(0, s).sectorId).toBe("required");
    expect(validateStep(1, s)["business.name"]).toBe("required");
    expect(validateStep(2, s)["team.members.0"]).toBe("required");
    expect(validateStep(3, s).hours).toBe("no_open_day");
    expect(validateStep(3, s).services).toBe("required");
  });

  it("checks the pin twice, six digits, and the terms box", () => {
    const s = filled();
    expect(validateStep(5, s, { pin: "12345", pinAgain: "12345", acceptTerms: true }).pin).toBe("pin_format");
    expect(validateStep(5, s, { pin: "123456", pinAgain: "123457", acceptTerms: true }).pinAgain).toBe("pin_mismatch");
    expect(validateStep(5, s, { pin: "123456", pinAgain: "123456", acceptTerms: false }).acceptTerms).toBe("terms_required");
  });

  it("concurrent cannot exceed the team, duplicates are refused, overlapping hours are refused", () => {
    const s = filled();
    expect(validateStep(2, { ...s, concurrent: "3" })["team.concurrent"]).toBe("concurrent_too_high");
    expect(validateStep(2, { ...s, members: ["Marta", "marta"] })["team.members"]).toBe("duplicate");
    const bad = { ...s, hours: { 1: [{ open: "10:00", close: "14:00" }, { open: "13:00", close: "18:00" }] } };
    expect(validateStep(3, bad).hours).toBe("hours_invalid");
  });

  it("a website must be http(s) and an answer with digits is flagged on its row", () => {
    const s = filled();
    expect(validateStep(1, { ...s, website: "javascript:alert(1)" })["business.website"]).toBe("invalid_url");
    const withFaq = { ...s, faq: [{ question: "Parking", keywords: "parking", keywordsEn: "", answer: "Cuesta 3 euros", answerEn: "" }] };
    expect(validateStep(4, withFaq)["faq.0.answer"]).toBe("faq_spoken");
  });

  it("starter data from the sector is valid", () => {
    for (const sector of availableSectors()) {
      expect(sector.starterCatalogue.length).toBeGreaterThan(0);
      expect(sector.starterFaq.length).toBeGreaterThan(0);
    }
  });
});

describe("the saved draft", () => {
  it("round-trips, and anything else is dropped without throwing", () => {
    const s = { ...emptyState(), sectorId: "hair-salon", step: 3, name: "Paco" };
    expect(parseSavedState(JSON.stringify(s))).toMatchObject({ sectorId: "hair-salon", step: 3, name: "Paco" });
    expect(toDraft(s).business.name).toBe("Paco");
    expect(parseSavedState(null)).toBeNull();
    expect(parseSavedState("{nope")).toBeNull();
    expect(parseSavedState("x".repeat(300_000))).toBeNull();
    fc.assert(fc.property(fc.json(), (j) => { const r = parseSavedState(j); expect(r === null || typeof r.step === "number").toBe(true); }));
  });

  it("never carries a PIN field", () => {
    expect(Object.keys(emptyState())).not.toContain("pin");
  });
});

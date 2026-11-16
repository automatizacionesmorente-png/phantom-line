import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { checkBooking, comboId, evaluateBooking, localDateOf, toInstant, type RuleContext } from "@/lib/booking";
import { catalogLine, serviceView } from "@/lib/conversation/catalog";
import { ShopProfileSchema, SpokenAnswerSchema, toShopRules } from "@/lib/conversation/shopProfile";
import { lolaSeedProfile } from "@/lib/db/seed";
import { demoSamples } from "@/lib/owner/demo";
import { cachePlan, DEMO_REQUEST_TIME, PLAN_DAYS } from "@/lib/receptionist/cachePlan";
import { getSectorPack } from "@/lib/sectors";

/** The Rich_Profile (front-desk-brain 11.4–11.8, design.md "The Rich_Profile"), as the seed writes it. */
const rich = lolaSeedProfile;
const pack = getSectorPack(rich.sectorPackId);
const TZ = rich.timeZone;
// Monday 16 November 2026, 12:00 in Madrid; Tuesday 17 is the next open day.
const NOW = Temporal.Instant.from("2026-11-16T11:00:00Z");
const TUESDAY = Temporal.PlainDate.from("2026-11-17");
const ctx: RuleContext = {
  now: NOW,
  shop: toShopRules(rich),
  pack: { slotStepMin: pack.slotStepMin, rules: pack.rules },
  existing: [],
};

describe("the Rich_Profile", () => {
  it("parses as it is, with its sector pack (11.8)", () => {
    expect(ShopProfileSchema.parse(rich)).toEqual(rich);
    expect(pack.id).toBe("hair-salon");
  });

  it("has the 19 services of 11.4, each named and spoken in both languages, with a Category", () => {
    expect(rich.services).toHaveLength(19);
    const categories = new Set((rich.categories ?? []).map((c) => c.id));
    expect([...categories]).toEqual(["cortes", "barberia", "peinados", "color", "tratamientos"]);
    for (const s of rich.services) {
      expect(s.spokenName?.es, s.id).toBeTruthy();
      expect(s.spokenName?.en, s.id).toBeTruthy();
      expect(s.aliases?.length ?? 0, s.id).toBeGreaterThanOrEqual(4);
      expect(categories.has(s.category ?? ""), s.id).toBe(true);
    }
    // Every Category is used by at least one service.
    for (const c of categories) expect(rich.services.some((s) => s.category === c), c).toBe(true);
    // The fade is an Add_On of the men's cut and nothing else is (reviewer's answer 3).
    expect(rich.services.filter((s) => s.addOnTo).map((s) => [s.id, s.addOnTo])).toEqual([
      ["degradado", ["corte-hombre"]],
    ]);
    expect(rich.services.filter((s) => s.priceFrom).map((s) => s.id)).toEqual([
      "peinado-novia",
      "tinte-completo",
      "mechas",
      "balayage",
      "decoloracion",
      "keratina",
    ]);
  });

  it("fits every service with each of its Goes_With partners in the morning session", () => {
    const tuesdayAt10 = toInstant(TUESDAY, Temporal.PlainTime.from("10:00"), TZ);
    let pairs = 0;
    for (const s of rich.services) {
      for (const partner of s.goesWith ?? []) {
        const id = comboId([s.id, partner], rich.services);
        expect(id, `${s.id} + ${partner}`).not.toBeNull();
        const e = evaluateBooking({ serviceId: id!, start: tuesdayAt10 }, ctx);
        expect(e.ok, `${id} at 10:00`).toBe(true);
        pairs++;
      }
    }
    expect(pairs).toBe(12); // 3 + 1 + 1 + 1 + 1 + 1 + 3 + 1, as in the services table
  });

  it("says every FAQ answer in Spoken_Form, for the 14 topics of 11.5", () => {
    const faq = rich.faq ?? [];
    expect(faq.map((f) => f.id)).toEqual([
      "pago",
      "parking",
      "accesibilidad",
      "sin-cita",
      "cancelacion",
      "llegar-antes",
      "ninos",
      "productos",
      "bono-regalo",
      "prueba-alergia",
      "hombres",
      "ingles",
      "wifi",
      "como-llegar",
    ]);
    for (const f of faq) {
      for (const lang of ["es", "en"] as const) {
        const answer = f.answer[lang];
        expect(SpokenAnswerSchema.safeParse(answer).success, `${f.id} ${lang}`).toBe(true);
        expect(answer, `${f.id} ${lang}`).not.toMatch(/\d/);
      }
    }
    // Task 1.5: the car park was confirmed, the metro stations were not, so none is named.
    const how = faq.find((f) => f.id === "como-llegar")!;
    expect(how.answer.es).toBe("Estamos en la calle Mayor, en pleno centro, y se llega bien en metro y en autobús.");
    expect(how.answer.en).not.toMatch(/\bSol\b|Ópera|Opera/);
    expect(faq.find((f) => f.id === "parking")!.answer.es).toContain("muy cerca");
  });

  it("names its Categories in the catalog line (11.6)", () => {
    expect(catalogLine(rich, "es")).toBe("Hacemos cortes, barbería, peinados, color y tratamientos.");
    expect(catalogLine(rich, "en")).toBe("We do haircuts, barbering, styling, colour and treatments.");
  });

  it("makes the Real_Call_2026_11_16's combo 50 minutes and 18 €", () => {
    const v = serviceView("corte-hombre+degradado", rich, pack);
    expect(v.known).toBe(true);
    if (!v.known) return;
    expect(v.durationMin).toBe(50);
    expect(v.priceCents).toBe(1800);
    expect(v.priceFrom).toBe(false);
    expect(v.name).toEqual({ es: "Corte de hombre + Degradado", en: "Men's cut + Fade" });
    expect(v.spoken).toEqual({ es: "un corte de hombre y un degradado", en: "a men's cut and a fade" });
  });
});

describe("what still uses the first service (task 5.4)", () => {
  it("the first service is now Corte de mujer", () => {
    expect(rich.services[0]).toMatchObject({ id: "corte-mujer", durationMin: 45, priceCents: 2500 });
  });

  it("the demo booking sample is a valid Corte de mujer on the next open day", () => {
    let n = 0;
    const [s] = demoSamples(["booking"], { now: NOW, shop: rich, pack, newId: () => `id-${n++}` });
    expect(s.key).toBe("booking");
    const slot = s.agreedSlot!;
    expect(slot.serviceId).toBe("corte-mujer");
    expect(localDateOf(slot.start, TZ).toString()).toBe("2026-11-17");
    const e = evaluateBooking({ serviceId: slot.serviceId, start: slot.start }, ctx);
    expect(e.ok).toBe(true);
    if (e.ok) expect(e.resourceId).toBe(slot.resourceId);
    expect(s.message.urgency).toBe("normal");
    expect(s.message.outcome).toBe("booked");
    expect(s.call.transcript[1].caller).toContain("un corte de mujer");
  });

  it("the Cache_Plan's tier 2 still renders the demo conversation for every day, in both languages", () => {
    for (const lang of ["es", "en"] as const) {
      const tier2 = cachePlan(rich, pack, lang, Temporal.PlainDate.from("2026-11-16")).filter((l) => l.tier === 2);
      const templates = new Set(tier2.map((l) => l.template));
      expect([...templates].sort(), lang).toEqual(["booked", "rejected", "timeAcceptedAskName"]);
      for (const l of tier2) expect(l.text, lang).not.toMatch(/\d/);
      const booked = tier2.filter((l) => l.template === "booked");
      // One `booked` line per day whose "tomorrow at 21:00" request for the first service
      // (Corte de mujer, 45 min) is rejected with an alternative, decided here independently.
      const today = Temporal.PlainDate.from("2026-11-16");
      let withAlternative = 0;
      for (let d = 0; d < PLAN_DAYS; d++) {
        const date = today.add({ days: d });
        const now = date.toZonedDateTime({ timeZone: TZ }).toInstant();
        const requested = toInstant(date.add({ days: 1 }), Temporal.PlainTime.from(DEMO_REQUEST_TIME), TZ);
        const v = checkBooking({ serviceId: "corte-mujer", start: requested }, { ...ctx, now });
        if (!v.ok && v.alternatives.length > 0) withAlternative++;
      }
      expect(withAlternative, lang).toBe(PLAN_DAYS);
      expect(booked.length, lang).toBeGreaterThanOrEqual(withAlternative);
    }
  }, 120_000);
});

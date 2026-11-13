import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { cachePlan, fullCachePlan } from "@/lib/receptionist/cachePlan";
import { FIXED_TEMPLATES, fixedPhrases } from "@/lib/receptionist/fixedPhrases";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

/** Task 9.2 and 9.7: the Fixed_Phrases and the pre-generation plan for Peluquería Lola. */

const pack = getSectorPack("hair-salon");
const FRIDAY = Temporal.PlainDate.from("2026-11-13");
const plan = cachePlan(lolaProfile, pack, "es", FRIDAY);
const tier = (n: number) => plan.filter((l) => l.tier === n);
const NOW = FRIDAY.toZonedDateTime({ timeZone: lolaProfile.timeZone }).toInstant();

describe("fixedPhrases", () => {
  it("every variant of the greeting, in both languages, each with the AI disclosure", () => {
    const es = fixedPhrases(lolaProfile, pack, "es", NOW).filter((l) => l.template === "greeting").map((l) => l.text);
    const en = fixedPhrases(lolaProfile, pack, "en", NOW).filter((l) => l.template === "greeting").map((l) => l.text);
    expect(new Set(es)).toEqual(
      new Set([
        "¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual. ¿En qué te puedo ayudar?",
        "¡Hola! Has llamado a Peluquería Lola. Te atiende su asistente virtual, ¿qué necesitas?",
      ]),
    );
    expect(en).toHaveLength(2);
    for (const g of en) expect(g).toContain("virtual assistant");
  });

  it("holds Requirement 2's Fixed_Phrases: the greeting, both Fallback_Messages, the Typed_Mode notice and the rate-limited start", () => {
    const templates = new Set(fixedPhrases(lolaProfile, pack, "es", NOW).map((l) => l.template));
    for (const t of ["greeting", "fallbackEnd", "fallbackRetry", "typeInstead", "rateLimitedStart"] as const) expect(templates).toContain(t);
    expect([...templates].sort()).toEqual([...FIXED_TEMPLATES].sort());
  });

  it("every two-variant template gives both variants, and no line is repeated", () => {
    const lines = fixedPhrases(lolaProfile, pack, "es", NOW);
    const count = (t: string) => lines.filter((l) => l.template === t).length;
    for (const t of ["greeting", "askDayAndTime", "askName", "askNameAgain", "askPhone"]) expect(count(t), t).toBe(2);
    for (const t of ["dontKnow", "goodbye", "fallbackEnd", "typeInstead"]) expect(count(t), t).toBe(1);
    expect(new Set(lines.map((l) => l.text)).size).toBe(lines.length);
  });

  it("has no digit and no caller data", () => {
    for (const l of fixedPhrases(lolaProfile, pack, "es", NOW)) expect(l.text).not.toMatch(/\d/);
  });
});

describe("cachePlan for Lola, Spanish, from Friday 13 November 2026", () => {
  it("has the tiers of design.md, in order, with the sizes it estimated", () => {
    expect(plan.map((l) => l.tier)).toEqual([...plan.map((l) => l.tier)].sort((a, b) => a - b));
    expect(tier(1)).toHaveLength(20);
    expect(tier(2).length).toBeGreaterThanOrEqual(13);
    expect(tier(3).length).toBeLessThanOrEqual(36);
    expect(tier(4).length).toBeLessThanOrEqual(84);
    expect(tier(5).length).toBeLessThanOrEqual(140);
  });

  it("tier 2 is the demo conversation: tomorrow at nine at night rejected, half past seven accepted, booked", () => {
    const texts = tier(2).map((l) => l.text);
    expect(texts).toContain(
      "Mañana a las nueve ya hemos cerrado. ¿Te viene bien a las siete y media? También tengo a las siete y cuarto o a las siete.",
    );
    expect(texts).toContain("Genial, mañana a las siete y media tengo hueco. ¿Me dices tu nombre?");
    expect(texts).toContain("Vale, mañana a las siete y media me cuadra. ¿A nombre de quién lo pongo?");
    expect(texts).toContain("¡Hecho! Te esperamos mañana sábado a las siete y media. Lola verá tu mensaje y te confirma.");
    // On Saturday, tomorrow is Sunday and closed: the rejection offers the nearest open time instead.
    expect(texts.some((t) => t.startsWith("Mañana domingo cerramos."))).toBe(true);
  });

  it("tier 3 is rejections for today with no day words, reused every day", () => {
    for (const l of tier(3)) {
      expect(l.template).toBe("rejected");
      expect(l.text).not.toMatch(/\b(hoy|mañana|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b/i);
    }
    expect(tier(3).map((l) => l.text)).toContain(
      "A las cuatro estamos cerrados, abrimos a las cinco. ¿Te viene bien a las cinco? También tengo a las cinco y cuarto o a las cinco y media.",
    );
  });

  it("tiers 4 and 5 are the round and half-past times inside the sessions, never outside them", () => {
    for (const l of [...tier(4), ...tier(5)]) {
      const start = (l.template === "booked" ? l.inputs.args[1] : l.inputs.args[0]) as Temporal.Instant;
      const z = start.toZonedDateTimeISO(lolaProfile.timeZone);
      const minute = z.hour * 60 + z.minute;
      expect(minute % 30).toBe(0);
      expect((minute >= 600 && minute < 840) || (minute >= 1020 && minute < 1200)).toBe(true);
    }
    expect(tier(4).map((l) => l.text)).toContain("Genial, pasado mañana a las doce del mediodía tengo hueco. ¿Me dices tu nombre?");
    expect(tier(5).map((l) => l.text)).toContain("¡Hecho! Te esperamos mañana martes a las diez. Lola verá tu mensaje y te confirma.");
  });

  it("has no duplicate, no digit, and only cacheable lines (none with a name or a phone)", () => {
    expect(new Set(plan.map((l) => l.text)).size).toBe(plan.length);
    for (const l of plan) {
      expect(l.text).not.toMatch(/\d/);
      expect(l.template).not.toBe("readBack");
    }
  });
});

describe("fullCachePlan", () => {
  it("builds tiers 1–2 in each language first, then tiers 3–5 in each language", () => {
    const full = fullCachePlan(lolaProfile, pack, FRIDAY, ["es", "en"]);
    const order = full.map((l) => `${l.tier <= 2 ? "a" : "b"}-${l.lang}`);
    const firstOf = (k: string) => order.indexOf(k);
    const lastOf = (k: string) => order.lastIndexOf(k);
    expect(lastOf("a-es")).toBeLessThan(firstOf("a-en"));
    expect(lastOf("a-en")).toBeLessThan(firstOf("b-es"));
    expect(lastOf("b-es")).toBeLessThan(firstOf("b-en"));
  });

  it("leaves English out when only Spanish is asked for (until task 2.4 picks the English voice)", () => {
    expect(fullCachePlan(lolaProfile, pack, FRIDAY, ["es"]).every((l) => l.lang === "es")).toBe(true);
  });
});

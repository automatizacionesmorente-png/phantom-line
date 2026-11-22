import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { buildInput, buildSystemInstruction } from "@/lib/receptionist/prompt";
import { modelTurnJsonSchema } from "@/lib/receptionist/schema";
import { speakPrice } from "@/lib/receptionist/spoken";
import { initialCallState, type CallState } from "@/lib/conversation/types";
import { getSectorPack } from "@/lib/sectors";
import { lolaSeedProfile } from "@/lib/db/seed";
import { lolaProfile } from "../fixtures/lola";

/**
 * front-desk-brain task 11.1 (Requirements 4.9, 13.1): the prompt of the Rich_Profile lists the
 * Categories, marks "desde" prices and carries every FAQ answer; the V1_Profile's prompt does
 * not change except for the `service` description of the JSON schema. The V1 system
 * instruction is also pinned, byte for byte, by the snapshot in `prompt.test.ts`.
 */

const pack = getSectorPack("hair-salon");
// Saturday 14 November 2026, 19:30 in Madrid (the Real_Call's NOW).
const NOW = Temporal.Instant.from("2026-11-14T18:30:00Z");
const rich = lolaSeedProfile;
const LANGS = ["es", "en"] as const;

/** The shop facts block: from its heading up to the TODAY line. */
function factsOf(text: string): string {
  return text.slice(text.search(/DATOS DE LA TIENDA|SHOP FACTS/), text.search(/\nHOY:|\nTODAY:/));
}

describe("buildSystemInstruction with the Rich_Profile", () => {
  const prompts = { es: buildSystemInstruction(rich, pack, "es", NOW), en: buildSystemInstruction(rich, pack, "en", NOW) };

  it("contains every FAQ answer word for word, inside the shop facts", () => {
    expect(rich.faq?.length).toBe(14);
    for (const lang of LANGS) {
      const facts = factsOf(prompts[lang]);
      for (const f of rich.faq ?? []) expect(facts).toContain(f.answer[lang]);
    }
    expect(prompts.es).toContain("- Respuestas de la tienda (puedes repetirlas tal cual):");
    expect(prompts.en).toContain("- The shop's own answers (you may repeat them word for word):");
    expect(prompts.es).toContain(
      '  - Si preguntan por "pagar con tarjeta", "bizum", "efectivo": Puedes pagar con tarjeta, con Bizum o en efectivo.',
    );
  });

  it("states no price, hour or answer of the shop in digits (only the street number)", () => {
    for (const lang of LANGS) {
      const facts = factsOf(prompts[lang]);
      expect(facts.replace("Calle Mayor 12", "")).not.toMatch(/\d/);
    }
  });

  it("lists the Categories with their services", () => {
    const es = prompts.es.split("\n").find((l) => l.startsWith("- Categorías: "))!;
    const en = prompts.en.split("\n").find((l) => l.startsWith("- Categories: "))!;
    for (const c of rich.categories ?? []) {
      expect(es).toContain(c.name.es);
      expect(en).toContain(c.name.en);
    }
    expect(es).toContain("cortes (Corte de mujer, Corte de hombre, Corte infantil)");
    for (const s of rich.services) {
      expect(es).toContain(s.name.es);
      expect(en).toContain(s.name.en);
    }
  });

  it('marks every "desde" price, and only those', () => {
    const from = rich.services.filter((s) => s.priceFrom);
    expect(from.length).toBe(6);
    for (const lang of LANGS) {
      const lines = prompts[lang].split("\n");
      for (const s of rich.services) {
        const line = lines.find((l) => l.startsWith(`  - ${s.name[lang]}: `))!;
        expect(line, s.id).toBeDefined();
        const marked = line.includes(`${lang === "es" ? "desde" : "from"} ${speakPrice(s.priceCents, lang)}`);
        expect(marked, s.id).toBe(s.priceFrom === true);
      }
    }
  });

  it("says that an Add_On is only booked with its base", () => {
    const es = prompts.es.split("\n").find((l) => l.startsWith("  - Degradado: "))!;
    const en = prompts.en.split("\n").find((l) => l.startsWith("  - Fade: "))!;
    expect(es).toContain("Solo se hace junto con: Corte de hombre.");
    expect(en).toContain("Only booked together with: Men's cut.");
  });
});

describe("the V1_Profile's prompt", () => {
  it("has none of the Rich_Profile's lines", () => {
    for (const lang of LANGS) {
      const text = buildSystemInstruction(lolaProfile, pack, lang, NOW);
      expect(text).not.toMatch(/Categorías|Categories|Respuestas de la tienda|The shop's own answers/);
      expect(text).not.toMatch(/\bdesde\b|\bfrom (?:[a-z]+ )?euros?\b/);
      expect(text).not.toMatch(/Solo se hace junto con|Only booked together with/);
    }
  });

  it("changes only the service description of the JSON schema (pinned diff)", () => {
    const schema = modelTurnJsonSchema as { properties: Record<string, { description?: string }> };
    expect(Object.keys(schema.properties)).toEqual([
      "reply",
      "language",
      "wantsLanguage",
      "intent",
      "name",
      "phone",
      "service",
      "date",
      "time",
      "callerConfirmed",
      "callerWantsToEnd",
      "outOfProfile",
      "reason",
      "urgency",
    ]);
    const described = Object.entries(schema.properties)
      .filter(([, p]) => p.description !== undefined)
      .map(([k]) => k);
    expect(described).toEqual(["service", "date", "time"]);
    // Before task 11: "The service the caller asked for, in the caller's own words, from the whole conversation. Null if not said."
    expect(schema.properties.service.description).toBe(
      "Every service the caller asked for, in the caller's own words, joined with ' y ' (Spanish) or ' and ' (English), from the whole conversation. Null if not said.",
    );
    expect(schema.properties.date.description).toBe(
      "The day the caller asked for, shop-local YYYY-MM-DD, from the whole conversation, even if the shop is closed that day or it has passed. Null only if the caller never said a day.",
    );
    expect(schema.properties.time.description).toBe(
      'The time the caller asked for, shop-local 24-hour HH:MM ("nine at night" is "21:00"), from the whole conversation, even if the shop is closed then. Null only if the caller never said a time.',
    );
  });
});

describe("buildInput names a Service_Combo by its parts", () => {
  it("shows the Combo_Id as the Owner's name, never as a raw id or 'sin dato'", () => {
    const state: CallState = { ...initialCallState("es"), intent: "booking", fields: { serviceId: "corte-hombre+degradado" } };
    const es = buildInput(state, [], "sí", rich);
    expect(es).toContain("- Servicio: Corte de hombre + Degradado");
    const en = buildInput({ ...state, language: "en" }, [], "yes", rich);
    expect(en).toContain("- Service: Men's cut + Fade");
    // A Combo_Id the Booking_Rules refuse (wrong order) is unknown, as before.
    const broken = buildInput({ ...state, fields: { serviceId: "degradado+corte-hombre" } }, [], "sí", rich);
    expect(broken).toContain("- Servicio: sin dato");
  });
});

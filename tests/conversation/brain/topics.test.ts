import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { matchTopic } from "@/lib/conversation/brain/topics";
import { lolaSeedProfile } from "@/lib/db/seed";
import { getSectorPack, type Lang } from "@/lib/sectors";

/** Profile_Topics and Sensitive_Hits (front-desk-brain 9.1, 9.7). */
const rich = lolaSeedProfile;
const pack = getSectorPack(rich.sectorPackId);
const topic = (text: string, lang: Lang = "es", extra: { day?: Temporal.PlainDate; current?: string[] } = {}) =>
  matchTopic(text, rich, { lang, pack, ...extra });

describe("matchTopic: FAQ_Entries", () => {
  it("has 14 FAQ_Entries to cover", () => {
    expect(rich.faq).toHaveLength(14);
  });

  // Two aliases per entry and language, said inside an everyday question.
  for (const f of rich.faq ?? []) {
    for (const lang of ["es", "en"] as const) {
      const aliases = f.aliases[lang].slice(0, 2);
      it(`${f.id} (${lang}) by ${aliases.map((a) => JSON.stringify(a)).join(" and ")}`, () => {
        for (const a of aliases) {
          const frame = lang === "es" ? `Oye, una pregunta: ¿${a}?` : `Hi, quick question: ${a}?`;
          expect(topic(frame, lang).topic, frame).toEqual({ kind: "faq", id: f.id });
        }
      });
    }
  }

  it("treats the allergy test as the FAQ, not as a Sensitive_Hit (9.7)", () => {
    for (const q of ["¿hacéis la prueba de alergia?", "¿hacéis test de alergia?"]) {
      const r = topic(q);
      expect(r.topic, q).toEqual({ kind: "faq", id: "prueba-alergia" });
      expect(r.sensitive, q).toBeNull();
    }
    expect(topic("do you do an allergy test?", "en")).toMatchObject({ topic: { kind: "faq", id: "prueba-alergia" }, sensitive: null });
  });

  it("raises a Sensitive_Hit for an urgent term outside an FAQ alias (9.7)", () => {
    expect(topic("me ha dado alergia el tinte").sensitive).toEqual({ term: "alergia", lang: "es" });
    expect(topic("me pica la cabeza desde ayer").sensitive).toEqual({ term: "me pica", lang: "es" });
    expect(topic("quiero la prueba de alergia, que me ha dado alergia otro tinte").sensitive).toEqual({ term: "alergia", lang: "es" });
    expect(topic("I had a reaction after the patch test", "en").sensitive).toEqual({ term: "reaction", lang: "en" });
  });
});

describe("matchTopic: built-in topics", () => {
  it("reads hours: all, a day, now", () => {
    expect(topic("¿qué horario tenéis?").topic).toEqual({ kind: "hours", day: null, now: false });
    const sat = Temporal.PlainDate.from("2026-11-21");
    expect(topic("¿abrís el sábado?", "es", { day: sat }).topic).toEqual({ kind: "hours", day: sat, now: false });
    expect(topic("¿estáis abiertos ahora?").topic).toEqual({ kind: "hours", day: null, now: true });
    expect(topic("what are your opening hours?", "en").topic).toEqual({ kind: "hours", day: null, now: false });
  });

  it("reads the address and the catalog", () => {
    expect(topic("¿dónde estáis?").topic).toEqual({ kind: "address" });
    expect(topic("what's your address?", "en").topic).toEqual({ kind: "address" });
    expect(topic("¿qué servicios tenéis?").topic).toEqual({ kind: "services" });
    expect(topic("what services do you offer?", "en").topic).toEqual({ kind: "services" });
  });

  it("reads price and duration of a service, a Service_Combo, a Service_Choice and a Category", () => {
    expect(topic("¿cuánto cuesta un corte de hombre?").topic).toEqual({ kind: "price", target: { kind: "service", id: "corte-hombre" } });
    expect(topic("¿cuánto cuesta un corte y un degradado?").topic).toEqual({
      kind: "price",
      target: { kind: "service", id: "corte-hombre+degradado" },
    });
    expect(topic("¿cuánto vale un corte?").topic).toEqual({
      kind: "price",
      target: { kind: "choice", candidates: ["corte-mujer", "corte-hombre", "corte-infantil"] },
    });
    expect(topic("¿cuánto tarda el color?").topic).toEqual({ kind: "duration", target: { kind: "category", categoryId: "color" } });
    expect(topic("how long does a balayage take?", "en").topic).toEqual({ kind: "duration", target: { kind: "service", id: "balayage" } });
    expect(topic("how much is a perm?", "en").topic).toEqual({ kind: "price", target: { kind: "service", id: "permanente" } });
    // "¿Y cuánto cuesta?" names the service the Call already has.
    expect(topic("¿y cuánto cuesta?", "es", { current: ["mechas"] }).topic).toEqual({ kind: "price", target: { kind: "service", id: "mechas" } });
  });

  it("gives an FAQ alias inside a longer service alias to the service (found by B3)", () => {
    // B3 shrank to "how long does Kids' cut take?", read as the FAQ "kids" (ninos) instead of the cut.
    expect(topic("how long does Kids' cut take?", "en").topic).toEqual({ kind: "duration", target: { kind: "service", id: "corte-infantil" } });
    expect(topic("¿cuánto cuesta un corte de niños?").topic).toEqual({ kind: "price", target: { kind: "service", id: "corte-infantil" } });
    // The FAQ alone still answers.
    expect(topic("do you cut kids?", "en").topic).toEqual({ kind: "faq", id: "ninos" });
    expect(topic("¿atendéis a niños?").topic).toEqual({ kind: "faq", id: "ninos" });
  });

  it("reads no topic in a plain booking line or a question the profile does not cover", () => {
    expect(topic("quería cortarme el pelo y hacerme un degradado").topic).toBeNull();
    expect(topic("¿y qué tal es Lola cortando?").topic).toBeNull();
    expect(topic("mañana a las cinco").topic).toBeNull();
  });
});

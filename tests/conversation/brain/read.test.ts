import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { readUtterance, type ReadInput } from "@/lib/conversation/brain/read";
import { initialCallState, type CallState, type Lang } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import { getSectorPack } from "@/lib/sectors";
import { UTTERANCE_POOL } from "./arbitraries";

/** `readUtterance`: the Intent order of 3.3, 3.4, 3.5, and the Sure table of design.md (19.2). */
const shop = lolaSeedProfile;
const pack = getSectorPack(shop.sectorPackId);
// Saturday 14 November 2026, 19:30 in Madrid.
const NOW = Temporal.Instant.from("2026-11-14T18:30:00Z");

function state(patch: Partial<CallState> = {}, lang: Lang = "es"): CallState {
  return { ...initialCallState(lang), ...patch, fields: { ...(patch.fields ?? {}) } };
}
const read = (utterance: string, s: CallState = state(), lang: Lang = s.language) =>
  readUtterance({ utterance, state: s, shop, pack, now: NOW, lang } satisfies ReadInput);

const readBack = state({
  stage: "awaiting_confirmation",
  fields: { serviceId: "corte-hombre+degradado", requested: { date: "2026-11-17", time: "10:00" }, name: "Ana", phone: "+34612345678" },
  pending: { kind: "book", serviceId: "corte-hombre+degradado", start: "2026-11-17T09:00:00Z" },
});
const offer = state({ fields: { serviceId: "corte-hombre+degradado" }, lastOffer: ["2026-11-17T09:00:00Z"] });
const choice = state({ fields: { serviceChoice: { candidates: ["corte-mujer", "corte-hombre", "corte-infantil"], with: [] } } });
const needName = state({ fields: { serviceId: "corte-mujer", requested: { date: "2026-11-17", time: "10:00" } } });
const needPhone = state({ fields: { serviceId: "corte-mujer", requested: { date: "2026-11-17", time: "10:00" }, name: "Ana" } });
const needTime = state({ fields: { serviceId: "corte-mujer" } });

describe("readUtterance: the Intent order (3.3)", () => {
  it.each([
    ["an Owner_Request comes first", "quiero hablar con Lola, es por una cita", state(), ["owner_request", "booking"]],
    ["then a language switch", "¿hablas inglés? quería una cita", state(), ["language_switch", "booking", "question"]],
    ["then yes while a read-back waits", "sí, perfecto", readBack, ["yes"]],
    ["then no while a First_Offer waits", "no, mejor otro día", offer, ["no"]],
    ["then cancel", "quiero cancelar la cita", state(), ["cancel", "booking"]],
    ["then reschedule", "quería cambiar la cita al martes", state(), ["reschedule", "booking"]],
    ["then booking", "quería una cita para mañana", state(), ["booking"]],
    ["then a Profile_Topic", "¿aceptáis bizum?", state(), ["question"]],
    ["then goodbye", "nada más, adiós", state(), ["goodbye"]],
    ["then thanks", "gracias, adiós", state(), ["goodbye", "thanks"]],
    ["then greeting", "hola, buenas", state(), ["greeting"]],
    ["unknown last", "patata frita", state(), ["unknown"]],
  ])("%s: %j", (_, said, s, intents) => {
    expect(read(said, s).intents).toEqual(intents);
  });

  it("puts a Sensitive_Hit beside the intents and answers a topic found with a booking first (3.3, 9.6)", () => {
    const r = read("me ha dado alergia el tinte, quería una cita");
    expect(r.sensitive).toEqual({ term: "alergia", lang: "es" });
    const both = read("quería una cita, ¿aceptáis bizum?");
    expect(both.intents).toEqual(["booking", "question"]);
    expect(both.topic).toEqual({ kind: "faq", id: "pago" });
  });

  it("counts a goodbye only with nothing else to do (3.4)", () => {
    expect(read("gracias, adiós").intents).toContain("goodbye");
    expect(read("adiós, y ¿abrís el sábado?").intents).not.toContain("goodbye");
    expect(read("adiós, quería una cita").intents).not.toContain("goodbye");
  });

  it("counts yes and no only as the first word or phrase (3.5)", () => {
    expect(read("sí", readBack).yes).toBe(true);
    expect(read("pues sí", readBack).yes).toBe(true);
    expect(read("el martes sí", readBack).yes).toBe(false);
    expect(read("no", offer).no).toBe(true);
    expect(read("me viene bien", offer).yes).toBe(true);
    expect(read("yes", state({}, "en"), "en").yes).toBe(true);
    // A yes followed by a change carries the change.
    const change = read("sí, pero mejor a las seis", readBack);
    expect(change.yes).toBe(true);
    expect(change.time?.toString().slice(0, 5)).toBe("18:00");
  });

  it("switches language only to one the shop offers and the Call is not in", () => {
    expect(read("in English please").wantsLanguage).toBe("en");
    expect(read("¿habláis inglés?").wantsLanguage).toBe("en");
    expect(read("en español, por favor", state({}, "en"), "en").wantsLanguage).toBe("es");
    expect(read("en español, por favor").wantsLanguage).toBeNull();
    const esOnly = { ...shop, languages: ["es" as const] };
    expect(readUtterance({ utterance: "in English please", state: state(), shop: esOnly, pack, now: NOW, lang: "es" }).wantsLanguage).toBeNull();
  });

  it("reads a service word that is not in the catalog (4.8)", () => {
    expect(read("quería una manicura").services).toEqual({ kind: "unknown", said: "manicura" });
    expect(read("quiero que me digas qué tal está todo").services).toEqual({ kind: "none" });
  });
});

describe("readUtterance: what makes a Reading sure (design.md table, 19.2, 19.3)", () => {
  it.each([
    ["read-back: a first-word yes", "sí", readBack, "read_back_answer"],
    ["read-back: a no", "no", readBack, "read_back_answer"],
    ["read-back: a placed change", "mejor a las seis", readBack, "read_back_answer"],
    ["First_Offer: yes", "vale", offer, "offer_answer"],
    ["First_Offer: no", "no", offer, "offer_answer"],
    ["First_Offer: a part of the day", "mejor por la tarde", offer, "offer_answer"],
    ["First_Offer: a day and time", "el jueves a las once", offer, "offer_answer"],
    ["Service_Choice: a candidate's own word", "de hombre", choice, "choice_answer"],
    ["next field name", "Ana García", needName, "next_field"],
    ["next field phone", "612 34 56 78", needPhone, "next_field"],
    ["next field phone, refused digits", "512 34 56 78", needPhone, "next_field"],
    ["next field time", "el martes a las cinco", needTime, "next_field"],
    ["a Service_Request in a booking utterance", "Hola Lola quería cortarme el pelo y hacerme un degradado", state(), "service_request"],
    ["a Profile_Topic", "¿aceptáis bizum?", state(), "topic"],
    ["an Owner_Request", "quiero hablar con Lola", state(), "owner_request"],
    ["a Sensitive_Hit", "me pica mucho la cabeza", state(), "sensitive"],
    ["a language switch", "in English please", state(), "language_switch"],
    ["a goodbye alone", "gracias, adiós", state(), "closing"],
    ["thanks alone", "muchas gracias", state(), "closing"],
  ])("sure: %s (%j)", (_, said, s, basis) => {
    const r = read(said, s);
    expect(r.sure, `unplaced: ${r.leftover}`).toBe(true);
    expect(r.sureBasis).toBe(basis);
  });

  it.each([
    ["a question with no Profile_Topic", "¿Y qué tal es Lola cortando?", state()],
    ["free conversation", "patata frita con ketchup", state()],
    ["a greeting alone", "hola", state()],
    ["read-back with 3+ unplaced words", "sí, aunque no sé si mi marido podrá venir conmigo", readBack],
    ["First_Offer with 3+ unplaced words", "no, no me cuadra porque trabajo hasta tarde", offer],
    ["Service_Choice with no candidate word", "no sé, el que sea más barato", choice],
    ["a name expected but a sentence said", "pues es que no me acuerdo ahora mismo", needName],
    ["a service with 3+ unplaced words", "quería un corte de hombre pero tengo el pelo demasiado rizado", state()],
  ])("not sure: %s (%j)", (_, said, s) => {
    expect(read(said, s).sure).toBe(false);
  });

  it("does not count greetings, the owner's name and fillers as unplaced", () => {
    const r = read("Hola Lola, pues mira, quería cortarme el pelo y hacerme un degradado");
    expect(r.unplaced).toBe(0);
    expect(r.sure).toBe(true);
  });
});

describe("readUtterance: speed (2.6)", () => {
  it("reads each of the 50 longest pool utterances in under 20 ms", () => {
    const pool = [...UTTERANCE_POOL].sort((a, b) => b.length - a.length).slice(0, 50);
    expect(pool).toHaveLength(50);
    expect(pool.every((u) => u.length <= 500)).toBe(true);
    for (const u of pool) read(u); // warm up: indexes are built once per profile
    // Each utterance is timed 5 times and its median must be under 20 ms. A single timing measures
    // the scheduler as much as the reader: on an idle machine the slowest read is about 1 ms
    // (.measurements/brain-speed.json), while one suite run under load timed a single read at
    // 20.7 ms. The median keeps the 20 ms limit for the reader's own work and drops a lone pause.
    for (const u of pool) {
      const times: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        read(u);
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      expect(times[2], u).toBeLessThan(20);
    }
  });
});

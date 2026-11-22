import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { readUtterance } from "@/lib/conversation/brain/read";
import { factsFromModel, factsFromReading, noteQuestion } from "@/lib/conversation/facts";
import { initialCallState, MAX_NOTE_QUESTION, type CallState } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import type { ModelTurn } from "@/lib/receptionist/schema";
import { getSectorPack } from "@/lib/sectors";

/**
 * front-desk-brain 8.1: `factsFromModel` and `factsFromReading`, one block per row of design.md's
 * table "Who decides what". Readings are real `readUtterance` results on the Rich_Profile.
 */
const shop = lolaSeedProfile;
const pack = getSectorPack("hair-salon");
const NOW = Temporal.Instant.from("2026-11-14T18:30:00Z"); // Saturday 19:30 Madrid
const read = (utterance: string, state: CallState = initialCallState("es"), lang: "es" | "en" = "es") =>
  readUtterance({ utterance, state, shop, pack, now: NOW, lang });

const turn = (over: Partial<ModelTurn> = {}): ModelTurn => ({
  reply: "MODEL-LINE",
  language: "es",
  wantsLanguage: null,
  intent: "booking",
  name: null,
  phone: null,
  service: null,
  date: null,
  time: null,
  callerConfirmed: false,
  callerWantsToEnd: false,
  outOfProfile: false,
  reason: "Quiere cita",
  urgency: "normal",
  ...over,
});

describe("Who decides what: the reply for free conversation", () => {
  it("model path: the model's line; brain path: none, so only a template can speak", () => {
    expect(factsFromModel(turn(), null, shop).modelReply).toBe("MODEL-LINE");
    const brain = factsFromReading(read("¿y qué tal es Lola cortando?"), "¿y qué tal es Lola cortando?");
    expect(brain.modelReply).toBeNull();
    expect(brain.source).toBe("brain");
  });
});

describe("Who decides what: intent, day, time, name, phone, yes, goodbye, language switch", () => {
  it("model path: every one of them from the model, even when the Reading saw something else", () => {
    const reading = read("sí, el martes a las cinco, me llamo Ana, 612345678");
    const f = factsFromModel(
      turn({
        intent: "reschedule",
        date: "2026-11-20",
        time: "11:00",
        name: "Marta",
        phone: "699 999 999",
        callerConfirmed: false,
        callerWantsToEnd: true,
        wantsLanguage: "en",
      }),
      reading,
      shop,
    );
    expect([f.intent, f.date, f.time, f.name, f.phone, f.yes, f.wantsToEnd, f.wantsLanguage]).toEqual([
      "reschedule",
      "2026-11-20",
      "11:00",
      "Marta",
      "699 999 999",
      false,
      true,
      "en",
    ]);
  });

  it("brain path: every one of them from the Reading", () => {
    const state: CallState = { ...initialCallState("es"), intent: "booking", fields: { serviceId: "corte-hombre", requested: { date: "2026-11-17", time: "10:00" } } };
    const f = factsFromReading(read("el martes a las cinco", state));
    expect([f.intent, f.date, f.time]).toEqual(["booking", "2026-11-17", "17:00"]);
    const named = factsFromReading(read("Me llamo Ana", { ...state, fields: { ...state.fields } }));
    expect(named.name).toBe("Ana");
    expect(factsFromReading(read("612 345 678", { ...state, fields: { ...state.fields, name: "Ana" } })).phone).toBe("+34612345678");
    const offered: CallState = { ...initialCallState("es"), intent: "booking", fields: { serviceId: "corte-hombre" }, lastOffer: ["2026-11-17T09:00:00Z"] };
    expect(factsFromReading(read("sí", offered)).yes).toBe(true);
    expect(factsFromReading(read("no", offered)).no).toBe(true);
    expect(factsFromReading(read("gracias, adiós")).wantsToEnd).toBe(true);
    expect(factsFromReading(read("in English please")).wantsLanguage).toBe("en");
    expect(factsFromReading(read("¿Hacéis la prueba de alergia?")).intent).toBe("question");
    expect(factsFromReading(read("quiero cancelar mi cita")).intent).toBe("cancel");
  });
});

describe("Who decides what: services", () => {
  it("model path: the Reading's services when it found any (13.2), whatever the model said", () => {
    const reading = read("Hola Lola quería cortarme el pelo y hacerme un degradado");
    const f = factsFromModel(turn({ service: "tinte" }), reading, shop);
    expect(f.services).toEqual({ kind: "set", ids: ["corte-hombre", "degradado"], mode: "replace" });
    expect(f.serviceChange.next).toEqual(["corte-hombre", "degradado"]);
  });

  it("model path, the Reading found none: the model's words through the same matcher (4.9)", () => {
    const f = factsFromModel(turn({ service: "cortarme el pelo y un degradado" }), read("vale"), shop);
    expect(f.serviceChange.next).toEqual(["corte-hombre", "degradado"]);
    const none = factsFromModel(turn({ service: "una manicura" }), null, shop);
    expect(none.services).toEqual({ kind: "unknown", said: "una manicura" });
    expect(none.serviceChange.next).toBeNull();
    expect(factsFromModel(turn(), null, shop).services).toEqual({ kind: "none" });
  });

  it("model path: a tie in the model's words is a Service_Choice, decided by the Call's services when it can (4.4(c))", () => {
    expect(factsFromModel(turn({ service: "un corte" }), null, shop).services.kind).toBe("choice");
    const withBeard: CallState = { ...initialCallState("es"), fields: { serviceId: "barba" } };
    const f = factsFromModel(turn({ service: "un corte" }), null, shop, { state: withBeard });
    expect(f.services).toEqual({ kind: "set", ids: ["corte-hombre"], mode: "replace" });
  });

  it("brain path: the Reading's services, a Service_Choice and a Category included", () => {
    expect(factsFromReading(read("quiero un corte")).services.kind).toBe("choice");
    expect(factsFromReading(read("¿cuánto tarda el color?")).services).toEqual({ kind: "category", categoryId: "color", with: [] });
    expect(factsFromReading(read("quería una manicura")).services).toEqual({ kind: "unknown", said: "manicura" });
  });
});

describe("Who decides what: the Profile_Topic", () => {
  it("both paths take it from the Reading; the model has no topic of its own", () => {
    const reading = read("¿aceptáis bizum?");
    expect(factsFromModel(turn({ intent: "question", outOfProfile: true }), reading, shop).topic).toEqual({ kind: "faq", id: "pago" });
    expect(factsFromReading(reading).topic).toEqual({ kind: "faq", id: "pago" });
    expect(factsFromModel(turn({ intent: "question" }), null, shop).topic).toBeNull();
  });

  it("13.3: the model's outOfProfile does not count when the Reading found a topic", () => {
    const f = factsFromModel(turn({ intent: "question", outOfProfile: true }), read("¿aceptáis bizum?"), shop, { utterance: "¿aceptáis bizum?" });
    expect(f.outOfProfile).toBe(false);
    expect(f.unansweredQuestion).toBeNull();
  });
});

describe("Who decides what: Owner_Request and Sensitive_Hit", () => {
  it("both from the Reading, on both paths", () => {
    const owner = read("quiero hablar con Lola");
    expect(factsFromReading(owner).ownerRequest).toBe(true);
    expect(factsFromModel(turn({ intent: "other" }), owner, shop).ownerRequest).toBe(true);
    const sensitive = read("me ha dado alergia el tinte");
    expect(factsFromReading(sensitive).sensitive).toEqual({ term: "alergia", lang: "es" });
    expect(factsFromModel(turn(), sensitive, shop).sensitive).toEqual({ term: "alergia", lang: "es" });
  });

  it("model path with no topic: the model's outOfProfile is an unanswered question, with the Caller's words for the note", () => {
    const words = "¿y qué tal es Lola cortando?";
    const f = factsFromModel(turn({ intent: "question", outOfProfile: true }), read(words), shop, { utterance: words });
    expect(f.outOfProfile).toBe(true);
    expect(f.unansweredQuestion).toBe(words);
  });

  it("brain path: a question with no topic is unanswered; a question with a topic is not", () => {
    const words = "¿y qué tal es Lola cortando?";
    const f = factsFromReading(read(words), words);
    expect([f.intent, f.outOfProfile, f.unansweredQuestion]).toEqual(["question", true, words]);
    const faq = factsFromReading(read("¿hay parking?"), "¿hay parking?");
    expect([faq.outOfProfile, faq.unansweredQuestion]).toEqual([false, null]);
  });
});

describe("Who decides what: the Owner reason and the suggested urgency", () => {
  it("model path: the model's; brain path: none (the code builds the reason, owner-machine sees no suggestion)", () => {
    const m = factsFromModel(turn({ reason: "Quiere un corte", urgency: "urgent" }), null, shop);
    expect([m.reason, m.urgency]).toEqual(["Quiere un corte", "urgent"]);
    const b = factsFromReading(read("es urgente, quiero cita"));
    expect([b.reason, b.urgency]).toEqual([null, null]);
  });
});

describe("brain-only facts", () => {
  it("notUnderstood only when nothing at all was placed (10.3)", () => {
    expect(factsFromReading(read("patata frita con ketchup")).notUnderstood).toBe(true);
    expect(factsFromReading(read("hola")).notUnderstood).toBe(false);
    const naming: CallState = { ...initialCallState("es"), intent: "booking", fields: { serviceId: "corte-hombre", requested: { date: "2026-11-17", time: "10:00" } } };
    expect(factsFromReading(read("Ana", naming)).notUnderstood).toBe(false);
  });

  it("smallTalk for a thanks or a greeting alone", () => {
    expect(factsFromReading(read("gracias")).smallTalk).toBe("thanks");
    expect(factsFromReading(read("hola")).smallTalk).toBe("greeting");
    expect(factsFromReading(read("hola, quiero un corte de hombre")).smallTalk).toBeNull();
  });

  it("a rejected phone is passed on (6.5); the model path never sets it", () => {
    const state: CallState = { ...initialCallState("es"), intent: "booking", fields: { serviceId: "corte-hombre", requested: { date: "2026-11-17", time: "10:00" }, name: "Ana" } };
    expect(factsFromReading(read("512 34 56 78", state)).phoneRejected).toBe(true);
    expect(factsFromModel(turn({ phone: "123456" }), null, shop).phoneRejected).toBe(false);
  });

  it("an Owner_Note question is one line of at most 160 characters", () => {
    expect(noteQuestion("  ¿y   qué tal\nes Lola? ")).toBe("¿y qué tal es Lola?");
    const long = noteQuestion("palabra ".repeat(40));
    expect(long.length).toBe(MAX_NOTE_QUESTION);
    expect(long.endsWith("…")).toBe(true);
  });
});

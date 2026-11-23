import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { readUtterance } from "@/lib/conversation/brain/read";
import { decideTurn, MAX_DECLINES, MAX_MISSES } from "@/lib/conversation/decide";
import { factsFromModel } from "@/lib/conversation/facts";
import { initialCallState, type CallState } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import { phrases } from "@/lib/receptionist/phrases";
import type { ModelTurn } from "@/lib/receptionist/schema";
import { getSectorPack } from "@/lib/sectors";
import { brainCall, SAT_1930, TUE_1000 } from "./brainCall";

/**
 * front-desk-brain 8.3: `decideTurn` on brain facts (design.md, "decideTurn, step by step"), on the
 * Rich_Profile at the Real_Call's clock. Every reply is compared with the template it must be.
 */
const shop = lolaSeedProfile;
const pack = getSectorPack("hair-salon");
const NOW = SAT_1930;
const P = (turn: number, lang: "es" | "en" = "es", callId = "brain-call") => phrases(lang, pack, shop, { callId, turn }, NOW);
const call = (lines: string[], lang: "es" | "en" = "es", state?: CallState) => brainCall(lines, { shop, now: NOW, lang, state });
const replies = (lines: string[], lang: "es" | "en" = "es") => call(lines, lang).map((t) => t.decision.reply);
const at = (iso: string) => Temporal.Instant.from(iso);
/** A booking under way: the men's cut is known, the First_Offer of Tuesday 10:00 waits for an answer. */
const offered = (): CallState => call(["quiero un corte de hombre"])[0].decision.state;

describe("the brain path never speaks model text", () => {
  it("every Decision on brain facts has fromModel false, and the Turn is counted as a brain Turn (1.6)", () => {
    const turns = call(["hola", "¿y qué tal es Lola cortando?", "quiero un corte de hombre", "sí", "Ana", "612 345 678"]);
    for (const t of turns) expect(t.decision.fromModel).toBe(false);
    expect(turns.at(-1)!.decision.state.brainTurns).toBe(turns.length);
  });
});

describe("Owner_Requests, Sensitive_Hits and unanswered questions (10.1–10.5)", () => {
  it("an Owner_Request is noted, the Keep_Alive_Line is said, and the Call goes on", () => {
    const [t] = call(["quiero hablar con Lola"]);
    expect(t.decision.reply).toBe(P(1).ownerNoted().text);
    expect(t.decision.complete).toBe(false);
    expect(t.decision.state.notes).toEqual([{ kind: "owner_request" }]);
  });

  it("in the middle of a booking: the note, then the flow's question, and the flow state is kept", () => {
    const before = offered();
    const [t] = call(["quiero hablar con Lola"], "es", before);
    expect(t.decision.reply).toBe(`${P(2).ownerNoted(true).text} ${P(2).offerAgain(TUE_1000).text}`);
    expect(t.decision.state.lastOffer).toEqual(before.lastOffer);
    expect(t.decision.state.fields).toEqual(before.fields);
  });

  it("a Sensitive_Hit is an urgent note with the pack's term, and never becomes the Call's service", () => {
    const before = offered();
    const [t] = call(["me ha dado alergia el tinte"], "es", before);
    expect(t.decision.reply).toBe(`${P(2).sensitiveNoted(true).text} ${P(2).offerAgain(TUE_1000).text}`);
    expect(t.decision.state.notes).toEqual([{ kind: "sensitive", term: "alergia" }]);
    expect(t.decision.state.fields.serviceId).toBe("corte-hombre");
  });

  it("a question no Profile_Topic answers: an unanswered note with the Caller's words, and the Keep_Alive_Line", () => {
    const words = "¿y qué tal es Lola cortando?";
    const [t] = call([words]);
    expect(t.decision.reply).toBe(P(1).unknownKeepAlive().text);
    expect(t.decision.state.notes).toEqual([{ kind: "unanswered", question: words }]);
    expect(t.decision.complete).toBe(false);
  });

  it("at most 5 notes are kept", () => {
    const turns = call(Array.from({ length: 7 }, () => "quiero hablar con Lola"));
    expect(turns.at(-1)!.decision.state.notes).toHaveLength(5);
  });
});

describe("Profile_Topics (9.1, 9.5, 9.6)", () => {
  it("a fresh question gets the profile's answer alone, and no note", () => {
    const [t] = call(["¿aceptáis bizum?"]);
    expect(t.decision.reply).toBe(shop.faq!.find((f) => f.id === "pago")!.answer.es);
    expect(t.decision.state.notes).toBeUndefined();
    expect(t.decision.state.topics).toEqual(["faq:pago"]);
  });

  it("in the middle of a booking: the answer, then the flow's next question, in at most 3 sentences", () => {
    const before = offered();
    const [t] = call(["¿hay parking?"], "es", before);
    expect(t.decision.reply).toBe(`${shop.faq!.find((f) => f.id === "parking")!.answer.es} ${P(2).offerAgain(TUE_1000).text}`);
    expect(t.decision.state.lastOffer).toEqual(before.lastOffer);
  });

  it("a price question is answered, not booked: no offer, and the service is remembered", () => {
    const [t] = call(["¿cuánto cuesta un corte de hombre?"]);
    expect(t.decision.reply).toBe("Por un corte de hombre son catorce euros, y se tarda media hora.");
    expect(t.decision.state.lastOffer).toBeUndefined();
    expect(t.decision.state.intent).toBe("question");
    expect(t.decision.state.fields.serviceId).toBe("corte-hombre");
  });

  it("a topic and a booking in one utterance: the answer first, and the flow goes on in the same reply (3.3)", () => {
    const [t] = call(["quiero cita para un corte de hombre, ¿aceptáis bizum?"]);
    expect(t.decision.reply).toBe(`${shop.faq!.find((f) => f.id === "pago")!.answer.es} ${P(1).offerAgain(TUE_1000).text}`);
    expect(t.decision.state.lastOffer).toEqual([TUE_1000.toString()]);
  });

  it("13.3: on the model path, a Profile_Topic's template replaces the model's line, outOfProfile or not", () => {
    const reading = readUtterance({ utterance: "¿aceptáis bizum?", state: initialCallState("es"), shop, pack, now: NOW, lang: "es" });
    const turn: ModelTurn = {
      reply: "MODEL-LINE", language: "es", wantsLanguage: null, intent: "question", name: null, phone: null, service: null,
      date: null, time: null, callerConfirmed: false, callerWantsToEnd: false, outOfProfile: true, reason: "Pregunta", urgency: "low",
    };
    const d = decideTurn({ state: initialCallState("es"), facts: factsFromModel(turn, reading, shop), shop, pack, now: NOW, existing: [], callerBookings: [] });
    expect(d.reply).toBe(shop.faq!.find((f) => f.id === "pago")!.answer.es);
    expect(d.fromModel).toBe(false);
    expect(d.state.notes).toBeUndefined();
  });
});

describe("services: the Service_Request, the Service_Choice, Add_Ons and Categories", () => {
  it("a bare 'un corte' asks which; the answer makes the First_Offer (4.4, 4.5)", () => {
    const [a, b] = call(["quiero un corte", "de hombre"]);
    expect(a.decision.reply).toBe("¿El corte es de mujer, de hombre o infantil?");
    expect(a.decision.state.fields.serviceChoice?.candidates).toEqual(["corte-mujer", "corte-hombre", "corte-infantil"]);
    expect(b.decision.reply).toBe(P(2).firstOffer("corte-hombre", TUE_1000).text);
    expect(b.decision.state.fields.serviceChoice).toBeUndefined();
  });

  it("'un degradado' alone books the men's cut with it (4.10)", () => {
    const [t] = call(["quería un degradado"]);
    expect(t.decision.state.fields.serviceId).toBe("corte-hombre+degradado");
    expect(t.decision.reply).toBe(P(1).firstOffer("corte-hombre+degradado", TUE_1000).text);
  });

  it("'sin el corte' removes the cut and its fade, and says so (4.10, 7.8)", () => {
    const [, t] = call(["quería cortarme el pelo y hacerme un degradado", "mejor sin el corte de hombre"]);
    expect(t.decision.state.fields.serviceId).toBeUndefined();
    expect(t.decision.reply).toBe(P(2).addOnRemoved(["degradado"], ["corte-hombre"]).text);
  });

  it("a Category request is a choice among its services", () => {
    const [t] = call(["quería hacerme algo de color"]);
    const colour = shop.services.filter((s) => s.category === "color").map((s) => s.id);
    expect(t.decision.state.fields.serviceChoice?.candidates).toEqual(colour);
    expect(t.decision.reply).toBe(P(1).askServiceChoice(colour).text);
  });

  it("a fourth service is dropped and the Caller hears the cap (8. Result)", () => {
    const [, t] = call(["un corte de hombre y un degradado", "y también un tratamiento hidratante y un tinte de raíz"]);
    expect(t.decision.reply).toBe(P(2).tooManyServices().text);
    expect(t.decision.state.fields.serviceId).toBe("corte-hombre+degradado+hidratante");
  });

  it("a service not in the catalog: not offered, with the catalog by Category (4.8)", () => {
    const [t] = call(["quería una manicura"]);
    expect(t.decision.reply).toBe(P(1).serviceNotOffered("manicura").text);
  });

  it("a booking word with no service: the catalog question (askService)", () => {
    const [t] = call(["quería pedir cita"]);
    expect(t.decision.reply).toBe(P(1).askService().text);
  });
});

describe("the First_Offer (8.1–8.5)", () => {
  it("the nearest accepted slot from now + 30 minutes, with what the services take and cost", () => {
    const [t] = call(["Hola Lola quería cortarme el pelo y hacerme un degradado"]);
    expect(t.decision.reply).toBe(P(1).firstOffer("corte-hombre+degradado", TUE_1000).text);
    expect(t.decision.state.lastOffer).toEqual([TUE_1000.toString()]);
    expect(t.decision.state.offerKind).toBe("first");
    expect(t.decision.state.fields.requested).toBeUndefined();
  });

  it("a 'no' offers the next slot; after two in a row, the code asks for a day and time", () => {
    const [, b, c] = call(["quiero un corte de hombre", "no", "no"]);
    expect(b.decision.reply).toBe(P(2).firstOffer("corte-hombre", at("2026-11-17T09:15:00Z")).text);
    expect(b.decision.state.declined).toBe(1);
    expect(MAX_DECLINES).toBe(2);
    expect(c.decision.reply).toBe(P(3).askDayAndTime(null).text);
    expect(c.decision.state.lastOffer).toBeUndefined();
  });

  it("a part of the day narrows the offer (5.4, 8.3): 'por la tarde' is Tuesday at five", () => {
    const [t] = call(["quiero un corte de hombre por la tarde"]);
    expect(t.decision.reply).toBe(P(1).firstOffer("corte-hombre", at("2026-11-17T16:00:00Z")).text);
  });

  it("a day narrows it too: 'el jueves' is Thursday at ten, and 'no, mejor el viernes' starts again from Friday", () => {
    const [a, b] = call(["quiero un corte de hombre el jueves", "no, mejor el viernes"]);
    expect(a.decision.reply).toBe(P(1).firstOffer("corte-hombre", at("2026-11-19T09:00:00Z")).text);
    expect(b.decision.reply).toBe(P(2).firstOffer("corte-hombre", at("2026-11-20T09:00:00Z")).text);
    expect(b.decision.state.declined).toBe(0);
  });

  it("the offer skips a slot the bookings read in this request hold (8.2)", () => {
    const busy = [
      { id: "x1", resourceId: "chair-1", start: TUE_1000, end: TUE_1000.add({ minutes: 60 }) },
      { id: "x2", resourceId: "chair-2", start: TUE_1000, end: TUE_1000.add({ minutes: 60 }) },
    ];
    const [t] = brainCall(["quiero un corte de hombre"], { shop, now: NOW, existing: busy });
    expect(t.decision.reply).toBe(P(1).firstOffer("corte-hombre", at("2026-11-17T10:00:00Z")).text);
  });

  it("no slot in 14 days: the 'no encuentro otro hueco' line, and the Call goes on", () => {
    const days = Array.from({ length: 16 }, (_, d) => d);
    const full = days.flatMap((d) =>
      ["chair-1", "chair-2"].map((r) => ({ id: `${r}-${d}`, resourceId: r, start: NOW.add({ hours: 24 * d }), end: NOW.add({ hours: 24 * (d + 1) }) })),
    );
    const [t] = brainCall(["quiero un corte de hombre"], { shop, now: NOW, existing: full });
    expect(t.decision.reply).toBe(P(1).noSlotNearby().text);
    expect(t.decision.complete).toBe(false);
  });
});

describe("accepting an offer is not a booking (8.4, S2)", () => {
  it("'sí' to the First_Offer sets the requested time; the name is asked; nothing is booked", () => {
    const [, t] = call(["quiero un corte de hombre", "sí"]);
    expect(t.decision.state.fields.requested).toEqual({ date: "2026-11-17", time: "10:00" });
    expect(t.decision.state.stage).toBe("collecting");
    expect(t.decision.effects).toEqual([]);
    expect(t.decision.reply).toBe(P(2).timeAcceptedAskName(TUE_1000).text);
  });

  it("the read-back still needs its own yes, and only that yes books (1.7)", () => {
    const turns = call(["Hola Lola quería cortarme el pelo y hacerme un degradado", "sí", "Me llamo Ana", "612 345 678", "sí"]);
    expect(turns.map((t) => t.decision.effects.filter((e) => e.type !== "saveMessage").length)).toEqual([0, 0, 0, 0, 1]);
    expect(turns[3].decision.state.stage).toBe("awaiting_confirmation");
    const last = turns[4].decision;
    expect(last.complete).toBe(true);
    expect(last.outcome).toBe("booked");
    const booking = last.effects.find((e) => e.type === "createBooking");
    expect(booking?.type === "createBooking" && [booking.serviceId, booking.verdict.start.toString(), booking.verdict.end.toString()]).toEqual([
      "corte-hombre+degradado",
      "2026-11-17T09:00:00Z",
      "2026-11-17T09:50:00Z",
    ]);
  });

  it("'sí' to the alternatives of a rejection takes the first one", () => {
    const [a, b] = call(["un corte de hombre el martes a las nueve de la noche", "vale, sí"]);
    expect(a.decision.state.offerKind).toBe("alternatives");
    expect(b.decision.state.fields.requested?.time).toBe("19:30");
  });

  it("a plain 'no' to the read-back asks for another time and books nothing", () => {
    const turns = call(["quiero un corte de hombre", "sí", "Ana", "612 345 678", "no"]);
    const last = turns.at(-1)!.decision;
    expect(last.reply).toBe(P(5).askDayAndTime(null).text);
    expect(last.state.fields.requested).toBeUndefined();
    expect(last.effects).toEqual([]);
  });
});

describe("the brain's templates where the model's line was used (step 9)", () => {
  it("a rejected phone is asked again (6.5)", () => {
    const turns = call(["quiero un corte de hombre", "sí", "Ana", "512 34 56 78"]);
    expect(turns.at(-1)!.decision.reply).toBe(P(4).phoneAgain().text);
  });

  it("a cancel with no name yet asks for the name, by template", () => {
    const [t] = call(["quiero cancelar mi cita"]);
    expect(t.decision.reply).toBe(P(1).askName().text);
  });

  it("a language switch on the brain path: the template, in the new language", () => {
    const [t] = call(["in English please"]);
    expect(t.decision.state.language).toBe("en");
    expect(t.decision.reply).toBe(P(1, "en").languageSwitched().text);
  });

  it("small talk with nothing open", () => {
    expect(replies(["gracias"])).toEqual([P(1).smallTalk("thanks").text]);
    expect(replies(["hola"])).toEqual([P(1).smallTalk("greeting").text]);
  });
});

describe("the miss counter (10.3)", () => {
  it("nothing placed: the re-ask; on the third in a row, a note and the 'type instead' line", () => {
    const turns = call(["patata frita", "patata frita", "patata frita"]);
    expect(turns.map((t) => t.decision.reply)).toEqual([P(1).notUnderstood().text, P(2).notUnderstood().text, P(3).notUnderstoodAgain().text]);
    expect(MAX_MISSES).toBe(3);
    expect(turns[2].decision.state.notes).toEqual([{ kind: "not_understood" }]);
    expect(turns.every((t) => !t.decision.complete)).toBe(true);
  });

  it("a placed utterance resets the counter", () => {
    const turns = call(["patata frita", "patata frita", "¿hay parking?", "patata frita"]);
    expect(turns[2].decision.state.misses).toBe(0);
    expect(turns[3].decision.reply).toBe(P(4).notUnderstood().text);
    expect(turns[3].decision.state.notes).toBeUndefined();
  });
});

describe("ending the Call", () => {
  it("a goodbye after answered questions is 'answered'; with a note it is 'message' (10.6)", () => {
    const answered = call(["¿aceptáis bizum?", "gracias, adiós"]).at(-1)!.decision;
    expect([answered.complete, answered.outcome]).toEqual([true, "answered"]);
    // Answered with nothing the Owner can act on: no Message (backlog 25).
    expect(answered.effects.map((e) => e.type)).not.toContain("saveMessage");
    // The note promises a call back, so the first goodbye asks for the contact; the second ends (backlog 20).
    const turns = call(["¿y qué tal es Lola cortando?", "gracias, adiós", "gracias, adiós"]);
    expect(turns.at(-2)!.decision.complete).toBe(false);
    const noted = turns.at(-1)!.decision;
    expect([noted.complete, noted.outcome]).toEqual([true, "message"]);
    expect(noted.reply).toBe(phrases("es", pack, lolaSeedProfile).goodbyeNoPhone().text);
  });
});

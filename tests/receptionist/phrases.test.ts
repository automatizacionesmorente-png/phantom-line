import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { phrases, type PhraseSet, type Said } from "@/lib/receptionist/phrases";
import { toSpokenReply } from "@/lib/receptionist/speech";
import { formatSlot, formatSlotList } from "@/lib/receptionist/format";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

const pack = getSectorPack("hair-salon");
const at = (iso: string) => Temporal.Instant.from(iso);
/** Tuesday 10 November 2026, 09:00 in Madrid. "Mañana" is Wednesday 11. */
const NOW = at("2026-11-10T08:00:00Z");
const t1 = at("2026-11-11T18:30:00Z"); // Wed 11 Nov 19:30 Madrid
const t2 = at("2026-11-11T18:15:00Z");
const t3 = at("2026-11-11T18:00:00Z");
const PHONE = "+34612345678";

const text = (s: Said | string) => (typeof s === "string" ? s : s.text);

/** Calls every phrase with sample arguments. */
function render(p: PhraseSet): Record<string, Said | string> {
  return {
    greeting: p.greeting(),
    serviceNotOffered: p.serviceNotOffered("manicura"),
    serviceNotOfferedNull: p.serviceNotOffered(null),
    rejected: p.rejected("outside_hours", at("2026-11-11T20:00:00Z"), [t1, t2, t3]),
    rejectedNone: p.rejected("all_resources_busy", t1, []),
    askDayAndTime: p.askDayAndTime(null),
    askDayAndTimeDay: p.askDayAndTime(Temporal.PlainDate.from("2026-11-11")),
    timeAcceptedAskName: p.timeAcceptedAskName(at("2026-11-11T16:00:00Z")),
    askName: p.askName(),
    askNameAgain: p.askNameAgain(),
    askPhone: p.askPhone(),
    serviceInfo: p.serviceInfo("colour"),
    readBack: p.readBack("haircut", t1, "Ana", PHONE),
    slotJustTaken: p.slotJustTaken(t1, [t2]),
    slotJustTakenNone: p.slotJustTaken(null, []),
    booked: p.booked("haircut", t1),
    existingForReschedule: p.existingForReschedule("haircut", t1),
    rescheduleReadBack: p.rescheduleReadBack("haircut", t2),
    rescheduled: p.rescheduled("haircut", t2),
    cancelReadBack: p.cancelReadBack("haircut", t1),
    cancelled: p.cancelled(),
    bookingNotFound: p.bookingNotFound(),
    dontKnow: p.dontKnow(),
    goodbye: p.goodbye(),
    maxTurns: p.maxTurns(),
    fallbackEnd: p.fallbackEnd(),
    fallbackRetry: p.fallbackRetry(),
    rateLimitedStart: p.rateLimitedStart(),
    lineCut: p.lineCut(),
    typeInstead: p.typeInstead(),
    defaultReason: p.owner.defaultReason(),
    agreedBooked: p.owner.agreedBooked("haircut", t1, "chair-1"),
    agreedRescheduled: p.owner.agreedRescheduled("haircut", t1, "chair-2"),
    agreedCancelled: p.owner.agreedCancelled("haircut", t1),
    agreedNothing: p.owner.agreedNothing("quiere saber si hacéis mechas"),
    detailFallback: p.owner.detailFallback(),
    detailAbandoned: p.owner.detailAbandoned(),
    replyBooked: p.owner.replyBooked("Ana", "haircut", t1),
    replyRescheduled: p.owner.replyRescheduled(null, "haircut", t1),
    replyCancelled: p.owner.replyCancelled("Ana"),
    replyCallBack: p.owner.replyCallBack(null),
  };
}

describe("phrases", () => {
  const rawEs = render(phrases("es", pack, lolaProfile, undefined, NOW));
  const rawEn = render(phrases("en", pack, lolaProfile, undefined, NOW));
  const es = Object.fromEntries(Object.entries(rawEs).map(([k, v]) => [k, text(v)]));
  const en = Object.fromEntries(Object.entries(rawEn).map(([k, v]) => [k, text(v)]));

  it("every phrase exists in both languages, non-empty and different", () => {
    expect(Object.keys(es)).toEqual(Object.keys(en));
    for (const key of Object.keys(es)) {
      expect(es[key].trim(), key).not.toBe("");
      expect(en[key].trim(), key).not.toBe("");
      if (key !== "agreedNothing") expect(es[key], key).not.toBe(en[key]);
    }
  });

  it("the greeting is the honest, warm one: the virtual assistant, no 'contestador'", () => {
    expect(es.greeting).toBe("¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual. ¿En qué te puedo ayudar?");
    expect(en.greeting).toBe("Hi! You've reached Peluquería Lola, I'm the salon's virtual assistant. How can I help?");
    expect(es.greeting.toLowerCase()).not.toContain("contestador");
    expect(en.greeting.toLowerCase()).not.toContain("answering machine");
  });

  it("uses the exact texts of the design", () => {
    expect(es.fallbackEnd).toBe("Perdona, ahora mismo no puedo atenderte bien. Le dejo tu mensaje a Lola y te llama, ¿vale?");
    expect(en.fallbackEnd).toBe(
      "Sorry, I can't help you properly right now. I'll leave your message for Lola and you'll get a call back, okay?",
    );
    expect(es.fallbackRetry).toBe("Perdona, no te he entendido bien. ¿Me lo repites? Si quieres, se lo dejo apuntado a Lola.");
    expect(en.fallbackRetry).toBe("Sorry, I didn't catch that. Could you say it again? Or I can leave a note for Lola.");
    expect(es.serviceNotOffered).toBe("Uy, manicura no hacemos. Tenemos corte, tinte y barba, ¿te interesa algo?");
    expect(es.serviceNotOfferedNull).toBe("Uy, eso no lo hacemos. Tenemos corte, tinte y barba, ¿te interesa algo?");
    expect(es.dontKnow).toBe("Eso no lo sé, pero se lo dejo apuntado a Lola y te llama.");
    expect(es.goodbye).toBe("¡Gracias por llamar! Lola verá tu mensaje y te dice algo. ¡Hasta luego!");
    expect(es.rateLimitedStart).toBe("Uy, ahora mismo hay muchas llamadas. Prueba otra vez en unos minutos, ¿vale?");
    expect(es.typeInstead).toBe("No te oigo bien, pero puedes escribirme aquí abajo.");
  });

  it("the field asks are short and warm, and the time is spoken in words", () => {
    expect(es.askDayAndTime).toBe("¿Qué día y a qué hora te viene bien?");
    expect(es.askDayAndTimeDay).toBe("¿A qué hora te viene bien mañana?");
    expect(en.askDayAndTimeDay).toBe("What time suits you tomorrow?");
    expect(es.timeAcceptedAskName).toBe("Genial, mañana a las cinco tengo hueco. ¿Me dices tu nombre?");
    expect(en.timeAcceptedAskName).toBe("Great, tomorrow at five works. Can I have your name?");
    expect(es.askName).toBe("¿Me dices tu nombre?");
    expect(es.askNameAgain).toBe("¿Y tu nombre, para la cita?");
    expect(en.askNameAgain).toBe("And your name, for the appointment?");
    expect(es.askPhone).toBe("Perfecto. ¿Me dejas un teléfono de contacto?");
  });

  it("the read-back says service, day, time, name and the phone in groups, and asks for a yes", () => {
    expect(es.readBack).toBe(
      "Te apunto un corte mañana miércoles a las siete y media, a nombre de Ana. Tu teléfono es el seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho, ¿vale?",
    );
    expect(en.readBack).toBe(
      "I'll put you down for a haircut tomorrow, Wednesday, at half past seven, under Ana. Your number is six, one, two; three, four, five; six, seven, eight, right?",
    );
  });

  it("the rejection sounds like a person: the reason in plain words, then the nearest times first", () => {
    // Tomorrow 21:00 (outside_hours, after the last close). The caller said the hour, so the echo has no period.
    expect(es.rejected).toBe(
      "Mañana a las nueve ya hemos cerrado. ¿Te viene bien a las siete y media? También tengo a las siete y cuarto o a las siete.",
    );
    expect(en.rejected).toBe(
      "Tomorrow at nine we're already closed. Does half past seven work for you? I also have quarter past seven or seven.",
    );
    expect(es.rejectedNone).toBe(
      "Mañana a las siete y media ya está todo cogido. No encuentro otro hueco cerca, así que se lo dejo apuntado a Lola para que te llame.",
    );
  });

  it("the booked and rescheduled lines say what happens next", () => {
    expect(es.booked).toBe("¡Hecho! Te esperamos mañana miércoles a las siete y media. Lola verá tu mensaje y te confirma.");
    expect(en.booked).toBe("Done! See you tomorrow, Wednesday, at half past seven. Lola will see your message and confirm.");
    expect(es.rescheduleReadBack).toBe("Te cambio la cita para mañana miércoles a las siete y cuarto, ¿vale?");
    expect(es.cancelReadBack).toBe("Tienes un corte mañana miércoles a las siete y media. ¿Seguro que la anulo?");
    expect(es.cancelled).toBe("Hecho, he anulado tu cita. Lola verá tu mensaje. ¡Hasta pronto!");
  });

  it("the owner's texts are for reading and keep their digits", () => {
    expect(es.agreedBooked).toBe("Cita de corte el miércoles 11 a las 19:30 (Sillón 1)");
    expect(es.replyBooked).toBe("Hola Ana, te confirmo tu cita de corte el miércoles 11 a las 19:30. ¡Hasta pronto! Lola");
  });

  it("the hair salon never says mesa or table", () => {
    for (const v of Object.values(es)) expect(v.toLowerCase()).not.toMatch(/\bmesas?\b/);
    for (const v of Object.values(en)) expect(v.toLowerCase()).not.toMatch(/\btables?\b/);
  });

  it("no spoken line has a digit, and no spoken line reveals whether a booking exists", () => {
    const owner = /^(defaultReason|agreed|detail|reply)/;
    for (const [k, v] of Object.entries(es)) if (!owner.test(k)) expect(v, k).not.toMatch(/\d/);
    for (const [k, v] of Object.entries(en)) if (!owner.test(k)) expect(v, k).not.toMatch(/\d/);
    expect(es.bookingNotFound).not.toMatch(/corte|tinte|barba/);
    expect(en.bookingNotFound).not.toMatch(/haircut|colour|beard/);
  });

  it("cacheable is decided by the template: false for a name or phone and for the caller's own words", () => {
    expect((rawEs.readBack as Said).cacheable).toBe(false);
    expect((rawEs.serviceNotOffered as Said).cacheable).toBe(false);
    for (const key of ["greeting", "rejected", "timeAcceptedAskName", "askName", "askNameAgain", "askPhone", "serviceInfo", "booked", "serviceNotOfferedNull", "fallbackEnd"]) {
      expect((rawEs[key] as Said).cacheable, key).toBe(true);
      expect((rawEn[key] as Said).cacheable, key).toBe(true);
    }
    expect((rawEn.readBack as Said).cacheable).toBe(false);
  });
});

describe("phrases: the Phrase_Variants follow the Variant_Seed", () => {
  const P = (callId: string, turn: number) => phrases("es", pack, lolaProfile, { callId, turn }, NOW);

  it("the same Call and Turn always get the same wording", () => {
    for (let turn = 0; turn < 20; turn++) {
      expect(P("call-1", turn).greeting()).toEqual(P("call-1", turn).greeting());
      expect(P("call-1", turn).askPhone()).toEqual(P("call-1", turn).askPhone());
    }
  });

  it("consecutive Turns of one Call reach both wordings of a template", () => {
    for (const pick of [(p: PhraseSet) => p.greeting().text, (p: PhraseSet) => p.askName().text, (p: PhraseSet) => p.booked("haircut", t1).text]) {
      const seen = new Set<string>();
      for (let turn = 0; turn < 40; turn++) seen.add(pick(P("call-2", turn)));
      expect(seen.size).toBe(2);
    }
  });

  it("without a seed the first wording is used", () => {
    expect(phrases("es", pack, lolaProfile, undefined, NOW).greeting().text).toBe(
      "¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual. ¿En qué te puedo ayudar?",
    );
  });
});

describe("the owner's real call of 2026-11-13, in words", () => {
  const es = phrases("es", pack, lolaProfile, undefined, NOW);
  const en = phrases("en", pack, lolaProfile, undefined, NOW);
  // The call was on Friday 13 November at some time before Saturday; "mañana sábado" and 16:00.
  const FRI = at("2026-11-13T10:00:00Z"); // Friday 11:00 Madrid
  const sat1600 = at("2026-11-14T15:00:00Z");
  const sat = [at("2026-11-14T16:00:00Z"), at("2026-11-14T16:15:00Z"), at("2026-11-14T16:30:00Z")]; // 17:00, 17:15, 17:30

  it("'mañana a las cuatro': the reason without digits, when they open, and the nearest times first", () => {
    const P = phrases("es", pack, lolaProfile, undefined, FRI);
    expect(P.rejected("outside_hours", sat1600, sat).text).toBe(
      "Mañana a las cuatro estamos cerrados, abrimos a las cinco. ¿Te viene bien a las cinco? También tengo a las cinco y cuarto o a las cinco y media.",
    );
    const E = phrases("en", pack, lolaProfile, undefined, FRI);
    expect(E.rejected("outside_hours", sat1600, sat).text).toBe(
      "Tomorrow at four we're closed, we open at five. Does five work for you? I also have quarter past five or half past five.",
    );
  });

  it("'a las cinco': the time is accepted with a spoken time and no 'te anoto' before the read-back", () => {
    const P = phrases("es", pack, lolaProfile, undefined, FRI);
    const accepted = P.timeAcceptedAskName(sat[0]).text;
    expect(accepted).toBe("Genial, mañana a las cinco tengo hueco. ¿Me dices tu nombre?");
    expect(accepted).not.toMatch(/anoto|apunto|\d/);
    // The read-back is where the booking is written down.
    expect(P.readBack("haircut", sat[0], "Ana", PHONE).text).toMatch(/^Te apunto/);
  });

  it("a colour: what it takes and costs, in words", () => {
    expect(es.serviceInfo("colour").text).toBe("Claro, un tinte dura una hora y media y cuesta cuarenta y cinco euros.");
    expect(en.serviceInfo("colour").text).toBe("Sure, a colour takes an hour and a half and costs forty-five euros.");
    expect(es.serviceInfo("haircut").text).toBe("Claro, un corte dura media hora y cuesta quince euros.");
    expect(es.serviceInfo("beard").text).toBe("Claro, un arreglo de barba dura veinte minutos y cuesta diez euros.");
  });
});

describe("regressions found by N7 (see the catch log in tasks.md)", () => {
  const FAR = phrases("es", pack, lolaProfile, undefined, at("2026-12-31T12:00:00Z"));
  const FAR_EN = phrases("en", pack, lolaProfile, undefined, at("2026-12-31T12:00:00Z"));
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const sentencesOf = (s: string) => s.split(/(?<=[.!?])\s+/);

  it("a long name on a far date keeps its own sentence, so toSpokenReply never cuts the end of the name", () => {
    // Thursday 7 January 2027 at 00:05, a five-word name: one sentence would have 26 words.
    const start = at("2027-01-06T23:05:00Z");
    for (const [P, lang] of [[FAR, "es"], [FAR_EN, "en"]] as const) {
      const line = P.readBack("beard", start, "María del Carmen Pérez García", PHONE).text;
      for (const sentence of sentencesOf(line)) expect(words(sentence), sentence).toBeLessThanOrEqual(25);
      expect(line).toContain("María del Carmen Pérez García");
      expect(toSpokenReply(line, lang, { maxSentences: 3 })).toBe(line);
    }
    expect(FAR_EN.readBack("beard", start, "María del Carmen Pérez García", PHONE).text).toBe(
      "I'll put you down for a beard trim on Thursday the seventh of January at five past twelve at night. That's under María del Carmen Pérez García. Your number is six, one, two; three, four, five; six, seven, eight, right?",
    );
  });

  it("alternatives on three different days are trimmed from the far end so no sentence passes 25 words", () => {
    // The shrunk counterexample of N7: the third alternative made the second sentence 26 words long.
    const now = at("2026-03-27T22:30:00Z");
    const requested = at("2026-03-26T23:00:00Z");
    const alts = [at("2026-03-27T09:00:00Z"), at("2026-04-03T09:15:00Z"), at("2026-04-05T15:15:00Z")];
    const line = phrases("es", pack, lolaProfile, undefined, now).slotJustTaken(requested, alts).text;
    for (const sentence of sentencesOf(line)) expect(words(sentence), sentence).toBeLessThanOrEqual(25);
    expect(line).toBe(
      "¡Vaya, justo se acaba de ocupar! ¿Te viene bien a las diez? También tengo el viernes tres de abril a las once y cuarto.",
    );
    expect(line).not.toContain("domingo"); // the farthest was left out, the nearest kept
    // Alternatives on one day all fit and are all named.
    const sameDay = [at("2026-03-27T09:00:00Z"), at("2026-03-27T09:15:00Z"), at("2026-03-27T09:30:00Z")];
    expect(phrases("es", pack, lolaProfile, undefined, now).slotJustTaken(requested, sameDay).text).toBe(
      "¡Vaya, justo se acaba de ocupar! ¿Te viene bien a las diez? También tengo a las diez y cuarto o a las diez y media.",
    );
  });
});

describe("formatSlot", () => {
  it("formats in the shop's zone, in both languages", () => {
    expect(formatSlot(t1, "Europe/Madrid", "es")).toBe("el miércoles 11 a las 19:30");
    expect(formatSlot(t1, "Europe/Madrid", "en")).toBe("Wednesday the 11th at 7:30 pm");
    expect(formatSlot(at("2026-11-12T09:00:00Z"), "Europe/Madrid", "en")).toBe("Thursday the 12th at 10 am");
  });
  it("a list on one day says the day once", () => {
    expect(formatSlotList([t1, t2, at("2026-11-11T18:00:00Z")], "Europe/Madrid", "es")).toBe(
      "el miércoles 11 a las 19:30, a las 19:15 o a las 19:00",
    );
  });
});

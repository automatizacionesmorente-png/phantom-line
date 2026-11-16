import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import type { ExistingBooking } from "@/lib/booking";
import { decideTurn, publicStateOf, type DecideInput } from "@/lib/conversation/decide";
import { initialCallState, type CallerBooking, type CallState } from "@/lib/conversation/types";
import type { ModelTurn } from "@/lib/receptionist/schema";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

const pack = getSectorPack("hair-salon");
const NOW = Temporal.Instant.from("2026-11-11T08:00:00Z"); // Wednesday 11 November, 09:00 Madrid

const turn = (over: Partial<ModelTurn> = {}): ModelTurn => ({
  reply: "Vale, ¿algo más?",
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
  reason: "Quiere una cita de corte",
  urgency: "normal",
  ...over,
});
const state = (over: Partial<CallState> = {}): CallState => ({ ...initialCallState("es"), ...over });
const decide = (s: CallState, t: Partial<ModelTurn>, extra: Partial<DecideInput> = {}) =>
  decideTurn({ state: s, turn: turn(t), shop: lolaProfile, pack, now: NOW, existing: [], callerBookings: [], ...extra });
const bookingEffects = (d: { effects: { type: string }[] }) => d.effects.filter((e) => e.type !== "saveMessage");

const ANA = { name: "Ana", phone: "+34612345678" };
const anaBooking: CallerBooking = {
  id: "b-ana",
  resourceId: "chair-1",
  serviceId: "haircut",
  start: Temporal.Instant.from("2026-11-17T09:00:00Z"), // Tuesday 17, 10:00 Madrid
  end: Temporal.Instant.from("2026-11-17T09:30:00Z"),
  customerName: "Ana",
  customerPhone: "+34612345678",
};
const chair2Busy: ExistingBooking = {
  id: "other",
  resourceId: "chair-2",
  start: Temporal.Instant.from("2026-11-17T09:00:00Z"),
  end: Temporal.Instant.from("2026-11-17T11:00:00Z"),
};

describe("decideTurn: booking", () => {
  it("an unknown service gets the catalog, no effects", () => {
    const d = decide(state(), { service: "manicura" });
    expect(d.reply).toBe("Uy, manicura no hacemos. Tenemos corte, tinte y barba, ¿te interesa algo?");
    expect(d.effects).toEqual([]);
    expect(d.complete).toBe(false);
    expect(d.cacheable).toBe(false); // it repeats the caller's own word
  });

  it("a rejection offers 3 alternatives, then 'vale, a las siete y media' resolves from lastOffer", () => {
    const d1 = decide(state(), { service: "corte", date: "2026-11-11", time: "21:00" });
    expect(d1.reply).toBe(
      "A las nueve ya hemos cerrado. ¿Te viene bien a las siete y media? También tengo a las siete y cuarto o a las siete.",
    );
    expect(d1.cacheable).toBe(true);
    expect(d1.fromModel).toBe(false);
    expect(d1.state.lastOffer).toEqual(["2026-11-11T18:30:00Z", "2026-11-11T18:15:00Z", "2026-11-11T18:00:00Z"]);
    expect(d1.state.stage).toBe("collecting");

    // The model's own line ("Perfecto. ¿A nombre de quién?") is not spoken: the time was accepted, so the code asks.
    const d2 = decide(d1.state, { time: "19:30", reply: "Perfecto. ¿A nombre de quién?" });
    expect(d2.state.fields.requested).toEqual({ date: "2026-11-11", time: "19:30" });
    expect(d2.reply).toBe("Genial, hoy a las siete y media tengo hueco. ¿Me dices tu nombre?");
    expect(d2.fromModel).toBe(false);
    expect(d2.state.lastOffer).toBeUndefined();
    expect(d2.effects).toEqual([]);
  });

  it("an offered slot on another day takes that day's date", () => {
    // Sunday 15 is closed; the nearest slots are on Saturday 14.
    const d1 = decide(state(), { service: "corte", date: "2026-11-15", time: "12:00" });
    expect(d1.reply).toContain("El domingo cerramos.");
    const d2 = decide(d1.state, { time: "19:30" });
    expect(d2.state.fields.requested).toEqual({ date: "2026-11-14", time: "19:30" });
    expect(d2.reply).toBe("Genial, el sábado a las siete y media tengo hueco. ¿Me dices tu nombre?");
  });

  it("with every field present, the read-back sets awaiting_confirmation and is never cacheable", () => {
    const s = state({ intent: "booking", fields: { serviceId: "haircut", requested: { date: "2026-11-11", time: "19:30" }, name: "Ana" } });
    const d = decide(s, { phone: "612 345 678" });
    expect(d.reply).toBe(
      "Te apunto un corte hoy miércoles a las siete y media, a nombre de Ana. Tu teléfono es el seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho, ¿vale?",
    );
    expect(d.cacheable).toBe(false);
    expect(d.state.stage).toBe("awaiting_confirmation");
    expect(d.state.pending).toEqual({ kind: "book", serviceId: "haircut", start: "2026-11-11T18:30:00Z" });
    expect(d.effects).toEqual([]);
  });

  it("after the time is accepted, every missing field is asked by a template, never by the model's line", () => {
    const first = decide(state(), { service: "corte", date: "2026-11-11", time: "19:30", reply: "¿A nombre de quién?" });
    expect(first.reply).toBe("Genial, hoy a las siete y media tengo hueco. ¿Me dices tu nombre?");
    expect(first.state.stage).toBe("collecting");
    expect(first.cacheable).toBe(true);

    // The time was accepted on an earlier Turn: only the name is asked now.
    const second = decide(first.state, { reply: "MODEL-LINE" });
    expect(second.reply).toBe("¿Me dices tu nombre?");

    const third = decide(second.state, { name: "Ana", reply: "MODEL-LINE" });
    expect(third.reply).toBe("Perfecto. ¿Me dejas un teléfono de contacto?");
    expect(third.state.fields.name).toBe("Ana");

    // A phone the model could not make sense of is asked for again, by the template.
    const fourth = decide(third.state, { phone: "123", reply: "MODEL-LINE" });
    expect(fourth.reply).toBe("Perfecto. ¿Me dejas un teléfono de contacto?");
  });

  it("the model's line is still used when there is no service yet", () => {
    const d = decide(state(), { reply: "¿Qué te quieres hacer?" });
    expect(d.reply).toBe("¿Qué te quieres hacer?");
    expect(d.fromModel).toBe(true);
    expect(d.cacheable).toBe(false);
  });

  const awaiting = state({
    intent: "booking",
    stage: "awaiting_confirmation",
    fields: { ...ANA, serviceId: "haircut", requested: { date: "2026-11-11", time: "19:30" } },
    pending: { kind: "book", serviceId: "haircut", start: "2026-11-11T18:30:00Z" },
  });

  it("a confirmation emits createBooking and saveMessage, and ends the Call", () => {
    const d = decide(awaiting, { callerConfirmed: true, reply: "Sí" });
    expect(d.effects.map((e) => e.type)).toEqual(["createBooking", "saveMessage"]);
    const create = d.effects[0];
    expect(create.type === "createBooking" && [create.verdict.resourceId, create.verdict.start.toString(), create.name, create.phone]).toEqual([
      "chair-1",
      "2026-11-11T18:30:00Z",
      "Ana",
      "+34612345678",
    ]);
    expect(d.reply).toBe("¡Hecho! Te esperamos hoy miércoles a las siete y media. Lola verá tu mensaje y te confirma.");
    expect(d.complete).toBe(true);
    expect(d.outcome).toBe("booked");
    expect(d.state.stage).toBe("done");
    const msg = d.effects[1];
    expect(msg.type === "saveMessage" && msg.message.agreed).toBe("Cita de corte el miércoles 11 a las 19:30 (Sillón 1)");
  });

  it("a confirmation re-checks against fresh bookings: both chairs just taken → alternatives, no booking", () => {
    const taken = ["chair-1", "chair-2"].map((r) => ({
      id: `t-${r}`,
      resourceId: r,
      start: Temporal.Instant.from("2026-11-11T18:30:00Z"),
      end: Temporal.Instant.from("2026-11-11T19:00:00Z"),
    }));
    const d = decide(awaiting, { callerConfirmed: true }, { existing: taken });
    expect(d.effects).toEqual([]);
    // 19:15 would run into the 19:30 bookings; 19:00 ends exactly at 19:30.
    expect(d.reply).toBe(
      "¡Vaya, justo se acaba de ocupar! ¿Te viene bien a las siete? También tengo a las siete menos cuarto o a las seis y media.",
    );
    expect(d.state.stage).toBe("collecting");
    expect(d.complete).toBe(false);
  });

  it("'sí, pero a las siete' changes the time: no booking, a new read-back instead", () => {
    const d = decide(awaiting, { callerConfirmed: true, time: "19:00" });
    expect(bookingEffects(d)).toEqual([]);
    expect(d.reply).toBe(
      "Te apunto un corte hoy miércoles a las siete, a nombre de Ana. Tu teléfono es el seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho, ¿vale?",
    );
  });

  it("callerConfirmed: true outside awaiting_confirmation does nothing", () => {
    // Every field present, but no read-back was made yet.
    const s = state({ intent: "booking", fields: { ...ANA, serviceId: "haircut", requested: { date: "2026-11-11", time: "19:30" } } });
    const d = decide(s, { callerConfirmed: true });
    expect(d.effects).toEqual([]);
    expect(d.complete).toBe(false);
    expect(d.state.stage).toBe("awaiting_confirmation"); // it reads back instead
    // A pending action without the awaiting stage is ignored too.
    const forged = { ...s, pending: { kind: "book" as const, serviceId: "haircut", start: "2026-11-11T18:30:00Z" } };
    expect(decide(forged, { callerConfirmed: true }).effects).toEqual([]);
  });
});

describe("decideTurn: language, questions, limits", () => {
  it("a language switch uses the model's line in the new language and later templates follow it", () => {
    const d = decide(state(), { wantsLanguage: "en", language: "en", reply: "Of course. How can I help?" });
    expect(d.state.language).toBe("en");
    expect(d.reply).toBe("Of course. How can I help?");
    const d2 = decide(d.state, { language: "en", service: "manicure" });
    expect(d2.reply).toBe("Sorry, we don't do manicure. We have haircut, colour and beard, would any of those work?");
  });

  it("a question outside the profile gets the model's line and no effects", () => {
    const d = decide(state(), {
      intent: "question",
      outOfProfile: true,
      reply: "Eso no lo sé, pero se lo dejo apuntado a Lola para que te llame.",
    });
    expect(d.reply).toBe("Eso no lo sé, pero se lo dejo apuntado a Lola para que te llame.");
    expect(d.effects).toEqual([]);
    expect(d.complete).toBe(false);
  });

  it("the 20th Turn ends the Call with a message for the owner", () => {
    const d19 = decide(state({ turnCount: 18 }), {});
    expect(d19.complete).toBe(false);
    const d20 = decide(d19.state, {});
    expect(d20.state.turnCount).toBe(20);
    expect(d20.complete).toBe(true);
    expect(d20.outcome).toBe("message");
    expect(d20.reply).toBe("Se lo dejo todo apuntado a Lola y te llama. ¡Gracias por llamar!");
    expect(d20.effects.map((e) => e.type)).toEqual(["saveMessage"]);
  });

  it("a caller who wants to end gets what happens next, and a Message", () => {
    const d = decide(state(), { intent: "question", callerWantsToEnd: true });
    expect(d.reply).toBe("¡Gracias por llamar! Lola verá tu mensaje y te dice algo. ¡Hasta luego!");
    expect(d.outcome).toBe("answered");
    expect(d.effects.map((e) => e.type)).toEqual(["saveMessage"]);
  });
});

describe("decideTurn: reschedule and cancel", () => {
  const withCaller = (intent: "reschedule" | "cancel") => state({ intent, fields: {} });

  it("reschedule with a match: read back, ask for the new time, read back the move, confirm", () => {
    const extra = { callerBookings: [anaBooking], existing: [anaBooking, chair2Busy] };
    const d1 = decide(withCaller("reschedule"), { intent: "reschedule", phone: "612345678", name: "ana" }, extra);
    expect(d1.reply).toBe("Vale, tienes un corte el martes a las diez. ¿A qué día y hora te la cambio?");
    expect(d1.state.existingBookingId).toBe("b-ana");

    // 15 minutes later on the same chair: allowed because the booking itself is ignored.
    const d2 = decide(d1.state, { intent: "reschedule", date: "2026-11-17", time: "10:15" }, extra);
    expect(d2.reply).toBe("Te cambio la cita para el martes a las diez y cuarto, ¿vale?");
    expect(d2.state.pending).toEqual({ kind: "reschedule", serviceId: "haircut", start: "2026-11-17T09:15:00Z", oldBookingId: "b-ana" });

    const d3 = decide(d2.state, { intent: "reschedule", callerConfirmed: true }, extra);
    expect(d3.effects.map((e) => e.type)).toEqual(["reschedule", "saveMessage"]);
    const r = d3.effects[0];
    expect(r.type === "reschedule" && [r.oldBookingId, r.verdict.resourceId]).toEqual(["b-ana", "chair-1"]);
    expect(d3.outcome).toBe("rescheduled");
    expect(d3.complete).toBe(true);
  });

  it("the old time repeated by the model is not taken as the new time", () => {
    const extra = { callerBookings: [anaBooking] };
    const d1 = decide(withCaller("reschedule"), { intent: "reschedule", ...ANA, date: "2026-11-17", time: "10:00" }, extra);
    const d2 = decide(d1.state, { intent: "reschedule", date: "2026-11-17", time: "10:00" }, extra);
    expect(d2.state.pending).toBeUndefined();
    expect(d2.reply).toContain("¿A qué día y hora te la cambio?");
  });

  it("cancel with a match: read back, then the confirmation cancels", () => {
    const extra = { callerBookings: [anaBooking] };
    const d1 = decide(withCaller("cancel"), { intent: "cancel", ...ANA }, extra);
    expect(d1.reply).toBe("Tienes un corte el martes a las diez. ¿Seguro que la anulo?");
    expect(d1.state.stage).toBe("awaiting_confirmation");
    const d2 = decide(d1.state, { intent: "cancel", callerConfirmed: true }, extra);
    expect(d2.effects.map((e) => e.type)).toEqual(["cancelBooking", "saveMessage"]);
    expect(d2.effects[0]).toEqual({ type: "cancelBooking", bookingId: "b-ana" });
    expect(d2.outcome).toBe("cancelled");
    expect(d2.reply).toBe("Hecho, he anulado tu cita. Lola verá tu mensaje. ¡Hasta pronto!");
  });

  it("asks for phone and name before saying anything about a booking", () => {
    const d = decide(withCaller("cancel"), { intent: "cancel", phone: "612345678", reply: "¿Y tu nombre?" }, { callerBookings: [anaBooking] });
    expect(d.reply).toBe("¿Y tu nombre?");
    expect(d.state.existingBookingId).toBeUndefined();
  });

  for (const intent of ["reschedule", "cancel"] as const) {
    it(`${intent}: no booking for the phone and a name mismatch give the same reply and read back nothing`, () => {
      const none = decide(withCaller(intent), { intent, ...ANA }, { callerBookings: [] });
      const otherName = decide(withCaller(intent), { intent, ...ANA, name: "Marta" }, {
        callerBookings: [anaBooking],
      });
      expect(none.reply).toBe("Vaya, no encuentro nada con esos datos. ¿Quieres que le deje un mensaje a Lola?");
      expect(otherName.reply).toBe(none.reply);
      for (const d of [none, otherName]) {
        expect(d.reply).not.toMatch(/martes|17|10:00|corte/);
        expect(d.state.existingBookingId).toBeUndefined();
        expect(d.state.pending).toBeUndefined();
        expect(d.effects).toEqual([]);
      }
    });
  }

  it("a confirmation for a booking that no longer matches cancels nothing", () => {
    const s = state({
      intent: "cancel",
      stage: "awaiting_confirmation",
      fields: ANA,
      existingBookingId: "b-ana",
      pending: { kind: "cancel", bookingId: "b-ana" },
    });
    const d = decide(s, { intent: "cancel", callerConfirmed: true }, { callerBookings: [] });
    expect(d.effects).toEqual([]);
    expect(d.reply).toBe("Vaya, no encuentro nada con esos datos. ¿Quieres que le deje un mensaje a Lola?");
  });
});

describe("publicStateOf", () => {
  it("shows server fields only", () => {
    const s = state({ intent: "booking", fields: { ...ANA, serviceId: "haircut", requested: { date: "2026-11-11", time: "19:30" } } });
    expect(publicStateOf(s, lolaProfile, false)).toEqual({
      intent: "booking",
      fields: { name: "Ana", phone: "+34612345678", service: "corte", requestedTime: "2026-11-11T19:30" },
      complete: false,
    });
  });
});

describe("decideTurn: the owner's real call of 2026-11-13", () => {
  // Wednesday 11 November, 09:00 in Madrid, so "mañana" is Thursday 12.
  const tomorrow = "2026-11-12";
  const withService = (serviceId: string, time: string, extra: Partial<CallState["fields"]> = {}) =>
    state({ intent: "booking", fields: { serviceId, requested: { date: tomorrow, time }, ...extra } });

  it("'me puedo pintar el pelo de rosa' is the colour service: yes, with its length and price, and the time re-checked", () => {
    const d = decide(withService("haircut", "17:00"), {
      service: "pintar el pelo de rosa",
      reason: "Quiere pintarse el pelo de rosa",
      reply: "Lo de pintar el pelo de rosa se lo dejo apuntado a Lola para que te llame.",
    });
    expect(d.state.fields.serviceId).toBe("colour");
    expect(d.reply).toBe(
      "Claro, un tinte dura una hora y media y cuesta cuarenta y cinco euros. Genial, mañana a las cinco tengo hueco. ¿Me dices tu nombre?",
    );
    expect(d.fromModel).toBe(false);
    expect(d.reply).not.toMatch(/\d|apuntado a Lola/);
    // What Lola reads keeps the shade, and nothing promises the result.
    expect(d.state.note.reason).toBe("Quiere pintarse el pelo de rosa");
  });

  it.each(["pintarme el pelo", "teñir", "tinte", "color", "mechas", "dye my hair", "highlights", "hair colour"])(
    "'%s' matches the colour service",
    (said) => {
      const d = decide(withService("haircut", "17:00"), { service: said });
      expect(d.state.fields.serviceId).toBe("colour");
    },
  );

  it("the longer service is checked against the closing time: 19:00 + 90 minutes does not fit, 17:00 does", () => {
    const tight = decide(withService("haircut", "19:00"), { service: "teñirme el pelo" });
    expect(tight.reply).toBe(
      "Mañana a las siete no nos da tiempo antes de cerrar. ¿Te viene bien a las seis y media? También tengo a las seis y cuarto o a las seis.",
    );
    expect(tight.state.lastOffer?.[0]).toBe("2026-11-12T17:30:00Z"); // 18:30 + 90 min ends exactly at 20:00
    expect(tight.state.stage).toBe("collecting");
    // 17:00 + 90 minutes ends at 18:30, before the 20:00 close.
    expect(decide(withService("haircut", "17:00"), { service: "teñirme el pelo" }).reply).toContain("tengo hueco");
  });

  it("with name and phone already given, the switch is read back in full, with the new service's length and price", () => {
    const d = decide(withService("haircut", "17:00", ANA), { service: "tinte" });
    expect(d.state.stage).toBe("awaiting_confirmation");
    expect(d.state.pending).toEqual({ kind: "book", serviceId: "colour", start: "2026-11-12T16:00:00Z" });
    expect(d.reply).toBe(
      "Claro, un tinte dura una hora y media y cuesta cuarenta y cinco euros. Te apunto un tinte mañana jueves a las cinco, a nombre de Ana. Tu teléfono es el seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho, ¿vale?",
    );
    expect(d.cacheable).toBe(false);
  });

  it("the same service again does not repeat what it takes and costs", () => {
    const d = decide(withService("colour", "17:00"), { service: "tinte" });
    expect(d.reply).toBe("¿Me dices tu nombre?");
  });

  it("'a las cinco, no a las diecisiete': the accepted time is spoken, nothing is 'anotado' before the read-back", () => {
    const afterRejection = decide(state(), { service: "corte", date: tomorrow, time: "16:00" });
    expect(afterRejection.reply).toBe(
      "Mañana a las cuatro estamos cerrados, abrimos a las cinco. ¿Te viene bien a las cinco? También tengo a las cinco y cuarto o a las cinco y media.",
    );
    const accepted = decide(afterRejection.state, { time: "17:00", reply: "Perfecto, te anoto a las 17:00. ¿Cuál es tu nombre?" });
    expect(accepted.reply).toBe("Genial, mañana a las cinco tengo hueco. ¿Me dices tu nombre?");
    expect(accepted.reply).not.toMatch(/anoto|apunto|\d/);
  });
});

describe("decideTurn: a name that is clearly not a name is asked for once more", () => {
  const ready = state({ intent: "booking", fields: { serviceId: "haircut", requested: { date: "2026-11-12", time: "17:00" } } });

  it("'Mi amor' is not kept; the caller is asked once, then whatever they say is taken", () => {
    const first = decide(ready, { name: "Mi amor", reply: "Encantada, Mi amor." });
    expect(first.reply).toBe("¿Y tu nombre, para la cita?");
    expect(first.state.fields.name).toBeUndefined();
    expect(first.state.nameReasked).toBe(true);
    expect(first.cacheable).toBe(true);
    expect(first.reply).not.toMatch(/amor/i);

    // They insist: it is accepted, and the phone is next.
    const second = decide(first.state, { name: "Mi amor" });
    expect(second.state.fields.name).toBe("Mi amor");
    expect(second.reply).toBe("Perfecto. ¿Me dejas un teléfono de contacto?");
    expect(second.state.nameReasked).toBe(true);
  });

  it("a real name after the re-ask replaces it, and a real name the first time is never questioned", () => {
    const first = decide(ready, { name: "cariño" });
    const second = decide(first.state, { name: "Marta" });
    expect(second.state.fields.name).toBe("Marta");
    const direct = decide(ready, { name: "Marta" });
    expect(direct.reply).toBe("Perfecto. ¿Me dejas un teléfono de contacto?");
    expect(direct.state.nameReasked).toBeUndefined();
  });

  it("a rejected time in the same Turn drops the name without using up the one re-ask", () => {
    const d = decide(ready, { name: "Pánfilo", date: "2026-11-12", time: "21:00" });
    expect(d.reply).toContain("ya hemos cerrado");
    expect(d.state.fields.name).toBeUndefined();
    expect(d.state.nameReasked).toBeUndefined();
  });

  it("a name already given is not replaced by an endearment", () => {
    const named = state({ intent: "booking", fields: { ...ready.fields, name: "Ana" } });
    const d = decide(named, { name: "mi vida" });
    expect(d.state.fields.name).toBe("Ana");
    expect(d.reply).toBe("Perfecto. ¿Me dejas un teléfono de contacto?");
    expect(d.state.nameReasked).toBeUndefined();
  });
});

describe("decideTurn: the Variant_Seed", () => {
  it("the same Call and Turn say the same words; Turns of one Call reach both wordings", () => {
    const seen = new Set<string>();
    for (let turnCount = 0; turnCount < 18; turnCount++) {
      const s = state({ intent: "booking", turnCount, fields: { serviceId: "haircut", requested: { date: "2026-11-12", time: "17:00" } } });
      const a = decide(s, {}, { callId: "call-seed" });
      const b = decide(s, {}, { callId: "call-seed" });
      expect(a.reply).toBe(b.reply);
      seen.add(a.reply);
    }
    expect(seen).toEqual(new Set(["¿Me dices tu nombre?", "¿A nombre de quién lo pongo?"]));
  });
});

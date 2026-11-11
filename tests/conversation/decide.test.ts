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
    expect(d.reply).toBe("No hacemos manicura. Hacemos corte, tinte y barba.");
    expect(d.effects).toEqual([]);
    expect(d.complete).toBe(false);
  });

  it("a rejection offers 3 alternatives, then 'vale, a las siete y media' resolves from lastOffer", () => {
    const d1 = decide(state(), { service: "corte", date: "2026-11-11", time: "21:00" });
    expect(d1.reply).toBe(
      "El miércoles 11 a las 21:00 no es posible, a esa hora está cerrado. Tengo libre el miércoles 11 a las 19:30, a las 19:15 o a las 19:00.",
    );
    expect(d1.state.lastOffer).toEqual(["2026-11-11T18:30:00Z", "2026-11-11T18:15:00Z", "2026-11-11T18:00:00Z"]);
    expect(d1.state.stage).toBe("collecting");

    const d2 = decide(d1.state, { time: "19:30", reply: "Perfecto. ¿A nombre de quién?" });
    expect(d2.state.fields.requested).toEqual({ date: "2026-11-11", time: "19:30" });
    expect(d2.reply).toBe("Perfecto. ¿A nombre de quién?");
    expect(d2.state.lastOffer).toBeUndefined();
    expect(d2.effects).toEqual([]);
  });

  it("an offered slot on another day takes that day's date", () => {
    // Sunday 15 is closed; the nearest slots are on Saturday 14.
    const d1 = decide(state(), { service: "corte", date: "2026-11-15", time: "12:00" });
    expect(d1.reply).toContain("ese día está cerrado");
    const d2 = decide(d1.state, { time: "19:30" });
    expect(d2.state.fields.requested).toEqual({ date: "2026-11-14", time: "19:30" });
  });

  it("with every field present, the read-back sets awaiting_confirmation", () => {
    const s = state({ intent: "booking", fields: { serviceId: "haircut", requested: { date: "2026-11-11", time: "19:30" }, name: "Ana" } });
    const d = decide(s, { phone: "612 345 678" });
    expect(d.reply).toBe("Entonces, cita de corte el miércoles 11 a las 19:30. ¿Te lo confirmo?");
    expect(d.state.stage).toBe("awaiting_confirmation");
    expect(d.state.pending).toEqual({ kind: "book", serviceId: "haircut", start: "2026-11-11T18:30:00Z" });
    expect(d.effects).toEqual([]);
  });

  it("asks for missing fields with the model's line, after the time is accepted", () => {
    const d = decide(state(), { service: "corte", date: "2026-11-11", time: "19:30", reply: "¿A nombre de quién?" });
    expect(d.reply).toBe("¿A nombre de quién?");
    expect(d.state.stage).toBe("collecting");
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
    expect(d.reply).toBe("Apuntado: cita de corte el miércoles 11 a las 19:30. Lola verá tu mensaje y te confirma.");
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
    expect(d.reply).toBe("Justo se acaba de ocupar. Tengo libre el miércoles 11 a las 19:00, a las 18:45 o a las 18:30.");
    expect(d.state.stage).toBe("collecting");
    expect(d.complete).toBe(false);
  });

  it("'sí, pero a las siete' changes the time: no booking, a new read-back instead", () => {
    const d = decide(awaiting, { callerConfirmed: true, time: "19:00" });
    expect(bookingEffects(d)).toEqual([]);
    expect(d.reply).toBe("Entonces, cita de corte el miércoles 11 a las 19:00. ¿Te lo confirmo?");
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
    expect(d2.reply).toBe("We don't do manicure. We do haircut, colour and beard.");
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
    expect(d20.reply).toBe("Te dejo el mensaje a Lola y te llamará. Gracias por llamar.");
    expect(d20.effects.map((e) => e.type)).toEqual(["saveMessage"]);
  });

  it("a caller who wants to end gets what happens next, and a Message", () => {
    const d = decide(state(), { intent: "question", callerWantsToEnd: true });
    expect(d.reply).toBe("Gracias por llamar. Lola verá tu mensaje y te llamará.");
    expect(d.outcome).toBe("answered");
    expect(d.effects.map((e) => e.type)).toEqual(["saveMessage"]);
  });
});

describe("decideTurn: reschedule and cancel", () => {
  const withCaller = (intent: "reschedule" | "cancel") => state({ intent, fields: {} });

  it("reschedule with a match: read back, ask for the new time, read back the move, confirm", () => {
    const extra = { callerBookings: [anaBooking], existing: [anaBooking, chair2Busy] };
    const d1 = decide(withCaller("reschedule"), { intent: "reschedule", phone: "612345678", name: "ana" }, extra);
    expect(d1.reply).toBe("Tienes cita de corte el martes 17 a las 10:00. ¿Qué otro día y hora te viene bien?");
    expect(d1.state.existingBookingId).toBe("b-ana");

    // 15 minutes later on the same chair: allowed because the booking itself is ignored.
    const d2 = decide(d1.state, { intent: "reschedule", date: "2026-11-17", time: "10:15" }, extra);
    expect(d2.reply).toBe("Entonces paso tu cita de corte el martes 17 a las 10:15. ¿Te lo confirmo?");
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
    expect(d2.reply).toContain("¿Qué otro día y hora te viene bien?");
  });

  it("cancel with a match: read back, then the confirmation cancels", () => {
    const extra = { callerBookings: [anaBooking] };
    const d1 = decide(withCaller("cancel"), { intent: "cancel", ...ANA }, extra);
    expect(d1.reply).toBe("Tienes cita de corte el martes 17 a las 10:00. ¿Confirmas que la anulo?");
    expect(d1.state.stage).toBe("awaiting_confirmation");
    const d2 = decide(d1.state, { intent: "cancel", callerConfirmed: true }, extra);
    expect(d2.effects.map((e) => e.type)).toEqual(["cancelBooking", "saveMessage"]);
    expect(d2.effects[0]).toEqual({ type: "cancelBooking", bookingId: "b-ana" });
    expect(d2.outcome).toBe("cancelled");
    expect(d2.reply).toBe("Hecho, he anulado tu cita. Lola verá tu mensaje.");
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
      expect(none.reply).toBe("No encuentro nada con esos datos. ¿Quieres que le deje un mensaje a Lola?");
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
    expect(d.reply).toBe("No encuentro nada con esos datos. ¿Quieres que le deje un mensaje a Lola?");
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

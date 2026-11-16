import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { messageWrite } from "@/lib/conversation/messageWrite";
import { buildOwnerMessage } from "@/lib/conversation/ownerMessage";
import { initialCallState, type CallState, type Line, type Urgency, type Write } from "@/lib/conversation/types";
import type { FinalUrgency } from "@/lib/messages/urgency";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

/** Owner-machine task 9: the one place an end-of-Call Message becomes a write. */
const pack = getSectorPack("hair-salon");
/** Tuesday 10 November 2026, 09:00 in Madrid. */
const NOW = Temporal.Instant.from("2026-11-10T08:00:00Z");
const call = { id: "call-1", channel: "voice" as const };
const ctx = (transcript: Line[], bookingId?: string) => ({ call, shop: lolaProfile, pack, transcript, now: NOW, ...(bookingId ? { bookingId } : {}) });
const asked = (urgency: Urgency): CallState => ({
  ...initialCallState("es"),
  intent: "booking",
  fields: { name: "Ana", phone: "+34612345678" },
  note: { reason: "Quiere un corte", urgency },
});
const greeting: Line = { caller: "", receptionist: "¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual." };

describe("messageWrite", () => {
  it("a Caller line with an urgent term raises the model's low to urgent, and keeps the suggestion next to it", () => {
    const w = messageWrite(buildOwnerMessage(asked("low"), "message", lolaProfile, pack), ctx([greeting, { caller: "Es urgente, por favor", receptionist: "Vale." }]));
    expect(w.message).toMatchObject({
      urgency: "urgent",
      urgencySuggested: "low",
      urgencyBasis: { rule: "urgent_term", term: "urgente", lang: "es" },
      shopId: lolaProfile.id,
      callId: "call-1",
      channel: "voice",
    });
    expect(w.message).not.toHaveProperty("bookingId");
  });

  it("the Receptionist's 'hoy' does not raise (5.10)", () => {
    const w = messageWrite(
      buildOwnerMessage(asked("low"), "abandoned", lolaProfile, pack),
      ctx([greeting, { caller: "Quería pedir cita", receptionist: "¿A qué hora te viene bien hoy?" }]),
    );
    expect(w.message).toMatchObject({ urgency: "low", urgencySuggested: "low", urgencyBasis: { rule: "none" } });
  });

  it("a Booking made for today is normal, with the booking's day as the basis (5.5)", () => {
    const start = Temporal.Instant.from("2026-11-10T16:00:00Z"); // 17:00 today in Madrid
    const draft = buildOwnerMessage(asked("low"), "booked", lolaProfile, pack, { serviceId: "haircut", start, resourceId: "chair-1" });
    const w = messageWrite(draft, ctx([greeting, { caller: "Un corte a las cinco", receptionist: "Hecho." }], "b-1"));
    expect(w.message).toMatchObject({ urgency: "normal", urgencyBasis: { rule: "today_handled", via: "booking_day" }, bookingId: "b-1" });
  });

  it("a requested day of today that was not booked is urgent (5.4)", () => {
    const state: CallState = { ...asked("low"), fields: { ...asked("low").fields, requested: { date: "2026-11-10", time: "17:00" } } };
    const w = messageWrite(buildOwnerMessage(state, "abandoned", lolaProfile, pack), ctx([greeting]));
    expect(w.message).toMatchObject({ urgency: "urgent", urgencyBasis: { rule: "today_open", via: "requested_day" } });
  });

  it("a fallback with no valid Turn: no suggestion, normal from model_failed (5.6, 5.8)", () => {
    const w = messageWrite(buildOwnerMessage(initialCallState("es"), "fallback", lolaProfile, pack), ctx([greeting]));
    expect(w.message).toMatchObject({ urgency: "normal", urgencySuggested: null, urgencyBasis: { rule: "model_failed" }, modelFailed: true });
  });

  it("the draft's own facts never reach the write", () => {
    const w = messageWrite(buildOwnerMessage(asked("normal"), "message", lolaProfile, pack), ctx([greeting]));
    for (const k of ["suggested", "requestedDate", "bookingStart"]) expect(w.message).not.toHaveProperty(k);
  });

  it("the types refuse an urgency that skipped decideUrgency (checked by tsc --noEmit)", () => {
    const draft = buildOwnerMessage(asked("low"), "message", lolaProfile, pack);
    // @ts-expect-error a plain Urgency is not a FinalUrgency
    const plain: FinalUrgency = "urgent" as Urgency;
    // @ts-expect-error a draft cannot be written as it is: it has no final urgency
    const skipped: Write = { type: "insertMessage", message: { ...draft, shopId: "s", callId: "c", channel: "voice" } };
    expect([plain, skipped.type]).toEqual(["urgent", "insertMessage"]);
  });
});

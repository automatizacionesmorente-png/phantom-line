import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { buildOwnerMessage, MAX_REASON_CHARS } from "@/lib/conversation/ownerMessage";
import { initialCallState, type CallState } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import { getSectorPack } from "@/lib/sectors";
import { brainCall, SAT_1930 } from "./brainCall";

/** front-desk-brain 8.4: `buildOwnerMessage` for Calls with brain Turns and Owner_Notes (10.5–10.7). */
const shop = lolaSeedProfile;
const pack = getSectorPack("hair-salon");
const state = (over: Partial<CallState> = {}): CallState => ({ ...initialCallState("es"), ...over });

describe("the code-built reason when the Call had brain Turns (10.7)", () => {
  it("the services asked for, the topics answered and the notes, in the Call's language", () => {
    const s = state({
      brainTurns: 3,
      fields: { serviceId: "corte-hombre+degradado" },
      topics: ["hours", "faq:pago"],
      notes: [{ kind: "owner_request" }],
    });
    expect(buildOwnerMessage(s, "message", shop, pack).reason).toBe(
      "Quiere Corte de hombre + Degradado. Preguntó por el horario y pagar con tarjeta. Pide que Lola le llame",
    );
    expect(buildOwnerMessage({ ...s, language: "en" }, "message", shop, pack).reason).toBe(
      "Wants Men's cut + Fade. Asked about the opening hours and pay by card. Asked for Lola to call back",
    );
  });

  it("an open Service_Choice names its candidates", () => {
    const s = state({ brainTurns: 1, fields: { serviceChoice: { candidates: ["corte-mujer", "corte-hombre"], with: [] } } });
    expect(buildOwnerMessage(s, "message", shop, pack).reason).toBe("Quiere Corte de mujer o Corte de hombre");
  });

  it("a brain Call with nothing to say gets the default reason", () => {
    expect(buildOwnerMessage(state({ brainTurns: 1 }), "abandoned", shop, pack).reason).toBe("Llamada sin terminar");
  });

  it("at most 160 characters", () => {
    const long = "¿".padEnd(150, "a") + "?";
    const s = state({ brainTurns: 2, fields: { serviceId: "corte-hombre" }, notes: [{ kind: "unanswered", question: long }, { kind: "owner_request" }] });
    const reason = buildOwnerMessage(s, "message", shop, pack).reason;
    expect(reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
    expect(reason.startsWith("Quiere Corte de hombre. Sin respuesta: «¿aaa")).toBe(true);
    expect(reason.endsWith("…")).toBe(true);
  });
});

describe("the Owner_Notes after the main reason (10.6)", () => {
  it("model-only Call: the model's reason first, then the notes", () => {
    const s = state({ note: { reason: "Quiere cita para un corte", urgency: "normal" }, notes: [{ kind: "sensitive", term: "alergia" }] });
    expect(buildOwnerMessage(s, "message", shop, pack).reason).toBe("Quiere cita para un corte. Tema delicado («alergia»), no se le aconsejó");
  });

  it("a model-only Call with no notes keeps the model's reason exactly (owner-machine unchanged)", () => {
    const s = state({ note: { reason: "Pregunta precios", urgency: "low" } });
    expect(buildOwnerMessage(s, "answered", shop, pack).reason).toBe("Pregunta precios");
  });

  it("the Owner never sees an empty reason", () => {
    expect(buildOwnerMessage(state(), "message", shop, pack).reason).toBe("Llamada sin terminar");
  });
});

describe("the outcome with notes (10.6)", () => {
  it("'answered' with notes left becomes 'message'", () => {
    const s = state({ brainTurns: 1, notes: [{ kind: "unanswered", question: "¿qué tal es Lola?" }] });
    expect(buildOwnerMessage(s, "answered", shop, pack).outcome).toBe("message");
    expect(buildOwnerMessage(state({ brainTurns: 1 }), "answered", shop, pack).outcome).toBe("answered");
  });

  it("a booked Call stays booked, and its reason still lists the notes", () => {
    const s = state({ brainTurns: 4, fields: { serviceId: "corte-hombre", name: "Ana", phone: "+34612345678" }, notes: [{ kind: "owner_request" }] });
    const booking = { serviceId: "corte-hombre", start: Temporal.Instant.from("2026-11-17T09:00:00Z"), resourceId: "chair-1" };
    const m = buildOwnerMessage(s, "booked", shop, pack, booking);
    expect(m.outcome).toBe("booked");
    expect(m.reason).toBe("Quiere Corte de hombre. Pide que Lola le llame");
  });
});

describe("the suggested urgency is null when no Turn had a valid model answer (owner-machine 5.8)", () => {
  it("a brain-only Call: suggested null; a Call with a model Turn keeps the model's suggestion", () => {
    expect(buildOwnerMessage(state({ brainTurns: 5 }), "message", shop, pack).suggested).toBeNull();
    const mixed = state({ brainTurns: 2, note: { reason: "Quiere cita", urgency: "urgent" } });
    expect(buildOwnerMessage(mixed, "message", shop, pack).suggested).toBe("urgent");
  });

  it("end to end: a brain-only Call's Message has no suggestion and a code-built reason", () => {
    const turns = brainCall(["¿aceptáis bizum?", "quiero hablar con Lola", "gracias, adiós"], { shop, now: SAT_1930 });
    const save = turns.at(-1)!.decision.effects.find((e) => e.type === "saveMessage");
    expect(save?.type === "saveMessage" && save.message).toMatchObject({
      outcome: "message",
      suggested: null,
      reason: "Preguntó por pagar con tarjeta. Pide que Lola le llame",
    });
  });
});

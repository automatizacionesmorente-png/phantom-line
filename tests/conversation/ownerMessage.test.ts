import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { buildOwnerMessage } from "@/lib/conversation/ownerMessage";
import { initialCallState, type CallState, type Outcome } from "@/lib/conversation/types";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

const pack = getSectorPack("hair-salon");
const start = Temporal.Instant.from("2026-11-11T18:30:00Z"); // Wed 19:30 Madrid
const booking = { serviceId: "haircut", start, resourceId: "chair-1" };
const full: CallState = {
  ...initialCallState("es"),
  intent: "booking",
  fields: { name: "Ana", phone: "+34612345678", serviceId: "haircut", requested: { date: "2026-11-11", time: "19:30" } },
  note: { reason: "Quiere cortarse el pelo", urgency: "low" },
};
const OUTCOMES: Outcome[] = ["booked", "rescheduled", "cancelled", "answered", "message", "fallback", "abandoned"];

describe("buildOwnerMessage", () => {
  it("fills every field for every outcome when the caller gave name and phone", () => {
    for (const outcome of OUTCOMES) {
      const m = buildOwnerMessage(full, outcome, lolaProfile, pack, booking);
      expect(m.outcome).toBe(outcome);
      for (const [k, v] of Object.entries(m)) {
        if (typeof v === "string") expect(v.trim(), `${outcome}.${k}`).not.toBe("");
        else expect(v, `${outcome}.${k}`).not.toBeNull();
      }
      expect(m.callerName).toBe("Ana");
      expect(m.callerPhone).toBe("+34612345678");
      expect(m.urgency).toBe("low");
    }
  });

  it("writes what was agreed and the suggested reply from the outcome", () => {
    const booked = buildOwnerMessage(full, "booked", lolaProfile, pack, booking);
    expect(booked.agreed).toBe("Cita de corte el miércoles 11 a las 19:30 (Sillón 1)");
    expect(booked.suggestedReply).toBe("Hola Ana, te confirmo tu cita de corte el miércoles 11 a las 19:30. ¡Hasta pronto! Lola");
    expect(buildOwnerMessage(full, "answered", lolaProfile, pack).agreed).toBe("Nada acordado; Quiere cortarse el pelo");
    expect(buildOwnerMessage(full, "abandoned", lolaProfile, pack).agreed).toBe("Nada acordado; colgó antes de terminar");
    expect(buildOwnerMessage(full, "cancelled", lolaProfile, pack, booking).agreed).toContain("anulada");
    expect(buildOwnerMessage(full, "rescheduled", lolaProfile, pack, booking).agreed).toContain("ahora el miércoles 11 a las 19:30");
  });

  it("sets modelFailed on fallback, and only then (unless the state already failed)", () => {
    for (const outcome of OUTCOMES) {
      expect(buildOwnerMessage(full, outcome, lolaProfile, pack, booking).modelFailed).toBe(outcome === "fallback");
    }
    expect(buildOwnerMessage({ ...full, modelFailed: true }, "message", lolaProfile, pack).modelFailed).toBe(true);
  });

  it("after an early failure: no name or phone, but reason, urgency, agreed and reply are filled", () => {
    const m = buildOwnerMessage(initialCallState("en"), "fallback", lolaProfile, pack);
    expect(m.callerName).toBeNull();
    expect(m.callerPhone).toBeNull();
    expect(m.reason).toBe("Llamada sin terminar");
    expect(m.urgency).toBe("normal");
    expect(m.agreed).toBe("Nada acordado; el contestador falló a mitad de la llamada");
    // The suggested reply is in the caller's language.
    expect(m.suggestedReply).toBe("Hi, this is Lola from Peluquería Lola. I got your message, how can I help?");
    expect(m.modelFailed).toBe(true);
  });
});

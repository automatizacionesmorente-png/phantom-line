import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { buildOwnerMessage } from "@/lib/conversation/ownerMessage";
import { initialCallState, type CallState, type Outcome } from "@/lib/conversation/types";
import { agreedText, type AgreedBooking } from "@/lib/messages/agreedText";
import { currentReply, type ReplyBooking } from "@/lib/messages/currentReply";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

const pack = getSectorPack("hair-salon");
const at = (iso: string) => Temporal.Instant.from(iso);

const start = at("2026-11-11T18:30:00Z"); // Wednesday 11, 19:30 in Madrid
const moved = at("2026-11-13T09:00:00Z"); // Friday 13, 10:00 in Madrid
const createdAt = at("2026-11-10T12:00:00Z");

const call = (language: "es" | "en"): CallState => ({
  ...initialCallState(language),
  intent: "booking",
  fields: { name: "Ana", phone: "+34612345678", serviceId: "haircut", requested: { date: "2026-11-11", time: "19:30" } },
  note: { reason: "Quiere cortarse el pelo", urgency: "low" },
});

const stored = (language: "es" | "en", outcome: Outcome = "booked") => {
  const m = buildOwnerMessage(call(language), outcome, lolaProfile, pack, {
    serviceId: "haircut",
    start,
    resourceId: "chair-1",
  });
  return { ...m, createdAt };
};

const replyBooking = (over: Partial<ReplyBooking> = {}): ReplyBooking => ({
  serviceId: "haircut",
  start,
  status: "confirmed",
  cancelledBy: null,
  ownerMovedAt: null,
  ...over,
});

describe("currentReply (owner-machine 4.6)", () => {
  it("is the stored reply while nothing changed, and without a Booking", () => {
    const m = stored("es");
    expect(currentReply(m, replyBooking(), "es", lolaProfile, pack)).toBe(m.suggestedReply);
    expect(currentReply(m, null, "es", lolaProfile, pack)).toBe(m.suggestedReply);
  });

  it("after an owner move, it states the new time in the Call's language", () => {
    const es = stored("es");
    const movedBooking = replyBooking({ start: moved, ownerMovedAt: at("2026-11-10T15:00:00Z") });
    expect(currentReply(es, movedBooking, "es", lolaProfile, pack)).toBe(
      "Hola Ana, te confirmo el cambio: tu cita de corte queda el viernes 13 a las 10:00. ¡Hasta pronto! Lola",
    );
    const en = stored("en");
    expect(currentReply(en, movedBooking, "en", lolaProfile, pack)).toContain("Friday the 13th at 10 am");
    expect(currentReply(en, movedBooking, "en", lolaProfile, pack)).not.toContain("Wednesday");
  });

  it("after an owner cancel, it says the Booking was cancelled", () => {
    const m = stored("es");
    const reply = currentReply(m, replyBooking({ status: "cancelled", cancelledBy: "owner" }), "es", lolaProfile, pack);
    expect(reply).toBe("Hola Ana, te confirmo que he anulado tu cita. Cuando quieras, vuelve a llamar. Lola");
    expect(reply).not.toBe(m.suggestedReply);
  });

  it("after a cancel by the caller (or a move by the caller, which cancels this Booking), it says the Booking was cancelled (backlog 19)", () => {
    const m = stored("es");
    const byCaller = replyBooking({ status: "cancelled", cancelledBy: "caller" });
    const reply = currentReply(m, byCaller, "es", lolaProfile, pack);
    expect(reply).toBe("Hola Ana, te confirmo que he anulado tu cita. Cuando quieras, vuelve a llamar. Lola");
    expect(reply).not.toContain("miércoles");
  });

  it("is unchanged when the owner's move came before the Message", () => {
    const m = stored("es");
    const earlierMove = replyBooking({ start: moved, ownerMovedAt: at("2026-11-10T11:59:00Z") });
    expect(currentReply(m, earlierMove, "es", lolaProfile, pack)).toBe(m.suggestedReply);
    const sameInstant = replyBooking({ start: moved, ownerMovedAt: createdAt });
    expect(currentReply(m, sameInstant, "es", lolaProfile, pack)).toBe(m.suggestedReply);
  });
});

const agreed = (over: Partial<AgreedBooking> = {}): AgreedBooking => ({
  serviceId: "haircut",
  resourceId: "chair-1",
  start,
  status: "confirmed",
  ...over,
});

describe("agreedText (owner-machine 4.7)", () => {
  it("booked, in Spanish and English", () => {
    expect(agreedText("booked", agreed(), "es", lolaProfile, pack)).toBe(
      "Cita de corte el miércoles 11 a las 19:30 (Sillón 1)",
    );
    expect(agreedText("booked", agreed(), "en", lolaProfile, pack)).toBe(
      "Haircut appointment on Wednesday the 11th at 7:30 pm (Chair 1)",
    );
  });

  it("rescheduled, in Spanish and English", () => {
    expect(agreedText("rescheduled", agreed(), "es", lolaProfile, pack)).toBe(
      "Cita de corte cambiada: ahora el miércoles 11 a las 19:30 (Sillón 1)",
    );
    expect(agreedText("rescheduled", agreed(), "en", lolaProfile, pack)).toContain("Wednesday the 11th at 7:30 pm");
  });

  it("moved by the owner: the new time and Resource, in Spanish and English", () => {
    const b = agreed({ start: moved, resourceId: "chair-2" });
    expect(agreedText("booked", b, "es", lolaProfile, pack)).toBe("Cita de corte el viernes 13 a las 10:00 (Sillón 2)");
    expect(agreedText("booked", b, "en", lolaProfile, pack)).toContain("Friday the 13th at 10 am (Chair 2)");
  });

  it("cancelled, whatever the outcome was, in Spanish and English", () => {
    const b = agreed({ status: "cancelled" });
    for (const outcome of ["booked", "rescheduled", "cancelled"] as const) {
      expect(agreedText(outcome, b, "es", lolaProfile, pack)).toContain("anulada");
      expect(agreedText(outcome, b, "es", lolaProfile, pack)).toContain("el miércoles 11 a las 19:30");
      expect(agreedText(outcome, b, "en", lolaProfile, pack)).toContain("Wednesday the 11th at 7:30 pm");
    }
    expect(agreedText("booked", b, "en", lolaProfile, pack)).not.toBe(agreedText("booked", agreed(), "en", lolaProfile, pack));
  });

  it("the Spanish text of an unchanged Booking equals what buildOwnerMessage stored", () => {
    // Lola's first language is Spanish, so buildOwnerMessage wrote the stored text in Spanish.
    expect(lolaProfile.languages[0]).toBe("es");
    const cases: { outcome: Outcome; status: AgreedBooking["status"] }[] = [
      { outcome: "booked", status: "confirmed" },
      { outcome: "rescheduled", status: "confirmed" },
      { outcome: "cancelled", status: "cancelled" },
    ];
    for (const { outcome, status } of cases) {
      for (const language of ["es", "en"] as const) {
        const m = stored(language, outcome);
        expect(agreedText(outcome, agreed({ status }), "es", lolaProfile, pack), `${outcome} ${language}`).toBe(m.agreed);
      }
    }
  });
});

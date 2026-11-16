import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
  lightAnnouncement,
  lightState,
  orderTape,
  tapeCounts,
  urgencyBasisText,
  urgencyLabel,
  type TapeEntry,
} from "@/lib/messages/tape";
import { decideUrgency } from "@/lib/messages/urgency";
import { hairSalon } from "@/lib/sectors";

const entry = (id: string, urgency: TapeEntry["urgency"], heard: boolean, createdAt: string): TapeEntry => ({
  id,
  urgency,
  heard,
  createdAt,
});

describe("orderTape (owner-machine 7.1)", () => {
  it("puts unheard first, then urgent > normal > low, then newest first", () => {
    const items = [
      entry("heard-urgent", "urgent", true, "2026-11-12T10:05:00Z"),
      entry("low-new", "low", false, "2026-11-12T10:09:00Z"),
      entry("normal-old", "normal", false, "2026-11-12T09:00:00Z"),
      entry("urgent", "urgent", false, "2026-11-12T08:00:00Z"),
      entry("normal-new", "normal", false, "2026-11-12T10:00:00Z"),
      entry("heard-low", "low", true, "2026-11-12T10:10:00Z"),
    ];
    expect(orderTape(items).map((i) => i.id)).toEqual([
      "urgent",
      "normal-new",
      "normal-old",
      "low-new",
      "heard-urgent",
      "heard-low",
    ]);
  });

  it("compares instants, not strings, and breaks exact ties by id", () => {
    const items = [
      entry("b", "normal", false, "2026-11-12T11:00:00+01:00"), // 10:00Z
      entry("a", "normal", false, "2026-11-12T10:00:00Z"),
      entry("c", "normal", false, "2026-11-12T10:30:00Z"),
    ];
    expect(orderTape(items).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("does not change its input and keeps the item type", () => {
    const items = [entry("x", "low", true, "2026-11-12T10:00:00Z"), entry("y", "urgent", false, "2026-11-12T10:00:00Z")];
    const copy = structuredClone(items);
    const ordered = orderTape(items.map((i) => ({ ...i, extra: i.id.toUpperCase() })));
    expect(ordered.map((i) => i.extra)).toEqual(["Y", "X"]);
    expect(items).toEqual(copy);
  });
});

describe("tapeCounts and lightState (owner-machine 6.3, 6.4)", () => {
  it("counts every item as new and the unheard ones apart", () => {
    const items = [
      entry("1", "low", true, "2026-11-12T10:00:00Z"),
      entry("2", "low", false, "2026-11-12T10:00:00Z"),
      entry("3", "urgent", false, "2026-11-12T10:00:00Z"),
    ];
    expect(tapeCounts(items)).toEqual({ new: 3, unheard: 2 });
    expect(tapeCounts([])).toEqual({ new: 0, unheard: 0 });
  });

  it("blinks while anything is unheard, is lit while there are messages, off with none", () => {
    expect(lightState({ new: 3, unheard: 1 })).toBe("blinking");
    expect(lightState({ new: 2, unheard: 0 })).toBe("steady");
    expect(lightState({ new: 0, unheard: 0 })).toBe("off");
  });
});

describe("lightAnnouncement (owner-machine 13.2)", () => {
  it("0, 1 and 3 messages in Spanish", () => {
    expect(lightAnnouncement({ new: 0, unheard: 0 }, "es")).toBe("No hay mensajes nuevos");
    expect(lightAnnouncement({ new: 1, unheard: 1 }, "es")).toBe("1 mensaje nuevo, 1 sin escuchar");
    expect(lightAnnouncement({ new: 1, unheard: 0 }, "es")).toBe("1 mensaje nuevo");
    expect(lightAnnouncement({ new: 3, unheard: 1 }, "es")).toBe("3 mensajes nuevos, 1 sin escuchar");
    expect(lightAnnouncement({ new: 3, unheard: 3 }, "es")).toBe("3 mensajes nuevos, 3 sin escuchar");
    expect(lightAnnouncement({ new: 3, unheard: 0 }, "es")).toBe("3 mensajes nuevos");
  });

  it("0, 1 and 3 messages in English", () => {
    expect(lightAnnouncement({ new: 0, unheard: 0 }, "en")).toBe("No new messages");
    expect(lightAnnouncement({ new: 1, unheard: 1 }, "en")).toBe("1 new message, 1 not played yet");
    expect(lightAnnouncement({ new: 1, unheard: 0 }, "en")).toBe("1 new message");
    expect(lightAnnouncement({ new: 3, unheard: 1 }, "en")).toBe("3 new messages, 1 not played yet");
    expect(lightAnnouncement({ new: 3, unheard: 0 }, "en")).toBe("3 new messages");
  });
});

describe("urgencyBasisText (owner-machine 4.3, 7.2, 7.8)", () => {
  const at = (iso: string) => Temporal.Instant.from(iso);
  const decide = (callerLines: string[], over: Partial<Parameters<typeof decideUrgency>[0]> = {}) => {
    const d = decideUrgency({
      callerLines,
      vocabulary: hairSalon.vocabulary,
      timeZone: "Europe/Madrid",
      now: at("2026-11-12T10:00:00Z"),
      requestedDate: null,
      bookingStart: null,
      outcome: "message",
      modelFailed: false,
      suggested: null,
      ...over,
    });
    return { urgency: d.final as "low" | "normal" | "urgent", urgencyBasis: d.basis };
  };

  it("quotes the pack's term, never the caller's sentence", () => {
    const m = decide(["Hola, creo que soy ALÉRGICA!! al tinte que me pusisteis ayer"]);
    expect(urgencyBasisText(m, "es", hairSalon)).toBe("Urgente · dijo «alérgica»");
    expect(urgencyBasisText(m, "en", hairSalon)).toBe("Urgent · said “alérgica”");
    expect(urgencyBasisText(m, "es", hairSalon)).not.toContain("tinte");
  });

  it("an English term is quoted as the pack writes it", () => {
    const m = decide(["I have an itching scalp since the colour, it is URGENT"]);
    expect(urgencyBasisText(m, "en", hairSalon)).toBe("Urgent · said “urgent”");
  });

  it("today, still open: by a term, or by the requested day, in the pack's word", () => {
    const byTerm = decide(["¿Me podéis coger esta tarde?"]);
    expect(urgencyBasisText(byTerm, "es", hairSalon)).toBe("Urgente · dijo «esta tarde» y quedó sin cerrar");
    expect(urgencyBasisText(byTerm, "en", hairSalon)).toBe("Urgent · said “esta tarde”, still open");

    const byDay = decide(["Quería un corte"], { requestedDate: Temporal.PlainDate.from("2026-11-12") });
    expect(urgencyBasisText(byDay, "es", hairSalon)).toBe("Urgente · pide cita para hoy y quedó sin cerrar");
    expect(urgencyBasisText(byDay, "en", hairSalon)).toBe("Urgent · wants an appointment today, still open");
  });

  it("today, handled; the model failing; nothing", () => {
    const handled = decide(["Quería un corte"], {
      outcome: "booked",
      bookingStart: at("2026-11-12T17:00:00Z"),
    });
    expect(urgencyBasisText(handled, "es", hairSalon)).toBe("Normal · es para hoy y ya quedó resuelto");
    expect(urgencyBasisText(handled, "en", hairSalon)).toBe("Normal · for today, already handled");

    const failed = decide(["Quería un corte"], { modelFailed: true, outcome: "fallback" });
    expect(urgencyBasisText(failed, "es", hairSalon)).toBe("Normal · el contestador falló");
    expect(urgencyBasisText(failed, "en", hairSalon)).toBe("Normal · the answering machine failed");

    const none = decide(["Quería un corte"]);
    expect(urgencyBasisText(none, "es", hairSalon)).toBe("Baja · nada urgente");
    expect(urgencyBasisText(none, "en", hairSalon)).toBe("Low · nothing urgent");
  });

  it("says when the model's suggestion raised it above the rule", () => {
    const raised = decide(["Quería un corte"], { suggested: "urgent" });
    expect(raised.urgency).toBe("urgent");
    expect(urgencyBasisText(raised, "es", hairSalon)).toBe("Urgente · lo marcó el asistente");
    expect(urgencyBasisText(raised, "en", hairSalon)).toBe("Urgent · flagged by the assistant");
  });

  it("a Message written before code-decided urgency shows the badge text alone", () => {
    expect(urgencyBasisText({ urgency: "normal", urgencyBasis: null }, "es", hairSalon)).toBe("Normal");
    expect(urgencyLabel("urgent", "es")).toBe("Urgente");
    expect(urgencyLabel("low", "en")).toBe("Low");
  });
});

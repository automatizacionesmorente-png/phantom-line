import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { initialCallState } from "@/lib/conversation/types";
import { decideUrgency, maxUrgency, suggestedFrom, type UrgencyInput } from "@/lib/messages/urgency";
import { hairSalon } from "@/lib/sectors";

const TZ = "Europe/Madrid";
const at = (iso: string) => Temporal.Instant.from(iso);

/** A plain Thursday in Madrid with nothing that raises urgency. */
const base = (over: Partial<UrgencyInput> = {}): UrgencyInput => ({
  callerLines: ["Quería una cita para un corte", "Ana", "600 000 000"],
  vocabulary: hairSalon.vocabulary,
  timeZone: TZ,
  now: at("2026-11-12T10:00:00Z"),
  requestedDate: null,
  bookingStart: null,
  outcome: "message",
  modelFailed: false,
  suggested: null,
  ...over,
});

describe("maxUrgency", () => {
  it("is the higher of two", () => {
    expect(maxUrgency("low", "normal")).toBe("normal");
    expect(maxUrgency("urgent", "low")).toBe("urgent");
    expect(maxUrgency("normal", "normal")).toBe("normal");
  });
});

describe("decideUrgency: the rules in order (owner-machine 5.3–5.8)", () => {
  it("nothing fires: low, basis none", () => {
    const d = decideUrgency(base());
    expect(d).toMatchObject({ rule: "low", final: "low", basis: { rule: "none" }, suggested: null });
  });

  it("an urgent term in Spanish or in English, whatever the call's language (5.3)", () => {
    const es = decideUrgency(base({ callerLines: ["Hola", "Me ha dado una REACCIÓN al tinte"] }));
    expect(es).toMatchObject({ rule: "urgent", final: "urgent", basis: { rule: "urgent_term", term: "reacción", lang: "es" } });
    const en = decideUrgency(base({ callerLines: ["Hello, it's an emergency!"] }));
    expect(en.basis).toEqual({ rule: "urgent_term", term: "emergency", lang: "en" });
  });

  it('"no es urgente" raises to urgent: negations count (5.11)', () => {
    const d = decideUrgency(base({ callerLines: ["No es urgente, cuando podáis"], suggested: "low" }));
    expect(d.final).toBe("urgent");
    expect(d.basis).toEqual({ rule: "urgent_term", term: "urgente", lang: "es" });
  });

  it('a Receptionist line "¿A qué hora te viene bien hoy?" does not raise (5.10)', () => {
    const transcript = [
      { caller: "", receptionist: "¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual." },
      { caller: "Quería un corte", receptionist: "¿A qué hora te viene bien hoy?" },
      { caller: "El martes", receptionist: "¿Es urgente?" },
    ];
    const d = decideUrgency(base({ callerLines: transcript.map((l) => l.caller) }));
    expect(d.rule).toBe("low");
    expect(d.basis).toEqual({ rule: "none" });
  });

  it("a today term: urgent while open, normal once handled (5.4, 5.5)", () => {
    const open = decideUrgency(base({ callerLines: ["¿Podría ser esta tarde?"], outcome: "message" }));
    expect(open).toMatchObject({ rule: "urgent", basis: { rule: "today_open", via: "term", term: "esta tarde" } });
    for (const outcome of ["booked", "rescheduled", "cancelled"] as const) {
      const handled = decideUrgency(base({ callerLines: ["Today, please"], outcome }));
      expect(handled, outcome).toMatchObject({ rule: "normal", basis: { rule: "today_handled", via: "term", term: "today" } });
    }
    for (const outcome of ["answered", "message", "fallback", "abandoned"] as const) {
      expect(decideUrgency(base({ callerLines: ["hoy"], outcome })).rule, outcome).toBe("urgent");
    }
  });

  it("the urgent term wins over today", () => {
    const d = decideUrgency(base({ callerLines: ["Hoy, es urgente"], outcome: "booked" }));
    expect(d.basis.rule).toBe("urgent_term");
  });

  it("the today rule reads the shop's time zone on 29 March 2026 (spring forward)", () => {
    // 23:30 UTC on the 28th is already 00:30 on the 29th in Madrid.
    const now = at("2026-03-28T23:30:00Z");
    const day = Temporal.PlainDate.from("2026-03-29");
    expect(decideUrgency(base({ now, requestedDate: day })).basis).toEqual({ rule: "today_open", via: "requested_day" });
    expect(decideUrgency(base({ now, requestedDate: day, outcome: "booked" })).basis).toEqual({
      rule: "today_handled",
      via: "requested_day",
    });
    expect(decideUrgency(base({ now, requestedDate: Temporal.PlainDate.from("2026-03-28") })).rule).toBe("low");
    // 21:30 UTC is 23:30 local (UTC+2 after the change): still the 29th.
    const late = at("2026-03-29T21:30:00Z");
    expect(decideUrgency(base({ now, bookingStart: late, outcome: "booked" })).basis).toEqual({
      rule: "today_handled",
      via: "booking_day",
    });
    expect(decideUrgency(base({ now, bookingStart: late, outcome: "message" })).rule).toBe("urgent");
    // 22:00 UTC is 00:00 on the 30th.
    expect(decideUrgency(base({ now, bookingStart: at("2026-03-29T22:00:00Z") })).rule).toBe("low");
  });

  it("the today rule reads the shop's time zone on 25 October 2026 (fall back)", () => {
    // 22:30 UTC on the 24th is 00:30 on the 25th in Madrid (UTC+2).
    const now = at("2026-10-24T22:30:00Z");
    const day = Temporal.PlainDate.from("2026-10-25");
    expect(decideUrgency(base({ now, requestedDate: day })).basis).toEqual({ rule: "today_open", via: "requested_day" });
    expect(decideUrgency(base({ now, requestedDate: day, outcome: "rescheduled" })).rule).toBe("normal");
    // 22:30 UTC on the 25th is 23:30 local (UTC+1 after the change): still today.
    expect(decideUrgency(base({ now, bookingStart: at("2026-10-25T22:30:00Z"), outcome: "cancelled" })).basis).toEqual({
      rule: "today_handled",
      via: "booking_day",
    });
    expect(decideUrgency(base({ now, bookingStart: at("2026-10-25T22:30:00Z") })).basis).toEqual({
      rule: "today_open",
      via: "booking_day",
    });
    // 23:00 UTC on the 25th is 00:00 on the 26th.
    expect(decideUrgency(base({ now, bookingStart: at("2026-10-25T23:00:00Z") })).rule).toBe("low");
  });

  it("model_failed gives at least normal (5.6)", () => {
    expect(decideUrgency(base({ modelFailed: true }))).toMatchObject({ rule: "normal", final: "normal", basis: { rule: "model_failed" } });
    expect(decideUrgency(base({ modelFailed: true, suggested: "low" })).final).toBe("normal");
    expect(decideUrgency(base({ modelFailed: true, suggested: "urgent" })).final).toBe("urgent");
    expect(decideUrgency(base({ modelFailed: true, callerLines: ["hoy"], outcome: "booked" })).basis.rule).toBe("today_handled");
  });

  it("the final urgency is the higher of rule and suggestion; no suggestion gives the rule alone (5.8)", () => {
    expect(decideUrgency(base({ suggested: "urgent" }))).toMatchObject({ rule: "low", final: "urgent", suggested: "urgent" });
    expect(decideUrgency(base({ suggested: "normal" })).final).toBe("normal");
    expect(decideUrgency(base({ callerLines: ["urgente"], suggested: "low" })).final).toBe("urgent");
    expect(decideUrgency(base({ suggested: null })).final).toBe("low");
    expect(decideUrgency(base({ callerLines: ["hoy"], outcome: "booked", suggested: null })).final).toBe("normal");
  });
});

describe("decideUrgency: Not_Urgent_Phrases (front-desk-brain 16.5, design.md \"Not_Urgent_Phrases\")", () => {
  // A question about the allergy test is not urgent; a real reaction still is. Before task 18
  // the first row came out urgent, basis urgent_term "alergia" (recorded in design.md).
  const rows: readonly [string, "low" | "urgent", object][] = [
    ["¿Hacéis la prueba de alergia?", "low", { rule: "none" }],
    [
      "Quiero la prueba de alergia, que me ha dado alergia otro tinte",
      "urgent",
      { rule: "urgent_term", term: "alergia", lang: "es" },
    ],
    ["Me pica la cabeza desde el tinte", "urgent", { rule: "urgent_term", term: "me pica", lang: "es" }],
    ["Allergy test before my colour, please", "low", { rule: "none" }],
    ["I had a reaction after the patch test", "urgent", { rule: "urgent_term", term: "reaction", lang: "en" }],
  ];
  for (const [line, rule, basis] of rows) {
    it(`"${line}" is ${rule}`, () => {
      const d = decideUrgency(base({ callerLines: ["Hola", line] }));
      expect(d.rule).toBe(rule);
      expect(d.basis).toEqual(basis);
    });
  }

  it("the other Not_Urgent_Phrases of the hair-salon pack are masked too, in any case and accent", () => {
    for (const line of ["¿Necesito un TEST DE ALERGIA?", "¿La prueba del tinte cuánto dura?", "Do you do a Patch-Test?"]) {
      expect(decideUrgency(base({ callerLines: [line] })).basis, line).toEqual({ rule: "none" });
    }
  });

  it('the today rule still reads the unmasked line: "prueba de alergia para hoy" is today_open by "hoy", in both languages', () => {
    expect(decideUrgency(base({ callerLines: ["¿Me hacéis la prueba de alergia para hoy?"] }))).toMatchObject({
      rule: "urgent",
      basis: { rule: "today_open", via: "term", term: "hoy" },
    });
    expect(decideUrgency(base({ callerLines: ["Can I have the allergy test today?"] }))).toMatchObject({
      rule: "urgent",
      basis: { rule: "today_open", via: "term", term: "today" },
    });
    // Handled the same day: normal, as for any other today Call (5.5).
    expect(decideUrgency(base({ callerLines: ["prueba de alergia para hoy"], outcome: "booked" })).basis).toEqual({
      rule: "today_handled",
      via: "term",
      term: "hoy",
    });
  });

  it("the words on either side of a masked phrase do not join into a new term", () => {
    // "me" + "pica" around the phrase would read "me pica" if the mask closed the gap.
    expect(decideUrgency(base({ callerLines: ["me prueba de alergia pica"] })).basis).toEqual({ rule: "none" });
  });

  it("an urgent term in another line is never masked by a phrase in this one", () => {
    expect(decideUrgency(base({ callerLines: ["la prueba de alergia", "es urgente"] })).basis).toEqual({
      rule: "urgent_term",
      term: "urgente",
      lang: "es",
    });
  });
});

describe("suggestedFrom", () => {
  it("the initial \"normal\" of a Call with no valid Turn is not a suggestion", () => {
    const initial = initialCallState("es").note;
    expect(initial.urgency).toBe("normal");
    expect(suggestedFrom(initial)).toBeNull();
    expect(suggestedFrom({ reason: "   ", urgency: "urgent" })).toBeNull();
    // So a Call that never got a valid Turn and says nothing urgent is low, not normal.
    expect(decideUrgency(base({ suggested: suggestedFrom(initial) })).final).toBe("low");
  });

  it("a note written from a valid Turn is the suggestion", () => {
    expect(suggestedFrom({ reason: "Quiere un corte", urgency: "low" })).toBe("low");
    expect(suggestedFrom({ reason: "Reacción al tinte", urgency: "urgent" })).toBe("urgent");
  });
});

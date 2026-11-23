import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { decideTurn } from "@/lib/conversation/decide";
import { buildOwnerMessage, isActionable } from "@/lib/conversation/ownerMessage";
import { initialCallState, type CallState, type Outcome } from "@/lib/conversation/types";
import { phrases } from "@/lib/receptionist/phrases";
import type { ModelTurn } from "@/lib/receptionist/schema";
import { getSectorPack, type Lang } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

/**
 * QA fixes, backlog 20-25: the call-back needs a phone, the reason is code text in the owner's
 * language, `agreedNothing` never holds model text, out-of-profile answers and misses on the model
 * path use templates, and a Call with nothing actionable writes no Message.
 */
const pack = getSectorPack("hair-salon");
const NOW = Temporal.Instant.from("2026-11-11T08:00:00Z");
const state = (over: Partial<CallState> = {}): CallState => ({ ...initialCallState("es"), ...over });

const turn = (over: Partial<ModelTurn> = {}): ModelTurn => ({
  reply: "Claro.",
  language: "es",
  wantsLanguage: null,
  intent: "other",
  name: null,
  phone: null,
  service: null,
  date: null,
  time: null,
  callerConfirmed: false,
  callerWantsToEnd: false,
  outOfProfile: false,
  reason: "Pregunta",
  urgency: "normal",
  ...over,
});
const decide = (s: CallState, t: Partial<ModelTurn>) =>
  decideTurn({ state: s, turn: turn(t), shop: lolaProfile, pack, now: NOW, existing: [], callerBookings: [] });
const P = (lang: Lang) => phrases(lang, pack, lolaProfile);

const MODEL_TEXT = fc.string({ minLength: 8, maxLength: 60 }).filter((x) => x.trim().length >= 8);

describe("20: no call-back promise without a phone", () => {
  const noted = () => state({ notes: [{ kind: "owner_request" }], fields: {} });

  it("the goodbye asks for the name, then the phone, then the plain no-call-back line", () => {
    const d1 = decide(noted(), { callerWantsToEnd: true });
    expect(d1.complete).toBe(false);
    expect(d1.effects).toEqual([]);
    expect(d1.reply).toMatch(/nombre|quién/);
    const d2 = decide(d1.state, { name: "Pedro" });
    expect(d2.complete).toBe(false);
    expect(d2.reply).toMatch(/tel[ée]fono|número/);
    const d3 = decide(d2.state, { callerWantsToEnd: true });
    expect(d3.complete).toBe(true);
    expect(d3.reply).toBe(P("es").goodbyeNoPhone().text);
    expect(d3.reply).toMatch(/no podrá llamarte/);
    expect(d3.effects.map((e) => e.type)).toEqual(["saveMessage"]);
  });

  it("a phone given in answer ends the asking; the usual goodbye follows", () => {
    const d1 = decide(noted(), { callerWantsToEnd: true });
    const d2 = decide(d1.state, { name: "Pedro", phone: "612345678" });
    expect(d2.reply).toBe(P("es").contactThanks().text);
    const d3 = decide(d2.state, { callerWantsToEnd: true });
    expect(d3.reply).toBe(P("es").goodbye().text);
    expect(d3.complete).toBe(true);
  });

  it("a Call with a phone already ends at once, and so does one with no note", () => {
    expect(decide(state({ notes: [{ kind: "owner_request" }], fields: { phone: "+34612345678" } }), { callerWantsToEnd: true }).complete).toBe(true);
    expect(decide(state({ fields: { name: "Ana" } }), { callerWantsToEnd: true }).complete).toBe(true);
  });
});

describe("21 and 22: the reason and 'agreed' are code text in the owner's language", () => {
  it("never contain the model's note, in either Call language, with any outcome", () => {
    fc.assert(
      fc.property(
        MODEL_TEXT,
        fc.constantFrom<Lang>("es", "en"),
        fc.constantFrom<Outcome>("answered", "message", "abandoned", "fallback"),
        (note, lang, outcome) => {
          const s: CallState = {
            ...initialCallState(lang),
            fields: { name: "Ana", serviceId: "haircut" },
            topics: ["hours"],
            note: { reason: note, urgency: "normal" },
          };
          const m = buildOwnerMessage(s, outcome, lolaProfile, pack);
          expect(m.reason).not.toContain(note);
          expect(m.agreed).not.toContain(note);
          // Lola's first language is Spanish: the Owner's texts do not depend on the Call's language.
          const es = buildOwnerMessage({ ...s, language: "es" }, outcome, lolaProfile, pack);
          expect(m.reason).toBe(es.reason);
          expect(m.agreed).toBe(es.agreed);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("names only the service in the catalog, no relative day and no goodbye", () => {
    const s = state({
      fields: { name: "Ana", serviceId: "haircut", requested: { date: "2026-11-12", time: "10:00" } },
      note: { reason: "Corte de pelo con degradado para mañana. El cliente se despide.", urgency: "low" },
    });
    const m = buildOwnerMessage(s, "message", lolaProfile, pack);
    expect(m.reason).toBe("Quiere corte");
    expect(m.reason).not.toMatch(/mañana|despide|degradado/i);
    expect(m.agreed).toBe("Nada acordado; Quiere corte");
  });

  it("a reschedule or a cancel says what the Caller wanted", () => {
    expect(buildOwnerMessage(state({ intent: "reschedule", fields: { name: "Ana" } }), "message", lolaProfile, pack).reason).toBe("Quiere cambiar su cita");
    expect(buildOwnerMessage(state({ intent: "cancel", fields: { name: "Ana" } }), "message", lolaProfile, pack).reason).toBe("Quiere anular su cita");
  });
});

describe("23: out-of-profile answers on the model path use the Keep_Alive_Line", () => {
  it("whatever the model says, with or without outOfProfile, the template is spoken and a note recorded", () => {
    fc.assert(
      fc.property(MODEL_TEXT, fc.boolean(), fc.constantFrom<Lang>("es", "en"), (text, outOfProfile, lang) => {
        const s = { ...initialCallState(lang), language: lang };
        const d = decideTurn({
          state: s,
          turn: turn({ intent: "question", outOfProfile, reply: text, language: lang }),
          shop: lolaProfile,
          pack,
          now: NOW,
          existing: [],
          callerBookings: [],
        });
        expect(d.fromModel).toBe(false);
        expect(d.reply).toBe(phrases(lang, pack, lolaProfile).unknownKeepAlive().text);
        expect(d.reply).not.toContain(text);
        expect(d.state.notes?.map((n) => n.kind)).toEqual(["unanswered"]);
        expect(d.complete).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe("24: not understood on the model path", () => {
  it("an `other` Turn that places nothing gets the templated reprompt, not the model's line", () => {
    const d = decide(state(), { intent: "other", reply: "I am Peluquería Lola's virtual assistant and Lola will see the message." });
    expect(d.fromModel).toBe(false);
    expect(d.reply).not.toContain("virtual assistant");
    expect(d.reply).toMatch(/no te he (entendido|pillado)/);
    expect(d.state.misses).toBe(1);
    expect(d.complete).toBe(false);
  });

  it("after the third miss in a row the Owner gets a note; a hang-up before that leaves no Message", () => {
    let s = state();
    let d = decide(s, {});
    d = decide(d.state, {});
    d = decide(d.state, {});
    expect(d.state.notes?.map((n) => n.kind)).toEqual(["not_understood"]);
    const bye = decide(initialCallState("es"), { callerWantsToEnd: true });
    expect(bye.effects).toEqual([]);
    s = decide(state(), {}).state;
    expect(isActionable(s, "abandoned")).toBe(false);
  });

  it("a turn that places something is not a miss", () => {
    expect(decide(state(), { intent: "other", name: "Ana" }).state.misses ?? 0).toBe(0);
  });
});

describe("25: no empty cards on the tape", () => {
  it("isActionable: booking changes and failures always; otherwise a name, phone, service, time or note", () => {
    const empty = state();
    for (const o of ["booked", "rescheduled", "cancelled", "fallback"] as const) expect(isActionable(empty, o)).toBe(true);
    for (const o of ["answered", "message", "abandoned"] as const) {
      expect(isActionable(empty, o)).toBe(false);
      expect(isActionable(state({ topics: ["hours"] }), o)).toBe(false);
      expect(isActionable(state({ fields: { name: "Ana" } }), o)).toBe(true);
      expect(isActionable(state({ fields: { phone: "+34612345678" } }), o)).toBe(true);
      expect(isActionable(state({ fields: { serviceId: "haircut" } }), o)).toBe(true);
      expect(isActionable(state({ fields: { requested: { date: "2026-11-12", time: "10:00" } } }), o)).toBe(true);
      expect(isActionable(state({ notes: [{ kind: "owner_request" }] }), o)).toBe(true);
    }
  });
});

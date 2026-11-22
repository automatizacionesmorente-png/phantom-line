import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { evaluateBooking, toInstant } from "@/lib/booking";
import { decideTurn } from "@/lib/conversation/decide";
import { toShopRules } from "@/lib/conversation/shopProfile";
import { initialCallState } from "@/lib/conversation/types";
import { phrases } from "@/lib/receptionist/phrases";
import type { ModelTurn } from "@/lib/receptionist/schema";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

/**
 * S8 (bugfix 2026-11-12, extended 2026-11-13 by natural-voice 6.2). Requirement 5.8: the code
 * produces every rejection and every alternative. In a booking whose service is known, the model's
 * own line is never spoken: before the Booking_Rules accepted the requested time the code rejects
 * or asks for the day and time, and once it accepted it, the code asks for the next missing field
 * with a template ("Genial, mañana a las siete y media tengo hueco. ¿Me dices tu nombre?").
 * Before the 2026-11-12 fix, a model that left out a time it judged impossible got its own
 * words about opening hours spoken instead of the code's rejection with alternatives.
 */
const pack = getSectorPack("hair-salon");
const TZ = lolaProfile.timeZone;
const NOWS = ["2026-11-11T08:00:00Z", "2026-11-12T11:14:00Z", "2026-03-27T17:00:00Z"].map((s) => Temporal.Instant.from(s));
const MODEL_LINE = "MODEL-LINE: Lo siento, a esa hora estamos cerrados, abrimos de diez a dos.";

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

describe("S8: a known service in a booking: the model never speaks, and the code asks for the next field", () => {
  it("holds for every date / time / null combination", () => {
    let accepted = 0;
    fc.assert(
      fc.property(
        fc.constantFrom(...NOWS),
        fc.constantFrom("corte", "tinte", "barba", "cortarme el pelo", "pintar el pelo"),
        fc.option(fc.integer({ min: -3, max: 20 }), { nil: null }),
        fc.option(fc.record({ h: fc.integer({ min: 0, max: 23 }), m: fc.integer({ min: 0, max: 59 }) }), { nil: null }),
        fc.constantFrom("es" as const, "en" as const),
        (now, service, dayOffset, hm, lang) => {
          const date = dayOffset === null ? null : now.toZonedDateTimeISO(TZ).toPlainDate().add({ days: dayOffset }).toString();
          const time = hm === null ? null : hhmm(hm.h, hm.m);
          const turn: ModelTurn = {
            reply: MODEL_LINE,
            language: lang,
            wantsLanguage: null,
            intent: "booking",
            name: null,
            phone: null,
            service,
            date,
            time,
            callerConfirmed: false,
            callerWantsToEnd: false,
            outOfProfile: false,
            reason: "Quiere una cita",
            urgency: "normal",
          };
          const d = decideTurn({
            state: initialCallState(lang),
            turn,
            shop: lolaProfile,
            pack,
            now,
            existing: [],
            callerBookings: [],
          });
          expect(d.reply).not.toBe(MODEL_LINE);
          expect(d.reply).not.toContain("MODEL-LINE");
          expect(d.fromModel).toBe(false);
          const r = d.state.fields.requested;
          if (!r) return;
          const start = toInstant(Temporal.PlainDate.from(r.date), Temporal.PlainTime.from(r.time), TZ);
          const verdict = evaluateBooking(
            { serviceId: d.state.fields.serviceId!, start },
            { now, shop: toShopRules(lolaProfile), pack: { slotStepMin: pack.slotStepMin, rules: pack.rules }, existing: [] },
          );
          if (!verdict.ok) return;
          // The code accepted this exact time, so the name is asked by the template, in the Call's language.
          accepted++;
          const P = phrases(d.state.language, pack, lolaProfile, undefined, now);
          expect(d.reply).toBe(P.timeAcceptedAskName(verdict.start).text);
        },
      ),
      { numRuns: 300 },
    );
    // A guard against a vacuous S8 (the lesson of the S2 generator, task 5).
    expect(accepted).toBeGreaterThan(0);
  });

  it("the generator reaches all three sides: a template ask after an accepted time, a rejection, and the code's First_Offer for a day with no time", () => {
    const base = { state: initialCallState("es"), shop: lolaProfile, pack, now: NOWS[0], existing: [], callerBookings: [] };
    const t = (date: string | null, time: string | null, service: string | null = "corte"): ModelTurn => ({
      reply: MODEL_LINE, language: "es", wantsLanguage: null, intent: "booking", name: null, phone: null,
      service, date, time, callerConfirmed: false, callerWantsToEnd: false, outOfProfile: false,
      reason: "x", urgency: "normal",
    });
    const P = phrases("es", pack, lolaProfile, undefined, NOWS[0]);
    const slot = Temporal.Instant.from("2026-11-11T18:30:00Z");
    expect(decideTurn({ ...base, turn: t("2026-11-11", "19:30") }).reply).toBe(P.timeAcceptedAskName(slot).text);
    expect(decideTurn({ ...base, turn: t("2026-11-11", "21:00") }).reply).toBe(
      P.rejected("outside_hours", Temporal.Instant.from("2026-11-11T20:00:00Z"), [
        slot,
        Temporal.Instant.from("2026-11-11T18:15:00Z"),
        Temporal.Instant.from("2026-11-11T18:00:00Z"),
      ]).text,
    );
    // front-desk-brain 8.1 (an amendment of core-call-loop 5.x): a day with no time gets the code's
    // First_Offer on that day. Old assertion: `P.askDayAndTime(2026-11-11)`. Still protected: the
    // code speaks, never the model, and the offered slot is the first the Booking_Rules accept
    // (Wednesday 09:00 Madrid now, so 09:30 rounds to the 10:00 opening).
    expect(decideTurn({ ...base, turn: t("2026-11-11", null) }).reply).toBe(
      P.firstOffer("haircut", Temporal.Instant.from("2026-11-11T09:00:00Z")).text,
    );
    // Only without a service does the model's line still speak.
    expect(decideTurn({ ...base, turn: t("2026-11-11", "19:30", null) }).reply).toBe(MODEL_LINE);
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { evaluateBooking, toInstant } from "@/lib/booking";
import { decideTurn } from "@/lib/conversation/decide";
import { toShopRules } from "@/lib/conversation/shopProfile";
import { initialCallState } from "@/lib/conversation/types";
import type { ModelTurn } from "@/lib/receptionist/schema";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

/**
 * S8 (bugfix 2026-11-12). Requirement 5.8: the code produces every rejection and every
 * alternative. In a booking whose service is known, the model's own line is spoken only
 * after the Booking_Rules accepted the requested time (it can then only ask for the next
 * field). Before the fix, a model that left out a time it judged impossible got its own
 * words about opening hours spoken instead of the code's rejection with alternatives.
 */
const pack = getSectorPack("hair-salon");
const TZ = lolaProfile.timeZone;
const NOWS = ["2026-11-11T08:00:00Z", "2026-11-12T11:14:00Z", "2026-03-27T17:00:00Z"].map((s) => Temporal.Instant.from(s));
const MODEL_LINE = "MODEL-LINE: Lo siento, a esa hora estamos cerrados, abrimos de diez a dos.";

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

describe("S8: a known service in a booking: the model never speaks before the time is accepted", () => {
  it("holds for every date / time / null combination", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NOWS),
        fc.constantFrom("corte", "tinte", "barba", "cortarme el pelo"),
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
          if (d.reply !== MODEL_LINE) return;
          // The model spoke: the code must have accepted this exact time first.
          const r = d.state.fields.requested;
          expect(r).toBeDefined();
          const start = toInstant(Temporal.PlainDate.from(r!.date), Temporal.PlainTime.from(r!.time), TZ);
          const verdict = evaluateBooking(
            { serviceId: d.state.fields.serviceId!, start },
            { now, shop: toShopRules(lolaProfile), pack: { slotStepMin: pack.slotStepMin, rules: pack.rules }, existing: [] },
          );
          expect(verdict.ok).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("the generator reaches both sides: model lines after an accepted time, and code lines without one", () => {
    // A guard against a vacuous S8 (the lesson of the S2 generator, task 5).
    const base = { state: initialCallState("es"), shop: lolaProfile, pack, now: NOWS[0], existing: [], callerBookings: [] };
    const t = (date: string | null, time: string | null): ModelTurn => ({
      reply: MODEL_LINE, language: "es", wantsLanguage: null, intent: "booking", name: null, phone: null,
      service: "corte", date, time, callerConfirmed: false, callerWantsToEnd: false, outOfProfile: false,
      reason: "x", urgency: "normal",
    });
    expect(decideTurn({ ...base, turn: t("2026-11-11", "19:30") }).reply).toBe(MODEL_LINE);
    expect(decideTurn({ ...base, turn: t("2026-11-11", null) }).reply).not.toBe(MODEL_LINE);
    expect(decideTurn({ ...base, turn: t("2026-11-11", "21:00") }).reply).not.toBe(MODEL_LINE);
  });
});

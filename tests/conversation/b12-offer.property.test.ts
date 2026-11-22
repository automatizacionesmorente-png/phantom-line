import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import type { ExistingBooking } from "@/lib/booking";
import { readUtterance } from "@/lib/conversation/brain/read";
import { decideTurn } from "@/lib/conversation/decide";
import { factsFromModel, factsFromReading, type TurnFacts } from "@/lib/conversation/facts";
import { initialCallState, type CallState } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import { ModelTurnSchema, type ModelTurn } from "@/lib/receptionist/schema";
import { getSectorPack } from "@/lib/sectors";

/**
 * B12. An accepted offer is not a booking (front-desk-brain 8.4, 13.5; core-call-loop S2).
 * For all conversations on both Turn_Sources: a `createBooking` or `reschedule` effect occurs only
 * in a Turn whose previous state was a read-back and whose facts say yes, and it books exactly
 * the read-back's service and start; a yes to a First_Offer or an alternative only sets the
 * requested time (to the slot offered), and any read-back it leads to is for that slot.
 *
 * Each conversation is the happy path of a booking (a service, "sí", a name, a phone, "sí") with
 * 0–4 random Turns inserted, and each Turn is read by the Code_Brain or by a scripted valid model
 * turn, so both sources reach offers, read-backs and bookings.
 */
const shop = lolaSeedProfile;
const pack = getSectorPack("hair-salon");
const TZ = shop.timeZone;
const NOWS = ["2026-11-14T18:30:00Z", "2026-11-10T08:00:00Z", "2026-03-27T17:00:00Z", "2026-10-23T07:30:00Z"].map((s) => Temporal.Instant.from(s));

type Step =
  | { kind: "service"; words: string }
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "name" }
  | { kind: "phone" }
  | { kind: "when"; words: string; date: (now: Temporal.Instant) => string; time: string | null }
  | { kind: "question" };

const SERVICES = [
  "cortarme el pelo y hacerme un degradado",
  "un corte de hombre",
  "unas mechas",
  "un corte de mujer y un tratamiento hidratante",
  "un arreglo de barba",
  "un tinte de raíz",
];
const WHENS: Step[] = [
  { kind: "when", words: "el martes por la mañana", date: (n) => nextWeekday(n, 2), time: null },
  { kind: "when", words: "el jueves a las cinco", date: (n) => nextWeekday(n, 4), time: "17:00" },
  { kind: "when", words: "mañana a las diez", date: (n) => localDate(n).add({ days: 1 }).toString(), time: "10:00" },
  { kind: "when", words: "el sábado a las nueve de la noche", date: (n) => nextWeekday(n, 6), time: "21:00" },
];
const YES = ["sí", "vale", "perfecto", "sí, me viene bien"];

function localDate(now: Temporal.Instant): Temporal.PlainDate {
  return now.toZonedDateTimeISO(TZ).toPlainDate();
}
function nextWeekday(now: Temporal.Instant, dow: number): string {
  const today = localDate(now);
  const ahead = ((dow - today.dayOfWeek + 7) % 7) || 7;
  return today.add({ days: ahead }).toString();
}

const arbStep: fc.Arbitrary<Step> = fc.oneof(
  { weight: 2, arbitrary: fc.constant<Step>({ kind: "yes" }) },
  { weight: 2, arbitrary: fc.constant<Step>({ kind: "no" }) },
  { weight: 1, arbitrary: fc.constantFrom(...SERVICES).map((words): Step => ({ kind: "service", words })) },
  { weight: 2, arbitrary: fc.constantFrom(...WHENS) },
  { weight: 1, arbitrary: fc.constant<Step>({ kind: "question" }) },
  { weight: 1, arbitrary: fc.constant<Step>({ kind: "name" }) },
  { weight: 1, arbitrary: fc.constant<Step>({ kind: "phone" }) },
);

const arbConversation = fc
  .record({
    now: fc.constantFrom(...NOWS),
    service: fc.constantFrom(...SERVICES),
    inserts: fc.array(fc.record({ at: fc.nat({ max: 5 }), step: arbStep }), { maxLength: 4 }),
    sources: fc.array(fc.constantFrom("brain" as const, "brain" as const, "model" as const), { minLength: 9, maxLength: 9 }),
    yes: fc.array(fc.constantFrom(...YES), { minLength: 9, maxLength: 9 }),
    busy: fc.boolean(),
  })
  .map((g) => {
    const steps: Step[] = [{ kind: "service", words: g.service }, { kind: "yes" }, { kind: "name" }, { kind: "phone" }, { kind: "yes" }];
    for (const ins of g.inserts) steps.splice(Math.min(ins.at, steps.length), 0, ins.step);
    return { ...g, steps };
  });

const modelTurn = (over: Partial<ModelTurn>): ModelTurn =>
  ModelTurnSchema.parse({
    reply: "MODEL-LINE",
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
    reason: "Quiere cita",
    urgency: "normal",
    ...over,
  });

function words(step: Step, yes: string): string {
  switch (step.kind) {
    case "service":
      return `quería ${step.words}`;
    case "yes":
      return yes;
    case "no":
      return "no";
    case "name":
      return "Me llamo Ana";
    case "phone":
      return "612 345 678";
    case "when":
      return step.words;
    case "question":
      return "¿aceptáis bizum?";
  }
}

function factsOf(step: Step, source: "brain" | "model", state: CallState, now: Temporal.Instant, yes: string): TurnFacts {
  const utterance = words(step, yes);
  const reading = readUtterance({ utterance, state, shop, pack, now, lang: state.language });
  if (source === "brain") return factsFromReading(reading, utterance);
  // The model's view of the same words; the Reading still decides what Requirement 13.2 gives it.
  const t =
    step.kind === "service"
      ? modelTurn({ service: step.words })
      : step.kind === "yes"
        ? modelTurn({ callerConfirmed: true })
        : step.kind === "name"
          ? modelTurn({ name: "Ana" })
          : step.kind === "phone"
            ? modelTurn({ phone: "612345678" })
            : step.kind === "when"
              ? modelTurn({ date: step.date(now), time: step.time })
              : step.kind === "question"
                ? modelTurn({ intent: "question" })
                : modelTurn({ intent: "other" });
  return factsFromModel(t, reading, shop, { state, utterance });
}

const localOf = (iso: string) => {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(TZ);
  return { date: z.toPlainDate().toString(), time: z.toPlainTime().toString().slice(0, 5) };
};

describe("B12: an accepted offer is not a booking", () => {
  it("bookings come only from a yes to a read-back; a yes to an offer only sets the requested time", { timeout: 120_000 }, () => {
    const seen = { offerYes: { brain: 0, model: 0 }, booked: { brain: 0, model: 0 }, offerYesToReadBack: 0, alternativesYes: 0 };
    fc.assert(
      fc.property(arbConversation, (g) => {
        let state = initialCallState("es");
        const existing: ExistingBooking[] = g.busy
          ? [{ id: "x", resourceId: "chair-1", start: g.now.add({ hours: 72 }), end: g.now.add({ hours: 74 }) }]
          : [];
        g.steps.forEach((step, k) => {
          if (state.stage === "done") return;
          const source = g.sources[k % g.sources.length];
          const facts = factsOf(step, source, state, g.now, g.yes[k % g.yes.length]);
          const prev = state;
          const d = decideTurn({ state: prev, facts, shop, pack, now: g.now, existing, callerBookings: [], callId: "b12" });
          const writes = d.effects.filter((e) => e.type === "createBooking" || e.type === "reschedule");

          if (writes.length > 0) {
            // Only after a read-back, only on a yes, and exactly what was read back.
            expect(prev.stage).toBe("awaiting_confirmation");
            expect(prev.pending?.kind).toBe("book");
            expect(facts.yes).toBe(true);
            for (const e of writes) {
              expect(prev.pending?.kind === "book" && [prev.pending.serviceId, prev.pending.start]).toEqual([
                e.serviceId,
                e.verdict.start.toString(),
              ]);
            }
            seen.booked[source]++;
            for (const e of writes) existing.push({ id: `b${k}`, resourceId: e.verdict.resourceId, start: e.verdict.start, end: e.verdict.end });
          }

          const offerAnswered =
            prev.stage === "collecting" && (prev.lastOffer?.length ?? 0) > 0 && facts.yes && facts.date === null && facts.time === null;
          if (offerAnswered) {
            // A yes to an offer is never a booking ...
            expect(writes).toEqual([]);
            const slot = localOf(prev.lastOffer![0]);
            // ... it sets the requested time to the slot offered (or a question in between keeps the flow as it was) ...
            const r = d.state.fields.requested;
            expect(r === undefined || (r.date === slot.date && r.time === slot.time) || (prev.fields.requested && r.date === prev.fields.requested.date && r.time === prev.fields.requested.time)).toBe(true);
            // ... and a read-back it leads to is for that very slot.
            if (d.state.stage === "awaiting_confirmation" && d.state.pending?.kind === "book") {
              expect(d.state.pending.start).toBe(prev.lastOffer![0]);
              seen.offerYesToReadBack++;
            }
            if (r && r.date === slot.date && r.time === slot.time) {
              seen.offerYes[source]++;
              if (prev.offerKind === "alternatives") seen.alternativesYes++;
            }
          }
          state = d.state;
        });
      }),
      { numRuns: 200 },
    );
    // Every branch the property speaks about was reached, on both Turn_Sources.
    expect(seen.offerYes.brain).toBeGreaterThan(0);
    expect(seen.offerYes.model).toBeGreaterThan(0);
    expect(seen.booked.brain).toBeGreaterThan(0);
    expect(seen.booked.model).toBeGreaterThan(0);
    expect(seen.alternativesYes).toBeGreaterThan(0);
  });
});

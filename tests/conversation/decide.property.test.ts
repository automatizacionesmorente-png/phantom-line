import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { evaluateBooking, toInstant, type ExistingBooking, type RuleContext } from "@/lib/booking";
import { readUtterance } from "@/lib/conversation/brain/read";
import { decideTurn } from "@/lib/conversation/decide";
import { factsFromReading } from "@/lib/conversation/facts";
import { matchesCaller } from "@/lib/conversation/matchCaller";
import { toShopRules } from "@/lib/conversation/shopProfile";
import type { CallerBooking, CallState, PendingAction } from "@/lib/conversation/types";
import { ModelTurnSchema, type ModelTurn } from "@/lib/receptionist/schema";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

const NUM_RUNS = 200;
const pack = getSectorPack("hair-salon");
const TZ = lolaProfile.timeZone;
const NOWS = ["2026-11-11T08:00:00Z", "2026-03-27T17:00:00Z", "2026-10-23T07:30:00Z"].map((s) => Temporal.Instant.from(s));

const arbStart = (now: Temporal.Instant) =>
  fc
    .record({ day: fc.integer({ min: -1, max: 14 }), quarter: fc.integer({ min: 36, max: 84 }) }) // 09:00–21:00
    .map(({ day, quarter }) =>
      toInstant(
        now.toZonedDateTimeISO(TZ).toPlainDate().add({ days: day }),
        Temporal.PlainTime.from({ hour: Math.floor(quarter / 4), minute: (quarter % 4) * 15 }),
        TZ,
      ),
    );

const SERVICE_IDS = [...lolaProfile.services.map((s) => s.id), "ghost-service"];
const PEOPLE = [
  { name: "Ana", phone: "+34612345678" },
  { name: "Marta", phone: "+34612345678" }, // same phone, other name
  { name: "Luis", phone: "+34699999999" },
];

const arbCallerBookings = (starts: fc.Arbitrary<Temporal.Instant>): fc.Arbitrary<CallerBooking[]> =>
  fc.array(
    fc.record({ who: fc.constantFrom(...PEOPLE), start: starts, svc: fc.constantFrom("haircut", "colour", "beard"), chair: fc.constantFrom("chair-1", "chair-2") }),
    { maxLength: 4 },
  ).map((xs) =>
    xs.map((x, k) => {
      const dur = lolaProfile.services.find((s) => s.id === x.svc)!.durationMin;
      return {
        id: `cb${k}`,
        resourceId: x.chair,
        serviceId: x.svc,
        start: x.start,
        end: x.start.add({ minutes: dur }),
        customerName: x.who.name,
        customerPhone: x.who.phone,
      };
    }),
  );

const arbExisting = (starts: fc.Arbitrary<Temporal.Instant>): fc.Arbitrary<ExistingBooking[]> =>
  fc.array(
    fc.record({ start: starts, len: fc.constantFrom(20, 30, 90), chair: fc.constantFrom("chair-1", "chair-2") }),
    { maxLength: 8 },
  ).map((xs) => xs.map((x, k) => ({ id: `e${k}`, resourceId: x.chair, start: x.start, end: x.start.add({ minutes: x.len }) })));

const arbTime = fc.oneof(
  fc.integer({ min: 36, max: 84 }).map((q) => `${String(Math.floor(q / 4)).padStart(2, "0")}:${String((q % 4) * 15).padStart(2, "0")}`),
  fc.record({ h: fc.integer({ min: 0, max: 23 }), m: fc.integer({ min: 0, max: 59 }) }).map(({ h, m }) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`),
);

const arbTurn = (now: Temporal.Instant): fc.Arbitrary<ModelTurn> =>
  fc
    .record({
      reply: fc.constantFrom("Vale.", "¿A nombre de quién?", "Of course."),
      language: fc.constantFrom("es" as const, "en" as const),
      wantsLanguage: fc.constantFrom(null, null, null, "es" as const, "en" as const),
      intent: fc.constantFrom("booking" as const, "booking" as const, "reschedule" as const, "cancel" as const, "question" as const, "order" as const, "other" as const),
      name: fc.constantFrom(null, null, "Ana", "ana", "ANA ", "Marta", "Luis"),
      phone: fc.constantFrom(null, null, "612345678", "+34 612 345 678", "699999999", "123456"),
      service: fc.constantFrom(null, null, "corte", "tinte", "barba", "manicura", "cortarme el pelo"),
      date: fc.option(fc.integer({ min: -2, max: 16 }).map((d) => now.toZonedDateTimeISO(TZ).toPlainDate().add({ days: d }).toString()), { nil: null, freq: 1 }),
      time: fc.option(arbTime, { nil: null, freq: 1 }),
      callerConfirmed: fc.boolean(),
      callerWantsToEnd: fc.constantFrom(false, false, false, false, true),
      outOfProfile: fc.constantFrom(false, false, false, true),
      reason: fc.constantFrom("Quiere cita", "Pregunta precios"),
      urgency: fc.constantFrom("low" as const, "normal" as const, "urgent" as const),
    })
    .map((t) => ModelTurnSchema.parse(t)); // the generator must produce valid model output

const arbPending = (starts: fc.Arbitrary<Temporal.Instant>, ids: string[]): fc.Arbitrary<PendingAction | undefined> =>
  fc.oneof(
    fc.constant(undefined),
    fc.record({ kind: fc.constant("book" as const), serviceId: fc.constantFrom(...SERVICE_IDS), start: starts.map(String) }),
    fc.record({
      kind: fc.constant("reschedule" as const),
      serviceId: fc.constantFrom(...SERVICE_IDS),
      start: starts.map(String),
      oldBookingId: fc.constantFrom("cb0", "cb1", "missing", ...ids),
    }),
    fc.record({ kind: fc.constant("cancel" as const), bookingId: fc.constantFrom("cb0", "cb1", "missing", ...ids) }),
  );

const arbState = (
  now: Temporal.Instant,
  starts: fc.Arbitrary<Temporal.Instant>,
  callerBookings: CallerBooking[],
): fc.Arbitrary<CallState> => {
  const ids = callerBookings.map((b) => b.id);
  const owners = callerBookings.map((b) => ({ name: b.customerName, phone: b.customerPhone }));
  return fc
    .record({
      stage: fc.constantFrom("collecting" as const, "awaiting_confirmation" as const, "awaiting_confirmation" as const, "done" as const),
      intent: fc.constantFrom("booking" as const, "reschedule" as const, "cancel" as const, "question" as const, "other" as const),
      language: fc.constantFrom("es" as const, "en" as const),
      who: fc.option(fc.constantFrom(...PEOPLE, ...owners), { nil: undefined }),
      serviceId: fc.option(fc.constantFrom(...SERVICE_IDS), { nil: undefined }),
      requested: fc.option(arbStart(now), { nil: undefined }),
      pending: arbPending(starts, ids),
      lastOffer: fc.option(fc.array(fc.oneof(arbStart(now), starts).map(String), { minLength: 1, maxLength: 3 }), { nil: undefined }),
      // front-desk-brain 8.3: what `lastOffer` holds, a First_Offer or a rejection's alternatives.
      offerKind: fc.constantFrom("first" as const, "alternatives" as const),
      existingBookingId: fc.option(fc.constantFrom("missing", ...ids), { nil: undefined }),
      turnCount: fc.integer({ min: 0, max: 22 }),
    })
    .map((g) => {
      const z = g.requested?.toZonedDateTimeISO(TZ);
      return {
        stage: g.stage,
        intent: g.intent,
        language: g.language,
        fields: {
          name: g.who?.name,
          phone: g.who?.phone,
          serviceId: g.serviceId,
          requested: z ? { date: z.toPlainDate().toString(), time: z.toPlainTime().toString().slice(0, 5) } : undefined,
        },
        pending: g.pending,
        lastOffer: g.lastOffer,
        offerKind: g.lastOffer ? g.offerKind : undefined,
        existingBookingId: g.existingBookingId,
        note: { reason: "", urgency: "normal" as const },
        consecutiveInvalid: 0,
        modelFailed: false,
        turnCount: g.turnCount,
      };
    });
};

/**
 * Every start (pending action, existing bookings, the caller's bookings, the offers) is
 * drawn mostly from a small shared pool, so they collide often. Half the
 * inputs are a plain "yes" with a pending action, in any stage: only the
 * awaiting_confirmation stage may turn it into a booking effect.
 *
 * front-desk-brain 8.3 extends the generator, not the assertions: a third of the inputs are brain
 * facts (`factsFromReading` of a real Reading of a short utterance, a plain "sí" in the plain-yes
 * branch), and offers come from the same pool, so a yes to an offer that the rules accept is
 * common. For a brain input, `turn.callerConfirmed` is set to the facts' `yes`, so the assertion
 * "the turn said yes" reads "the facts said yes" for both sources.
 */
const BRAIN_UTTERANCES = [
  "sí",
  "vale",
  "sí, perfecto",
  "sí, a las cinco",
  "no",
  "Ana",
  "612345678",
  "quiero un corte",
  "quiero cancelar mi cita",
  "quiero cambiar mi cita",
  "el martes a las diez",
  "¿aceptáis tarjeta?",
];

const arbInput = fc.constantFrom(...NOWS).chain((now) =>
  fc.array(arbStart(now), { minLength: 1, maxLength: 3 }).chain((pool) => {
    const starts = fc.oneof({ weight: 3, arbitrary: fc.constantFrom(...pool) }, { weight: 1, arbitrary: arbStart(now) });
    return arbCallerBookings(starts).chain((callerBookings) =>
      fc.record({
        now: fc.constant(now),
        state: arbState(now, starts, callerBookings),
        turn: arbTurn(now),
        existing: arbExisting(starts),
        callerBookings: fc.constant(callerBookings),
        plainYes: fc.boolean(),
        yesStage: fc.constantFrom("awaiting_confirmation" as const, "awaiting_confirmation" as const, "collecting" as const, "done" as const),
        intent: fc.constantFrom("booking" as const, "reschedule" as const, "cancel" as const),
        brain: fc.constantFrom(false, false, true),
        utterance: fc.constantFrom(...BRAIN_UTTERANCES),
      }).map(({ plainYes, yesStage, intent, brain, utterance, ...g }) => {
        const m = plainYes
          ? {
              ...g,
              state: { ...g.state, stage: yesStage, intent },
              turn: { ...g.turn, intent, name: null, phone: null, service: null, date: null, time: null, wantsLanguage: null, callerConfirmed: true, callerWantsToEnd: false },
            }
          : g;
        if (!brain) return m;
        const said = plainYes ? "sí" : utterance;
        const reading = readUtterance({ utterance: said, state: m.state, shop: lolaProfile, pack, now: m.now, lang: m.state.language });
        const facts = factsFromReading(reading, said);
        return { ...m, facts, turn: { ...m.turn, callerConfirmed: facts.yes } };
      }),
    );
  }),
);

// S2. Validates 5.8, 5.9, 3.11 (amendment 4: the server owns the facts).
describe("S2: decideTurn never books what the Booking_Rules would not accept", () => {
  it("every booking effect is accepted by evaluateBooking on the same bookings, and only after a read-back", { timeout: 120_000 }, () => {
    const seen = { createBooking: 0, reschedule: 0, cancelBooking: 0 };
    fc.assert(
      fc.property(arbInput, (g) => {
        // The fresh bookings include the caller's own, as the database would.
        const existing = [...g.existing, ...g.callerBookings];
        const d = decideTurn({ ...g, shop: lolaProfile, pack, existing });
        const ctx: RuleContext = {
          now: g.now,
          shop: toShopRules(lolaProfile),
          pack: { slotStepMin: pack.slotStepMin, rules: pack.rules },
          existing,
        };
        for (const e of d.effects) {
          if (e.type === "saveMessage") continue;
          seen[e.type]++;
          // Nothing is emitted unless the server stage was awaiting_confirmation with a pending action.
          expect(g.state.stage).toBe("awaiting_confirmation");
          expect(g.state.pending).toBeDefined();
          expect(g.turn.callerConfirmed).toBe(true);
          const pending = g.state.pending!;
          const { name, phone } = d.state.fields;

          if (e.type === "createBooking" || e.type === "reschedule") {
            const ignoreBookingId = e.type === "reschedule" ? e.oldBookingId : undefined;
            const again = evaluateBooking({ serviceId: e.serviceId, start: e.verdict.start, ignoreBookingId }, ctx);
            expect(again.ok).toBe(true);
            expect(again.ok && again.resourceId).toBe(e.verdict.resourceId);
            expect(again.ok && again.end.toString()).toBe(e.verdict.end.toString());
            // It is the server's own pending action, for the server's own caller.
            expect(pending.kind).toBe(e.type === "createBooking" ? "book" : "reschedule");
            expect(pending.kind !== "cancel" && [pending.serviceId, pending.start]).toEqual([e.serviceId, e.verdict.start.toString()]);
            expect([e.name, e.phone]).toEqual([name, phone]);
          }
          if (e.type === "reschedule" || e.type === "cancelBooking") {
            // Only the caller's own booking (phone AND name) is ever changed.
            const id = e.type === "reschedule" ? e.oldBookingId : e.bookingId;
            const target = g.callerBookings.find((b) => b.id === id);
            expect(target).toBeDefined();
            expect(matchesCaller({ name: name!, phone: phone! }, target!)).toBe(true);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
    // The generators must reach every kind of booking effect.
    expect(seen.createBooking + seen.reschedule + seen.cancelBooking).toBeGreaterThan(0);
  });

  it("the generators reach every booking effect (sanity check over a larger sample)", { timeout: 120_000 }, () => {
    const seen = new Set<string>();
    for (const g of fc.sample(arbInput, 3000)) {
      const d = decideTurn({ ...g, shop: lolaProfile, pack, existing: [...g.existing, ...g.callerBookings] });
      for (const e of d.effects) seen.add(e.type);
    }
    expect([...seen].sort()).toEqual(["cancelBooking", "createBooking", "reschedule", "saveMessage"]);
  });
});

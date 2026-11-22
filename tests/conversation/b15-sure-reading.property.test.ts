import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { readUtterance, type Reading } from "@/lib/conversation/brain/read";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { CallFields, CallState } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import { getSectorPack } from "@/lib/sectors";
import { UTTERANCE_POOL } from "./brain/arbitraries";
import { arbShop, arbUtterance } from "./brain/arbShops";
import { SAT_1930 } from "./brainCall";
import { CoreCaller, coreHarness, FAILING_KINDS, modelTurn, switchModel, type ModelBehaviour } from "./coreCall";
import { notSure } from "./notSure";

/**
 * B15. A Sure_Reading never calls the model, and says only what was said (front-desk-brain 2.2,
 * 2.3, 19.2, 19.3; design.md "handleTurn" steps 4, 5 and 7, "What makes a Reading sure").
 *
 * For the Rich_Profile and random shops, a Call is brought to one of its stages by a prefix of
 * brain Turns (fresh, a First_Offer waiting, a Service_Choice waiting, the name next, the phone next,
 * a read-back waiting), then one utterance is said: from `arbUtterance`, from the reader's pool, a
 * canonical line of the Sure table for that stage, or a line with three unplaceable words. The
 * Reading is computed by the oracle on the same stored state, then the Turn runs through
 * `handleTurnTimed` on the in-memory repository:
 *  - sure: the model records zero calls in that Turn, no `turn_fallback` line is written,
 *    `modelFailed` is unchanged, `brainTurns` grows by one, the `model` stage is 0; and every fact
 *    the Turn stores (services, day, requested day and time, name, phone, and a booking made on a
 *    yes) is one the Reading found in that utterance or the Call already had;
 *  - not sure: the model is called exactly once, with the Model_Wait: a valid answer is used, a
 *    hang holds the `model` stage until the Model_Wait is over.
 * Both branches are asserted reached, as are the Sure table's rows and the not-sure kinds.
 */
const pack = getSectorPack("hair-salon");
const W = 20; // coreConfig.modelTimeoutMs: the brain properties test the brain, not the clock (B8 does).

type Stage = "fresh" | "offer" | "choice" | "name" | "phone" | "readBack";

/** The prefix that brings a Call of this shop to a stage, said with a failing model (brain Turns). */
function prefixFor(stage: Stage, shop: ShopProfile): string[] {
  const s = shop.services[0];
  const book = `quería ${s.name.es}`;
  switch (stage) {
    case "fresh":
      return [];
    case "offer":
      return [book];
    case "choice":
      return ["quería un corte"];
    case "name":
      return [book, "sí"];
    case "phone":
      return [book, "sí", "Me llamo Ana"];
    case "readBack":
      return [book, "sí", "Me llamo Ana", "612 345 678"];
  }
}

/** One canonical line of the Sure table for a stage (19.2). */
const SURE_LINES: Record<Stage, (shop: ShopProfile) => string[]> = {
  fresh: (shop) => [
    `quería ${shop.services[0].name.es}`,
    ...(shop.faq?.length ? [`¿${shop.faq[0].aliases.es[0]}?`] : []),
    "quiero hablar con la dueña",
    "¿dónde estáis?",
    "gracias",
  ],
  offer: () => ["sí", "no", "mejor el jueves por la tarde"],
  // Only the answers the shop can give: a shop with no women's cut never reads "de mujer" as sure.
  choice: (shop) => {
    const has = (id: string) => shop.services.some((s) => s.id === id);
    const lines = [...(has("corte-hombre") ? ["de hombre"] : []), ...(has("corte-mujer") ? ["de mujer"] : [])];
    return lines.length ? lines : ["de hombre", "de mujer"];
  },
  name: () => ["Me llamo Ana"],
  phone: () => ["612 345 678"],
  readBack: () => ["sí", "no"],
};

/** Lines that are never sure: a question no Profile_Topic answers, or three unplaceable words. */
const NOT_SURE_LINES = ["¿y qué tal es Lola cortando?", "Oye, ¿y Lola es simpática?", notSure("quería un corte de mujer", "es"), notSure("sí", "es")];

const STAGES: readonly Stage[] = ["fresh", "offer", "choice", "name", "phone", "readBack"];

const arbCase = fc.oneof(fc.constant(lolaSeedProfile), arbShop).chain((shop: ShopProfile) =>
  fc.record({
    shop: fc.constant(shop),
    stage: fc.constantFrom(...STAGES),
    source: fc.constantFrom("arb", "pool", "sure", "notSure"),
    arb: arbUtterance(shop),
    pool: fc.constantFrom(...UTTERANCE_POOL),
    pick: fc.nat(),
    prefixFailure: fc.constantFrom(...FAILING_KINDS.filter((k) => k !== "hang")),
    final: fc.constantFrom<"valid" | "hang">("valid", "hang"),
  }),
);

const local = (iso: string, shop: ShopProfile) => {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(shop.timeZone);
  return { date: z.toPlainDate().toString(), time: z.toPlainTime().toString().slice(0, 5) };
};
const hhmm = (t: Temporal.PlainTime | null) => (t ? t.toString().slice(0, 5) : null);
const parts = (id: string | undefined) => (id ? id.split("+") : []);

/** Every service id the Reading or the Call already had: nothing else may appear in `serviceId`. */
function knownServices(before: CallState, reading: Reading): Set<string> {
  const out = new Set(parts(before.fields.serviceId));
  const add = (xs: readonly string[] | null | undefined) => xs?.forEach((x) => out.add(x));
  add(reading.serviceChange.next);
  const r = reading.services;
  if (r.kind === "set") add(r.ids);
  if (r.kind === "choice") add([...r.candidates, ...r.with]);
  if (r.kind === "category") add(r.with);
  add(before.fields.serviceChoice?.candidates);
  add(before.fields.serviceChoice?.with);
  return out;
}

/** The requested slots the Turn may store: one the Reading said, or one the Call already offered or held. */
function allowedRequested(before: CallState, reading: Reading, shop: ShopProfile): Set<string> {
  const out = new Set<string>();
  const key = (r: { date: string; time: string }) => `${r.date}T${r.time}`;
  if (before.fields.requested) out.add(key(before.fields.requested));
  for (const iso of before.lastOffer ?? []) out.add(key(local(iso, shop)));
  if (before.pending && before.pending.kind !== "cancel") out.add(key(local(before.pending.start, shop)));
  const time = hhmm(reading.time);
  if (time) {
    const days = [reading.day?.toString(), before.fields.requested?.date, before.fields.day].filter((d): d is string => !!d);
    for (const d of days) out.add(`${d}T${time}`);
  }
  // A new day alone keeps the Call's time ("mejor el jueves"): the day was said, the time was had.
  if (reading.day && before.fields.requested) out.add(`${reading.day.toString()}T${before.fields.requested.time}`);
  return out;
}

function expectOnlyWhatWasSaid(before: CallState, after: CallState, reading: Reading, shop: ShopProfile, said: string) {
  const b: CallFields = before.fields;
  const a: CallFields = after.fields;
  if (a.name !== undefined && a.name !== b.name) expect(a.name, `${said}: name`).toBe(reading.name);
  if (a.phone !== undefined && a.phone !== b.phone) expect(a.phone, `${said}: phone`).toBe(reading.phone);
  if (a.day !== undefined && a.day !== b.day) expect(a.day, `${said}: day`).toBe(reading.day?.toString());
  if (a.requested && (a.requested.date !== b.requested?.date || a.requested.time !== b.requested?.time)) {
    expect([...allowedRequested(before, reading, shop)], `${said}: requested`).toContain(`${a.requested.date}T${a.requested.time}`);
  }
  if (a.serviceId !== undefined && a.serviceId !== b.serviceId) {
    const known = knownServices(before, reading);
    for (const p of parts(a.serviceId)) expect([...known], `${said}: service ${p}`).toContain(p);
  }
}

describe("B15: a Sure_Reading never calls the model, and says only what was said", () => {
  it("sure: no model call, no log line, modelFailed unchanged, only said facts; not sure: one model call with the Model_Wait", { timeout: 300_000 }, async () => {
    const reached: Record<string, number> = { sure: 0, notSure: 0, sureRow: 0, notSureQuestion: 0, notSureUnplaced: 0, booked: 0, valid: 0, hang: 0 };
    for (const s of STAGES) reached[`stage:${s}`] = 0;
    await fc.assert(
      fc.asyncProperty(arbCase, async ({ shop, stage, source, arb, pool, pick, prefixFailure, final }) => {
        const model = switchModel({ kind: prefixFailure } as ModelBehaviour);
        const h = coreHarness({ shops: [shop], now: SAT_1930, model });
        const c = new CoreCaller(h.deps, shop, "es");
        await c.start();
        for (const line of prefixFor(stage, shop)) {
          const out = await c.say(line);
          if (out.complete) return; // a prefix that ended the Call says nothing about this stage
        }

        const sureLines = SURE_LINES[stage](shop);
        const utterance =
          source === "arb" ? arb : source === "pool" ? pool : source === "sure" ? sureLines[pick % sureLines.length] : NOT_SURE_LINES[pick % NOT_SURE_LINES.length];

        const call = h.repo.calls()[0];
        const before: CallState = { ...call.state, language: c.language };
        const reading = readUtterance({ utterance, state: before, shop, pack, now: SAT_1930, lang: c.language });

        // The canonical rows of the Sure table are sure only when the prefix really reached the stage.
        const atStage =
          stage === "fresh"
            ? before.stage === "collecting" && before.fields.serviceId === undefined && !before.lastOffer?.length
            : stage === "offer"
              ? (before.lastOffer?.length ?? 0) > 0 && before.stage === "collecting"
              : stage === "choice"
                ? before.fields.serviceChoice !== undefined
                : stage === "name"
                  ? before.stage === "collecting" && before.fields.requested !== undefined && before.fields.name === undefined
                  : stage === "phone"
                    ? before.stage === "collecting" && before.fields.name !== undefined && before.fields.phone === undefined
                    : before.stage === "awaiting_confirmation";
        if (source === "sure" && atStage) {
          expect(reading.sure, `${stage}: "${utterance}" (${reading.leftover})`).toBe(true);
          reached.sureRow++;
        }
        if (source === "notSure") {
          expect(reading.sure, `${stage}: "${utterance}"`).toBe(false);
          if (utterance.includes("¿")) reached.notSureQuestion++;
          else reached.notSureUnplaced++;
        }
        if (reading.unplaced > 2) expect(reading.sure).toBe(false);

        model.behaviour = final === "valid" ? { kind: "valid", turn: modelTurn({ intent: "question", reply: "Claro." }) } : { kind: "hang" };
        const callsBefore = model.calls;
        const eventsBefore = h.events.length;
        const bookingsBefore = h.repo.bookings().length;
        const { output, timings } = await c.sayTimed(utterance);
        const after = h.repo.calls()[0].state;

        for (const v of Object.values(timings)) expect(v).toBeGreaterThanOrEqual(0);
        if (reading.sure) {
          reached.sure++;
          expect(model.calls - callsBefore, utterance).toBe(0);
          expect(h.events.length - eventsBefore, utterance).toBe(0);
          expect(after.modelFailed).toBe(before.modelFailed);
          expect(after.brainTurns ?? 0).toBe((before.brainTurns ?? 0) + 1);
          expect(timings.model).toBe(0);
          expectOnlyWhatWasSaid(before, after, reading, shop, utterance);
          if (h.repo.bookings().length > bookingsBefore) {
            // A booking on a Sure_Reading needs the Caller's own yes to a read-back (13.5).
            expect(reading.yes, utterance).toBe(true);
            expect(before.stage).toBe("awaiting_confirmation");
            reached.booked++;
          }
        } else {
          reached.notSure++;
          reached[final]++;
          expect(model.calls - callsBefore, utterance).toBe(1);
          if (final === "hang") {
            // The model stage lasts the Model_Wait (timers never fire early; 1 ms for clock rounding).
            expect(timings.model, utterance).toBeGreaterThanOrEqual(W - 1);
            expect(after.modelFailed).toBe(true);
            expect(h.events.length - eventsBefore).toBe(1);
          } else {
            expect(h.events.length - eventsBefore).toBe(0);
          }
        }
        expect(output.reply.length).toBeGreaterThan(0);
        if (atStage) reached[`stage:${stage}`]++;
      }),
      { numRuns: 200 },
    );
    for (const [k, v] of Object.entries(reached)) expect(v, k).toBeGreaterThan(0);
  });
});

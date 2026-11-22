import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { lolaSeedProfile } from "@/lib/db/seed";
import { phrases } from "@/lib/receptionist/phrases";
import { spokenTemplate } from "@/lib/receptionist/speech";
import { getSectorPack } from "@/lib/sectors";
import { arbModelBehaviour } from "./brain/arbitraries";
import { arbShop, arbUtterance } from "./brain/arbShops";
import { CoreCaller, coreHarness, switchModel, type ModelBehaviour } from "./coreCall";

/**
 * B1. A model failure never ends a Call (front-desk-brain 1.1–1.3, 1.7). For the Rich_Profile and
 * random shops, conversations of 1–12 everyday utterances with no goodbye, and a model behaviour
 * per Turn (a valid turn, a 503, a 429, a hang, a network error, invalid JSON, a schema-invalid
 * object), through `handleTurn` on the in-memory repository:
 *  - every Turn returns `complete: false` unless it booked, rescheduled or cancelled, or the Turn
 *    limit was reached;
 *  - no reply is the Fallback_Message in either language;
 *  - no stored Call is `failed` and no Message has outcome `fallback`.
 * The model wait is 20 ms (design.md: the brain properties test the brain, not the clock).
 */
const pack = getSectorPack("hair-salon");
const ENDS = new Set(["booked", "rescheduled", "cancelled"]);
/** Goodbye words are left out: B1 is about Calls the Caller has not ended. */
const GOODBYE = /\b(adi[oó]s|hasta luego|nada m[aá]s|eso es todo|bye|that's all)\b/i;

const arbCase = fc.oneof(fc.constant(lolaSeedProfile), arbShop).chain((shop: ShopProfile) =>
  fc.record({
    shop: fc.constant(shop),
    lang: fc.constantFrom("es" as const, "en" as const),
    now: fc.integer({ min: 0, max: 12 * 24 * 14 }).map((k) => Temporal.Instant.from("2026-03-20T07:00:00Z").add({ minutes: k * 5 })),
    turns: fc.array(fc.tuple(arbUtterance(shop).filter((u) => !GOODBYE.test(u)), arbModelBehaviour), { minLength: 1, maxLength: 12 }),
  }),
);

describe("B1: a model failure never ends a Call", () => {
  it("every failure gets the brain's answer and the Call goes on", { timeout: 300_000 }, async () => {
    const reached: Record<ModelBehaviour["kind"] | "booked" | "brainTurns", number> = {
      valid: 0,
      "503": 0,
      "429": 0,
      hang: 0,
      network: 0,
      invalid_json: 0,
      schema_invalid: 0,
      booked: 0,
      brainTurns: 0,
    };
    // Requirement 1.7 (a Call completable with every Turn answered by the brain) is a rare branch
    // at random, so one fixed example books with a different failure on each Turn. fast-check
    // counts examples inside numRuns, so 100 random runs plus the example make 101. Since task 17
    // every line of this example is a Sure_Reading, so the model is never called and the example
    // pins 1.7 itself (a whole booking answered by the brain); the failure kinds come from the
    // random runs, counted only when the model was really called.
    const bookingExample = {
      shop: lolaSeedProfile,
      lang: "es" as const,
      now: Temporal.Instant.from("2026-11-14T18:30:00Z"),
      turns: [
        ["Hola Lola quería cortarme el pelo y hacerme un degradado", { kind: "503" }],
        ["sí", { kind: "hang" }],
        ["Me llamo Ana", { kind: "429" }],
        ["612 345 678", { kind: "network" }],
        ["sí", { kind: "schema_invalid" }],
      ] as [string, ModelBehaviour][],
    };
    await fc.assert(
      fc.asyncProperty(arbCase, async ({ shop, lang, now, turns }) => {
        const model = switchModel();
        const h = coreHarness({ shops: [shop], now, model });
        const fallback = new Set(
          (["es", "en"] as const).map((l) => spokenTemplate(phrases(l, pack, shop, undefined, now).fallbackEnd().text, l)),
        );
        const c = new CoreCaller(h.deps, shop, lang);
        await c.start();
        for (const [utterance, behaviour] of turns) {
          model.behaviour = behaviour;
          // front-desk-brain 17.5: a Sure_Reading never calls the model, so a behaviour counts as
          // reached only on a Turn that really called the model. Before task 17 every Turn did, and
          // the count was taken before the Turn; counting after it keeps "every failure kind ran"
          // true instead of letting Sure_Readings stand in for model failures.
          const callsBefore = model.calls;
          const out = await c.say(utterance);
          if (model.calls > callsBefore) reached[behaviour.kind]++;
          expect(fallback.has(out.reply), out.reply).toBe(false);
          expect(out.outcome).not.toBe("fallback");
          const call = h.repo.calls()[0];
          if (out.complete) {
            const limit = call.turnCount >= h.deps.config.maxTurns;
            expect(limit || ENDS.has(out.outcome ?? ""), `${utterance} → ${out.outcome}`).toBe(true);
            if (out.outcome === "booked") reached.booked++;
            break;
          }
        }
        for (const call of h.repo.calls()) {
          expect(call.status).not.toBe("failed");
          reached.brainTurns += call.state.brainTurns ?? 0;
        }
        for (const m of h.repo.messages()) expect(m.outcome).not.toBe("fallback");
      }),
      { numRuns: 101, examples: [[bookingExample]] },
    );
    // Every behaviour ran, the brain answered Turns, and some Call booked (1.7).
    for (const [k, v] of Object.entries(reached)) expect(v, k).toBeGreaterThan(0);
  });
});

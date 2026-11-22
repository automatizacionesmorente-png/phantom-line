import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { readUtterance } from "@/lib/conversation/brain/read";
import { initialCallState, type ModelClient, type TurnOutput } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import { getSectorPack } from "@/lib/sectors";
import { UTTERANCE_POOL } from "./brain/arbitraries";
import { SAT_1930 } from "./brainCall";
import { CoreCaller, coreHarness, modelTurn, runBehaviour, type ModelBehaviour } from "./coreCall";

/**
 * B8. The brain answers by the Model_Wait, and a late model changes nothing (front-desk-brain
 * 2.3–2.5). With fake timers: for Model_Waits W in [100, 3000] ms, utterances that are not
 * Sure_Readings, and a model whose service answers at time t in [0, 5000] ms after the Turn's
 * model call starts (a valid answer, a 503, a 429, invalid output, a hang):
 *  - the Turn resolves at min(t, W) for a failure, at t for a valid answer with t < W, else at W;
 *  - the Turn_Source is `model` iff a valid answer came before W (the brain counts its Turns in
 *    `brainTurns`, and only a brain Turn after a model failure sets `modelFailed`);
 *  - on the brain path the stored Call equals the Call of the same Turn answered by the brain
 *    with a model that fails at once, and a late valid answer, once it settles, changes nothing.
 *
 * "At time t" is the model service's time, not each attempt's: every attempt that is running at t
 * gets that answer then, so a hedge or a 5xx retry (both in `callReceptionist`) does not move the
 * end of the Turn. t = W is left out: two timers due at the same instant, and the spec defines no
 * winner between them. The resolution time is read from the fake clock when the Turn's promise
 * settles, so "within one timer tick" is exact here.
 */
const shop = lolaSeedProfile;
const pack = getSectorPack(shop.sectorPackId);

/** The pool's utterances that are not Sure_Readings at the start of a Call, so the model is called after task 17 too. */
const NOT_SURE = UTTERANCE_POOL.filter(
  (u) => !readUtterance({ utterance: u, state: initialCallState("es"), shop, pack, now: SAT_1930, lang: "es" }).sure,
);

type Kind = "valid" | "503" | "429" | "invalid_json" | "schema_invalid" | "hang";

function behaviourOf(kind: Kind): ModelBehaviour {
  return kind === "valid" ? { kind, turn: modelTurn({ intent: "question", reply: "Claro, dime.", reason: "Una pregunta" }) } : { kind };
}

/** A model service that gives every attempt running at `t` (ms after the first attempt) the same answer. Hangs ignore the signal. */
function timedModel(kind: Kind, t: number): ModelClient & { calls: number } {
  let first: number | null = null;
  const m = {
    calls: 0,
    generate() {
      m.calls++;
      const now = Date.now();
      first ??= now;
      if (kind === "hang") return new Promise<string>(() => {});
      const delay = Math.max(0, first + t - now);
      return new Promise<string>((resolve, reject) => {
        setTimeout(() => runBehaviour(behaviourOf(kind)).then(resolve, reject), delay);
      });
    },
  };
  return m;
}

/** Drains promise callbacks with the real setImmediate, which these fake timers leave alone. */
const flush = () => new Promise<void>((r) => setImmediate(r));

async function runTurn(model: ModelClient, W: number, utterance: string) {
  const h = coreHarness({ shops: [shop], now: SAT_1930, model, config: { modelTimeoutMs: W } });
  const c = new CoreCaller(h.deps, shop, "es");
  await c.start();
  const t0 = Date.now();
  let doneAt: number | null = null;
  let out: TurnOutput | null = null;
  void c.say(utterance).then((o) => {
    doneAt = Date.now();
    out = o;
  });
  await flush();
  while (doneAt === null) {
    if (vi.getTimerCount() === 0) throw new Error("the Turn is stuck with no timer left");
    await vi.advanceTimersToNextTimerAsync();
    await flush();
  }
  return { h, elapsed: (doneAt as number) - t0, out: out as unknown as TurnOutput };
}

const arbCase = fc
  .record({
    W: fc.integer({ min: 100, max: 3000 }),
    t: fc.integer({ min: 0, max: 5000 }),
    kind: fc.constantFrom<Kind>("valid", "503", "429", "invalid_json", "schema_invalid", "hang"),
    utterance: fc.constantFrom(...NOT_SURE),
  })
  .filter(({ W, t }) => W !== t);

describe("B8: the brain answers by the Model_Wait, and a late model changes nothing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the pool has utterances that are not sure", () => {
    expect(NOT_SURE.length).toBeGreaterThanOrEqual(5);
  });

  it("resolves at min(t, W) for a failure, at t for an early valid answer, and the late answer is dropped", { timeout: 300_000 }, async () => {
    const reached = { modelEarly: 0, validLate: 0, failEarly: 0, failLate: 0, hang: 0, hedged: 0 };
    await fc.assert(
      fc.asyncProperty(arbCase, async ({ W, t, kind, utterance }) => {
        vi.clearAllTimers();
        const model = timedModel(kind, t);
        const { h, elapsed } = await runTurn(model, W, utterance);
        const fromModel = kind === "valid" && t < W;
        const expected = kind === "hang" ? W : kind === "valid" ? (t < W ? t : W) : Math.min(t, W);
        expect(elapsed, `${kind} t=${t} W=${W}`).toBe(expected);

        const call = h.repo.calls()[0];
        expect(call.state.brainTurns ?? 0, "Turn_Source").toBe(fromModel ? 0 : 1);
        expect(call.state.modelFailed).toBe(!fromModel);
        expect(call.status).toBe("open");
        if (model.calls > 1) reached.hedged++;

        if (fromModel) {
          reached.modelEarly++;
          return;
        }
        if (kind === "hang") reached.hang++;
        else if (kind === "valid") reached.validLate++;
        else if (t < W) reached.failEarly++;
        else reached.failLate++;

        // The same Turn answered by the brain at once (a model that fails immediately).
        const now = await runTurn(timedModel("429", 0), W, utterance);
        const brainCall = now.h.repo.calls()[0];
        expect(call.state).toEqual(brainCall.state);
        expect(call.transcript).toEqual(brainCall.transcript);

        // Let a late answer (or a late failure) settle: the stored Call does not change.
        const before = { state: call.state, transcript: call.transcript, turnCount: call.turnCount };
        await vi.advanceTimersByTimeAsync(Math.max(0, t - W) + 10);
        await flush();
        const after = h.repo.calls()[0];
        expect({ state: after.state, transcript: after.transcript, turnCount: after.turnCount }).toEqual(before);
        expect(h.repo.messages()).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
    for (const [k, v] of Object.entries(reached)) expect(v, k).toBeGreaterThan(0);
  });
});

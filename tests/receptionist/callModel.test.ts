import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTEMPT_TIMEOUT_MS,
  callReceptionist,
  createScriptedModel,
  failsWith503,
  geminiHighDemandError,
  hangsThen,
  MAX_MODEL_ATTEMPTS,
  MIN_ATTEMPT_MS,
  MODEL_TIMEOUT_MS,
  neverResolves,
  returnsGarbage,
  throws429,
  throwsNetwork,
  type ModelFailureInfo,
  type ModelSuccessInfo,
} from "@/lib/receptionist/callModel";
import type { ModelClient } from "@/lib/conversation/types";
import type { ModelTurn } from "@/lib/receptionist/schema";

const PROMPT = { systemInstruction: "sys", input: "in" };
// The production Model_Wait (2400 ms since front-desk-brain task 7; it was 8000).
const OPTS = { timeoutMs: MODEL_TIMEOUT_MS };
const TURN: ModelTurn = {
  reply: "Hola",
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
  reason: "Saluda",
  urgency: "normal",
};

describe("callReceptionist", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the validated turn", async () => {
    await expect(callReceptionist(createScriptedModel([TURN]), PROMPT, OPTS)).resolves.toEqual({ ok: true, turn: TURN });
  });

  it("times out at exactly the Model_Wait, even when the client ignores the signal", async () => {
    let settled = false;
    const p = callReceptionist(neverResolves, PROMPT, OPTS).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await expect(p).resolves.toEqual({ ok: false, failure: "timeout" });
  });

  it("aborts the signal it passed to the client at the deadline", async () => {
    let seen: AbortSignal | undefined;
    const client: ModelClient = {
      generate: ({ signal }) => {
        seen = signal;
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      },
    };
    const p = callReceptionist(client, PROMPT, OPTS);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS);
    expect(seen?.aborted).toBe(true);
    // The abort error the client throws is still classified as a timeout, by our own timer.
    await expect(p).resolves.toEqual({ ok: false, failure: "timeout" });
  });

  it("passes the JSON Schema of ModelTurn to the client", async () => {
    let schema: object | undefined;
    const client: ModelClient = {
      generate: async (req) => {
        schema = req.jsonSchema;
        return JSON.stringify(TURN);
      },
    };
    await callReceptionist(client, PROMPT, OPTS);
    expect(schema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("a 429 is quota", async () => {
    await expect(callReceptionist(throws429, PROMPT, OPTS)).resolves.toEqual({ ok: false, failure: "quota" });
    const statusCode: ModelClient = {
      generate: async () => {
        throw Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
      },
    };
    await expect(callReceptionist(statusCode, PROMPT, OPTS)).resolves.toEqual({ ok: false, failure: "quota" });
  });

  it("a network error or a 503 is unavailable", async () => {
    await expect(callReceptionist(throwsNetwork, PROMPT, OPTS)).resolves.toEqual({ ok: false, failure: "unavailable" });
    const busy: ModelClient = {
      generate: async () => {
        throw Object.assign(new Error("high demand"), { status: 503 });
      },
    };
    await expect(callReceptionist(busy, PROMPT, OPTS)).resolves.toEqual({ ok: false, failure: "unavailable" });
  });

  it("garbage is invalid_output: broken JSON, or JSON that fails zod", async () => {
    await expect(callReceptionist(returnsGarbage, PROMPT, OPTS)).resolves.toEqual({ ok: false, failure: "invalid_output" });
    const wrongShape = createScriptedModel([JSON.stringify({ ...TURN, intent: "maybe" })]);
    await expect(callReceptionist(wrongShape, PROMPT, OPTS)).resolves.toEqual({ ok: false, failure: "invalid_output" });
    const extraKey = createScriptedModel([JSON.stringify({ ...TURN, accepted: true })]);
    await expect(callReceptionist(extraKey, PROMPT, OPTS)).resolves.toEqual({ ok: false, failure: "invalid_output" });
  });

  it("clears its timer when the model answers", async () => {
    await callReceptionist(createScriptedModel([TURN]), PROMPT, OPTS);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("callReceptionist: Gemini's 503 'high demand' (end-to-end bug, 2026-11-12)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("one 503 then a valid answer: the Turn gets the answer, not the fallback", async () => {
    const model = failsWith503(1, createScriptedModel([TURN]));
    await expect(callReceptionist(model, PROMPT, OPTS)).resolves.toEqual({ ok: true, turn: TURN });
    expect(model.calls).toBe(2);
  });

  it("503 on every attempt: unavailable after MAX_MODEL_ATTEMPTS calls, with the cause reported", async () => {
    const model = failsWith503(99, createScriptedModel([]));
    const seen: ModelFailureInfo[] = [];
    const r = await callReceptionist(model, PROMPT, { ...OPTS, onFailure: (i) => seen.push(i) });
    expect(r).toEqual({ ok: false, failure: "unavailable" });
    expect(model.calls).toBe(MAX_MODEL_ATTEMPTS);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      failure: "unavailable",
      status: 503,
      errorClass: "InternalServerError",
      attempts: MAX_MODEL_ATTEMPTS,
    });
    expect(seen[0].message).toContain("high demand");
    // Every 503 before the last one is on record too.
    expect(seen[0].earlier).toHaveLength(MAX_MODEL_ATTEMPTS - 1);
    expect(seen[0].earlier?.[0]).toMatchObject({ status: 503, errorClass: "InternalServerError" });
  });

  it("a 429 is never retried", async () => {
    let calls = 0;
    const model: ModelClient = {
      generate: async (req) => {
        calls++;
        return throws429.generate(req);
      },
    };
    await expect(callReceptionist(model, PROMPT, OPTS)).resolves.toEqual({ ok: false, failure: "quota" });
    expect(calls).toBe(1);
  });

  it("an error without a status (network) is not retried", async () => {
    let calls = 0;
    const model: ModelClient = {
      generate: async (req) => {
        calls++;
        return throwsNetwork.generate(req);
      },
    };
    await expect(callReceptionist(model, PROMPT, OPTS)).resolves.toEqual({ ok: false, failure: "unavailable" });
    expect(calls).toBe(1);
  });

  it("a retry stays inside the same Model_Wait", async () => {
    // The first attempt answers 503 after 1 s, before its own deadline, so the retry starts
    // at once. The retry would answer 3 s later; the Model_Wait cuts it at 2.4 s.
    let calls = 0;
    const delays = [1000, 3000];
    const slow503: ModelClient = {
      generate: () => {
        const delay = delays[calls++];
        return new Promise((_, reject) => setTimeout(() => reject(geminiHighDemandError()), delay));
      },
    };
    expect(delays[0]).toBeLessThan(ATTEMPT_TIMEOUT_MS);
    expect(delays[0] + delays[1]).toBeGreaterThan(MODEL_TIMEOUT_MS);
    let settled = false;
    const p = callReceptionist(slow503, PROMPT, OPTS).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ ok: false, failure: "timeout" });
    expect(calls).toBe(2);
  });

  it("a 503 on the hedge starts no third attempt: the cap holds", async () => {
    // Attempt 0 hangs; the hedge at ATTEMPT_TIMEOUT_MS answers 503 at once. Both attempts
    // are used, so the Turn waits for the hung one and times out at the Model_Wait.
    let calls = 0;
    const client: ModelClient = {
      generate: () => {
        calls++;
        return calls === 1 ? new Promise<string>(() => {}) : Promise.reject(geminiHighDemandError());
      },
    };
    const p = callReceptionist(client, PROMPT, OPTS);
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ ok: false, failure: "timeout" });
    expect(calls).toBe(MAX_MODEL_ATTEMPTS);
  });
});

describe("callReceptionist: failure details for the server log", () => {
  it("invalid output reports zod issues, never the model's text", async () => {
    const seen: ModelFailureInfo[] = [];
    const wrong = createScriptedModel([JSON.stringify({ ...TURN, name: "Ana Secreta", intent: "maybe" })]);
    await callReceptionist(wrong, PROMPT, { ...OPTS, onFailure: (i) => seen.push(i) });
    expect(seen[0].failure).toBe("invalid_output");
    expect(seen[0].invalid).toMatchObject({ kind: "schema", issues: [{ path: "intent", code: "invalid_value" }] });
    expect(JSON.stringify(seen[0])).not.toContain("Ana Secreta");
  });

  it("broken JSON reports only its length: V8's message would quote the text", async () => {
    const seen: ModelFailureInfo[] = [];
    const broken = createScriptedModel(['{"reply": "Hola Ana Secreta, tu teléfono 600123123"']);
    await callReceptionist(broken, PROMPT, { ...OPTS, onFailure: (i) => seen.push(i) });
    expect(seen[0]).toMatchObject({ failure: "invalid_output", invalid: { kind: "json" } });
    expect(JSON.stringify(seen[0])).not.toMatch(/Ana|600123123/);
  });

  it("an empty answer is reported as empty", async () => {
    const seen: ModelFailureInfo[] = [];
    await callReceptionist(createScriptedModel([""]), PROMPT, { ...OPTS, onFailure: (i) => seen.push(i) });
    expect(seen[0]).toMatchObject({ failure: "invalid_output", invalid: { kind: "empty" } });
  });

  it("a timeout is reported with its latency and every attempt it made", async () => {
    vi.useFakeTimers();
    const seen: ModelFailureInfo[] = [];
    const p = callReceptionist(neverResolves, PROMPT, { ...OPTS, onFailure: (i) => seen.push(i) });
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS);
    await p;
    vi.useRealTimers();
    // The first attempt hits its own deadline; the hedge, the last attempt, keeps the rest of the budget.
    expect(seen[0]).toMatchObject({ failure: "timeout", attempts: MAX_MODEL_ATTEMPTS });
    expect(seen[0].earlier).toEqual([{ outcome: "attempt_timeout", latencyMs: ATTEMPT_TIMEOUT_MS }]);
    expect(seen[0].latencyMs).toBeGreaterThanOrEqual(MODEL_TIMEOUT_MS);
  });

  it("a logger that throws does not change the outcome", async () => {
    const r = await callReceptionist(throws429, PROMPT, {
      ...OPTS,
      onFailure: () => {
        throw new Error("logger down");
      },
    });
    expect(r).toEqual({ ok: false, failure: "quota" });
  });
});

describe("callReceptionist: a hung attempt never takes the whole budget (bugfix 2026-11-12)", () => {
  // Real calls on next dev: two of three model calls hung for the full 8 s on a single attempt
  // ({"failure":"timeout","attempts":1,"latencyMs":8009}). Each attempt now has its own deadline.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the budget fits the attempts it promises", () => {
    // Owner decision of 2026-11-16 (front-desk-brain question 17): a 2.4 s Model_Wait.
    expect(MODEL_TIMEOUT_MS).toBeLessThanOrEqual(2400);
    // The first attempt is not the last: a hedge started at its deadline still gets MIN_ATTEMPT_MS.
    expect(MODEL_TIMEOUT_MS - ATTEMPT_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_ATTEMPT_MS);
    expect(MIN_ATTEMPT_MS).toBeLessThanOrEqual(ATTEMPT_TIMEOUT_MS);
    expect(MAX_MODEL_ATTEMPTS).toBeGreaterThanOrEqual(2);
  });

  it("first attempt hangs: a fresh attempt starts at its deadline and its answer is used", async () => {
    const model = hangsThen(1, createScriptedModel([TURN]));
    const ok: ModelSuccessInfo[] = [];
    let settled = false;
    const p = callReceptionist(model, PROMPT, { ...OPTS, onSuccess: (i) => ok.push(i) }).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS - 1);
    expect(model.calls).toBe(1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ ok: true, turn: TURN });
    expect(model.calls).toBe(2);
    expect(model.attempts).toEqual([0, 1]);
    expect(ok[0]).toMatchObject({ attempts: 2, earlier: [{ outcome: "attempt_timeout" }] });
  });

  it("the first attempt keeps running beside the fresh one, and its late answer wins if it comes first", async () => {
    // Measured 2026-11-12: answers just past the attempt deadline were common. Aborting the
    // first attempt at its deadline would have thrown them away.
    const ANSWER_AFTER = ATTEMPT_TIMEOUT_MS + 300;
    expect(ANSWER_AFTER).toBeLessThan(MODEL_TIMEOUT_MS);
    const signals: AbortSignal[] = [];
    const client = {
      generate: (req: { signal: AbortSignal }) => {
        signals.push(req.signal);
        const k = signals.length;
        return new Promise<string>((resolve) =>
          // Each attempt answers ANSWER_AFTER after it starts: attempt 1 at 1.5 s, attempt 2 (started at 1.2 s) at 2.7 s.
          setTimeout(() => resolve(JSON.stringify({ ...TURN, reply: `attempt ${k}` })), ANSWER_AFTER),
        );
      },
    };
    const ok: ModelSuccessInfo[] = [];
    const p = callReceptionist(client, PROMPT, { ...OPTS, onSuccess: (i) => ok.push(i) });
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(ANSWER_AFTER - ATTEMPT_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ ok: true, turn: { ...TURN, reply: "attempt 1" } });
    // The second attempt was still running (started at the deadline) when the first answered.
    expect(ok[0]).toMatchObject({ attempts: 2, earlier: [{ outcome: "unfinished", latencyMs: ANSWER_AFTER - ATTEMPT_TIMEOUT_MS }] });
    // Once the Turn has its answer, every attempt still running is told to stop.
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("the first attempt hangs: the last one keeps the rest of the budget and answers 100 ms before the end", async () => {
    const answerAt = MODEL_TIMEOUT_MS - 100;
    const slowLast = {
      calls: 0,
      generate() {
        this.calls++;
        if (this.calls < MAX_MODEL_ATTEMPTS) return new Promise<string>(() => {});
        return new Promise<string>((resolve) =>
          setTimeout(() => resolve(JSON.stringify(TURN)), answerAt - (MAX_MODEL_ATTEMPTS - 1) * ATTEMPT_TIMEOUT_MS),
        );
      },
    };
    const p = callReceptionist(slowLast, PROMPT, OPTS);
    await vi.advanceTimersByTimeAsync(answerAt);
    await expect(p).resolves.toEqual({ ok: true, turn: TURN });
    expect(slowLast.calls).toBe(MAX_MODEL_ATTEMPTS);
  });

  it("every attempt hangs: timeout at exactly the Model_Wait", async () => {
    const model = hangsThen(99, createScriptedModel([]));
    let settled = false;
    const p = callReceptionist(model, PROMPT, OPTS).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ ok: false, failure: "timeout" });
    expect(model.calls).toBeLessThanOrEqual(MAX_MODEL_ATTEMPTS);
    expect(model.calls).toBeGreaterThanOrEqual(2);
  });

  it("a 429 after a hung attempt is still never retried", async () => {
    let calls = 0;
    const client = {
      generate: (req: Parameters<typeof neverResolves.generate>[0]) => {
        calls++;
        return calls === 1 ? new Promise<string>(() => {}) : throws429.generate(req);
      },
    };
    const p = callReceptionist(client, PROMPT, OPTS);
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ ok: false, failure: "quota" });
    expect(calls).toBe(2);
  });

  it("reports the model each attempt used when the client names it", async () => {
    const list = ["model-a", "model-b"];
    const model = { ...hangsThen(1, createScriptedModel([TURN])), modelFor: (k: number) => list[k % list.length] };
    const seen: ModelSuccessInfo[] = [];
    const p = callReceptionist(model, PROMPT, { ...OPTS, onSuccess: (i) => seen.push(i) });
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);
    await p;
    expect(seen[0]).toMatchObject({ model: "model-b", earlier: [{ outcome: "attempt_timeout", model: "model-a" }] });
  });
});

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
const OPTS = { timeoutMs: 8000 };
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

  it("times out at exactly 8 s, even when the client ignores the signal", async () => {
    let settled = false;
    const p = callReceptionist(neverResolves, PROMPT, OPTS).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(7999);
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
    await vi.advanceTimersByTimeAsync(8000);
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
    // The two retried 503s before the last one are on record too.
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

  it("retries stay inside the same 8-second deadline", async () => {
    // Each attempt answers 503 after 3 s: attempts at 0 s and 3 s fail, the third is cut at 8 s.
    let calls = 0;
    const slow503: ModelClient = {
      generate: () => {
        calls++;
        return new Promise((_, reject) => setTimeout(() => reject(geminiHighDemandError()), 3000));
      },
    };
    let settled = false;
    const p = callReceptionist(slow503, PROMPT, OPTS).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ ok: false, failure: "timeout" });
    expect(calls).toBe(3);
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
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    vi.useRealTimers();
    // Attempts at 0 s and 2.5 s hit their own deadline; the third keeps the last 3 s of the budget.
    expect(seen[0]).toMatchObject({ failure: "timeout", attempts: 3 });
    expect(seen[0].earlier).toEqual([
      { outcome: "attempt_timeout", latencyMs: ATTEMPT_TIMEOUT_MS },
      { outcome: "attempt_timeout", latencyMs: ATTEMPT_TIMEOUT_MS },
    ]);
    expect(seen[0].latencyMs).toBeGreaterThanOrEqual(8000);
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
    expect(ATTEMPT_TIMEOUT_MS).toBeLessThan(MODEL_TIMEOUT_MS / 2);
    expect(MIN_ATTEMPT_MS).toBeLessThanOrEqual(ATTEMPT_TIMEOUT_MS);
    expect(MAX_MODEL_ATTEMPTS).toBeGreaterThanOrEqual(3);
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
    // Measured 2026-11-12: answers 2.5–3.5 s after the request were common. Aborting the
    // first attempt at its deadline would have thrown them away.
    const signals: AbortSignal[] = [];
    const client = {
      generate: (req: { signal: AbortSignal }) => {
        signals.push(req.signal);
        const k = signals.length;
        return new Promise<string>((resolve) =>
          // Each attempt answers 3 s after it starts: attempt 1 at 3.0 s, attempt 2 (started at 2.5 s) at 5.5 s.
          setTimeout(() => resolve(JSON.stringify({ ...TURN, reply: `attempt ${k}` })), 3000),
        );
      },
    };
    const ok: ModelSuccessInfo[] = [];
    const p = callReceptionist(client, PROMPT, { ...OPTS, onSuccess: (i) => ok.push(i) });
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(3000 - ATTEMPT_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ ok: true, turn: { ...TURN, reply: "attempt 1" } });
    // The second attempt was still running (started at 2.5 s) when the first answered at 3.0 s.
    expect(ok[0]).toMatchObject({ attempts: 2, earlier: [{ outcome: "unfinished", latencyMs: 500 }] });
    // Once the Turn has its answer, every attempt still running is told to stop.
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("two attempts hang: the third, which keeps the rest of the budget, answers at 7.9 s", async () => {
    const slowThird = {
      calls: 0,
      generate() {
        this.calls++;
        if (this.calls < 3) return new Promise<string>(() => {});
        return new Promise<string>((resolve) => setTimeout(() => resolve(JSON.stringify(TURN)), 7900 - 2 * ATTEMPT_TIMEOUT_MS));
      },
    };
    const p = callReceptionist(slowThird, PROMPT, OPTS);
    await vi.advanceTimersByTimeAsync(7900);
    await expect(p).resolves.toEqual({ ok: true, turn: TURN });
    expect(slowThird.calls).toBe(3);
  });

  it("every attempt hangs: timeout at exactly the 8-second budget", async () => {
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

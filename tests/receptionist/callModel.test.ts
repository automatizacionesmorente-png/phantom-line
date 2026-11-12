import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callReceptionist,
  createScriptedModel,
  failsWith503,
  geminiHighDemandError,
  MAX_MODEL_ATTEMPTS,
  neverResolves,
  returnsGarbage,
  throws429,
  throwsNetwork,
  type ModelFailureInfo,
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

  it("a timeout is reported with its latency", async () => {
    vi.useFakeTimers();
    const seen: ModelFailureInfo[] = [];
    const p = callReceptionist(neverResolves, PROMPT, { ...OPTS, onFailure: (i) => seen.push(i) });
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    vi.useRealTimers();
    expect(seen[0]).toMatchObject({ failure: "timeout", attempts: 1 });
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

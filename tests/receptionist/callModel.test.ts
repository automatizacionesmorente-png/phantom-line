import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callReceptionist,
  createScriptedModel,
  neverResolves,
  returnsGarbage,
  throws429,
  throwsNetwork,
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

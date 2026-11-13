import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import type { FallbackLogEvent } from "@/lib/conversation/fallbackLog";
import { messages } from "@/lib/db/schema";
import { createScriptedModel, failsWith503, MAX_MODEL_ATTEMPTS } from "@/lib/receptionist/callModel";
import { phrases, type Said } from "@/lib/receptionist/phrases";
import { toSpokenReply } from "@/lib/receptionist/speech";
import { getSectorPack } from "@/lib/sectors";
import { Caller, makeDeps, makePost, modelTurn, NOW, setupDb } from "./harness";

/**
 * Regression for the first end-to-end test (2026-11-12). The caller said
 * "Quiero cortarme el pelo mañana a las nueve de la noche" and heard the end
 * Fallback_Message, with nothing in the server log. Root cause: Gemini answered
 * that one request with 503 "high demand" (an InternalServerError from the SDK),
 * callReceptionist turned the first 5xx into `unavailable` with no retry, and
 * handleTurn ended the Call without logging why. The fake model below throws
 * exactly that error once, then answers as the real model did.
 */
const pack = getSectorPack("hair-salon");
const ES = phrases("es", pack, lolaProfile, undefined, NOW);
const spoken = (line: Said) => toSpokenReply(line.text, "es", { maxSentences: 3 });
const at = (iso: string) => Temporal.Instant.from(iso);
const WED_2100 = at("2026-11-11T20:00:00Z");
const OFFERED = [at("2026-11-11T18:30:00Z"), at("2026-11-11T18:15:00Z"), at("2026-11-11T18:00:00Z")];
const LINE = "Quiero cortarme el pelo mañana a las nueve de la noche";

/** What gemini-3.5-flash-lite returned for LINE in scripts/check-turn.ts (the harness's "mañana" is Wednesday 11). */
const REAL_TURN = modelTurn({
  reply: "Lo siento, a las nueve de la noche ya estamos cerrados. ¿Te viene bien otro horario?",
  intent: "booking",
  service: "cortarme el pelo",
  date: "2026-11-11",
  time: "21:00",
  reason: "El cliente quiere cortarse el pelo mañana a las 21:00",
});

let t: TestDb;
beforeAll(async () => {
  t = await setupDb();
}, 60_000);
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
});
afterAll(async () => {
  await t.close();
});

function withLog(model: Parameters<typeof makeDeps>[1]) {
  const events: FallbackLogEvent[] = [];
  const deps = { ...makeDeps(t, model), logFallback: (e: FallbackLogEvent) => events.push(e) };
  return { deps, events };
}

describe("Gemini's 503 'high demand' on the first say", () => {
  it("one 503: the caller hears the 21:00 rejection with 19:30 offered, not the fallback", async () => {
    const model = failsWith503(1, createScriptedModel([REAL_TURN]));
    const { deps, events } = withLog(model);
    const c = new Caller(makePost(deps).POST);
    await c.start();
    const r = await c.say(LINE);
    expect(r.status).toBe(200);
    expect(r.body.reply).toBe(spoken(ES.rejected("outside_hours", WED_2100, OFFERED)));
    expect(r.body.reply).toContain("las siete y media");
    expect(r.body.complete).toBe(false);
    expect(model.calls).toBe(2);
    expect(events).toEqual([]);
    expect(await t.handle.db.select().from(messages)).toHaveLength(0);
  });

  it("503 on every attempt: the end fallback, and the cause is logged without personal data", async () => {
    const model = failsWith503(99, createScriptedModel([]));
    const { deps, events } = withLog(model);
    const c = new Caller(makePost(deps).POST);
    await c.start();
    const r = await c.say("Soy Ana Secreta, mi teléfono es 612345678, quiero cortarme el pelo");
    expect(r.body).toMatchObject({ reply: spoken(ES.fallbackEnd()), complete: true, outcome: "fallback" });
    expect(model.calls).toBe(MAX_MODEL_ATTEMPTS);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "turn_fallback",
      path: "end",
      reason: "unavailable",
      shopId: lolaProfile.id,
      callId: c.callId,
      turn: 1,
      model: { failure: "unavailable", status: 503, errorClass: "InternalServerError", attempts: MAX_MODEL_ATTEMPTS },
    });
    const logged = JSON.stringify(events);
    expect(logged).not.toMatch(/Ana|Secreta|612345678|cortarme/);
  });
});

describe("every fallback logs its cause (design.md, 'Logging a fallback')", () => {
  it("invalid output: the retry path logs the zod issues; the second time logs the end path", async () => {
    const bad = JSON.stringify({ ...REAL_TURN, intent: "maybe", name: "Ana Secreta" });
    const { deps, events } = withLog(createScriptedModel([bad, bad]));
    const c = new Caller(makePost(deps).POST);
    await c.start();
    await c.say("Hola");
    await c.say("Hola otra vez");
    expect(events.map((e) => [e.path, e.reason])).toEqual([
      ["retry", "invalid_output"],
      ["end", "invalid_output"],
    ]);
    expect(events[0].model?.invalid).toMatchObject({ kind: "schema", issues: [{ path: "intent", code: "invalid_value" }] });
    expect(JSON.stringify(events)).not.toContain("Ana Secreta");
  });

  it("a rate limit names the limit that was hit, on say and on start", async () => {
    const model = createScriptedModel([REAL_TURN]);
    const events: FallbackLogEvent[] = [];
    const deps = { ...makeDeps(t, model, { perVisitorPerMinute: 2 }), logFallback: (e: FallbackLogEvent) => events.push(e) };
    const { POST } = makePost(deps);
    const c = new Caller(POST);
    await c.start(); // 1
    await c.say(LINE); // 2
    await c.say("Vale"); // 3: over
    await new Caller(POST).start(); // 4: over, on start
    expect(events.map((e) => [e.path, e.reason, e.limit])).toEqual([
      ["end", "rate_limit", "visitor"],
      ["start", "rate_limit", "visitor"],
    ]);
  });

  it("an exception in the Turn: the 503 response logs the error class and SQLSTATE, not the query parameters", async () => {
    const base = makeDeps(t, createScriptedModel([]));
    const events: FallbackLogEvent[] = [];
    // Shaped like a Drizzle query error: the message quotes the query and its params.
    const dbError = Object.assign(new Error("Failed query: insert into calls ... params: Ana Secreta,612345678"), {
      params: ["Ana Secreta", "612345678"],
      cause: Object.assign(new Error('relation "calls" does not exist'), { code: "42P01" }),
    });
    const deps = {
      ...base,
      repo: { ...base.repo, commit: () => Promise.reject(dbError) },
      logFallback: (e: FallbackLogEvent) => events.push(e),
    };
    const res = await makePost(deps).POST(
      new Request("http://localhost/api/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "start", shopId: lolaProfile.id, language: "es" }),
      }),
    );
    expect(res.status).toBe(503);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ path: "http_503", reason: "exception", error: { code: "42P01" } });
    expect(events[0].error?.message).toContain('relation "calls" does not exist');
    expect(JSON.stringify(events)).not.toMatch(/Ana|612345678/);
  });
});

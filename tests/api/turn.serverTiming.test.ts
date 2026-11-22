import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import { serverTiming, SERVER_TIMING_STAGES } from "@/app/api/turn/handler";
import { createScriptedModel, neverResolves } from "@/lib/receptionist/callModel";
import { Caller, makeDeps, makePost, modelTurn, setupDb } from "./harness";
import { notSure } from "../conversation/notSure";

/**
 * front-desk-brain 17.2 (Requirement 19.4): every `say` response of /api/turn carries a
 * `Server-Timing` header with exactly the stages `brain`, `db`, `model` and `total`, numbers only
 * (no words, so nothing the Caller said can leak through it), and `model` is 0 on a Sure_Reading.
 * Through the real route on PGlite.
 */
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

/** `brain;dur=1.2, db;dur=40.5, model;dur=0, total;dur=43.1`, and nothing else. */
const HEADER = /^brain;dur=(\d+(?:\.\d)?), db;dur=(\d+(?:\.\d)?), model;dur=(\d+(?:\.\d)?), total;dur=(\d+(?:\.\d)?)$/;

function parse(headers: Headers): { brain: number; db: number; model: number; total: number } {
  const value = headers.get("server-timing");
  expect(value, "Server-Timing").not.toBeNull();
  const m = HEADER.exec(value!);
  expect(m, value!).not.toBeNull();
  const [brain, db, model, total] = m!.slice(1).map(Number);
  return { brain, db, model, total };
}

describe("Server-Timing on /api/turn (19.4)", () => {
  it("is on every say, holds only the four stages as numbers, and model is 0 on a Sure_Reading", async () => {
    const model = createScriptedModel([modelTurn({ intent: "question", reply: "Claro, pregúntame." })]);
    const { POST, settle } = makePost(makeDeps(t, model));
    const c = new Caller(POST);
    await c.start();
    const lines: { utterance: string; sure: boolean }[] = [
      { utterance: "Quiero cortarme el pelo mañana a las nueve de la noche", sure: true }, // a Service_Request
      { utterance: "¿Y qué tal es Lola cortando?", sure: false }, // a question with no Profile_Topic
      { utterance: "¿Dónde estáis?", sure: true }, // a Profile_Topic
      { utterance: "Ana García", sure: false }, // the name is not the next field yet (an offer waits), and not placed
    ];
    for (const { utterance, sure } of lines) {
      const callsBefore = model.calls.length;
      const r = await c.say(utterance);
      expect(r.status).toBe(200);
      const timing = parse(r.headers);
      for (const v of Object.values(timing)) expect(Number.isFinite(v) && v >= 0).toBe(true);
      expect(timing.total).toBeGreaterThanOrEqual(timing.brain);
      expect(timing.total).toBeGreaterThanOrEqual(timing.model);
      const called = model.calls.length > callsBefore;
      if (sure) {
        expect(called, utterance).toBe(false);
        expect(timing.model, utterance).toBe(0);
      }
      // No word of the utterance or the reply is in the header.
      const header = r.headers.get("server-timing")!;
      for (const w of `${utterance} ${r.body.reply}`.split(/\s+/).filter((x) => /\p{L}{4,}/u.test(x))) expect(header).not.toContain(w);
    }
    expect(model.calls.length).toBeGreaterThan(0); // the not-sure lines did reach the model
    await settle();
  });

  it("a hung model on a Turn that is not sure: model holds the Model_Wait and total covers it", async () => {
    const { POST } = makePost(makeDeps(t, neverResolves, { modelTimeoutMs: 60 }));
    const c = new Caller(POST);
    await c.start();
    const r = await c.say(notSure("Quiero un corte", "es"));
    expect(r.status).toBe(200);
    const timing = parse(r.headers);
    expect(timing.model).toBeGreaterThanOrEqual(59);
    expect(timing.total).toBeGreaterThanOrEqual(timing.model);
    expect(timing.db).toBeGreaterThan(0); // the Call was read and written on PGlite
  });

  it("start and hangup carry it too, with model 0", async () => {
    const { POST } = makePost(makeDeps(t, createScriptedModel([])));
    const c = new Caller(POST);
    const res = await POST(new Request("http://localhost/api/turn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ kind: "start", shopId: lolaProfile.id, language: "es" }),
    }));
    expect(parse(res.headers).model).toBe(0);
    await c.start();
    const h = await POST(new Request("http://localhost/api/turn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ kind: "hangup", shopId: lolaProfile.id, callId: c.callId }),
    }));
    expect(h.status).toBe(200);
    expect(parse(h.headers).model).toBe(0);
  });
});

describe("serverTiming", () => {
  it("names the four stages in order, rounds to 0.1 ms, and never writes a negative, NaN or infinite value", () => {
    expect(SERVER_TIMING_STAGES).toEqual(["brain", "db", "model", "total"]);
    expect(serverTiming({ brain: 1.234, db: 40.46, model: 0, total: 43.149 })).toBe("brain;dur=1.2, db;dur=40.5, model;dur=0, total;dur=43.1");
    expect(serverTiming({ brain: -1, db: Number.NaN, model: Number.POSITIVE_INFINITY, total: 0.04 })).toBe("brain;dur=0, db;dur=0, model;dur=0, total;dur=0");
  });
});

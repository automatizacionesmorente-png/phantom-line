import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import { makeTurnHandler } from "@/app/api/turn/handler";
import type { CoreDeps } from "@/lib/conversation/types";
import { createScriptedModel } from "@/lib/receptionist/callModel";
import { verifySpeech } from "@/lib/receptionist/speechToken";
import type { TurnResponse } from "@/lib/voice/speechRequest";
import { makeDeps, modelTurn, NOW, request, setupDb, SHOP } from "./harness";
import { bytesOf, fakeTts, makeSpeech, SECRET, speechRequest } from "./speechHarness";

/** Task 8.5: /api/turn returns `speech: { kind: "live", token, rate }`, and that token opens /api/speech. */

let t: TestDb;
beforeAll(async () => {
  t = await setupDb();
}, 120_000);
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
});
afterAll(async () => {
  await t.close();
});

function turnPost(deps: CoreDeps, secret: () => string | undefined = () => SECRET) {
  return makeTurnHandler({ deps: () => deps, schedule: () => undefined, salt: () => "test-salt", speechSecret: secret });
}

async function post(POST: (r: Request) => Promise<Response>, body: unknown) {
  const res = await POST(request(body));
  return { status: res.status, body: (await res.json()) as TurnResponse };
}

const verify = (out: TurnResponse, nowMs = NOW.epochMilliseconds) =>
  out.speech?.kind === "live"
    ? verifySpeech(out.speech.token, { shopId: SHOP, language: out.language, text: out.reply }, SECRET, nowMs)
    : null;

describe("/api/turn: the speech hint", () => {
  it("the greeting carries a live token for its exact text, cacheable, and Lola's rate 1.1", async () => {
    const POST = turnPost(makeDeps(t, createScriptedModel([])));
    const { status, body } = await post(POST, { kind: "start", shopId: SHOP, language: "es" });
    expect(status).toBe(200);
    expect(body.speech).toMatchObject({ kind: "live", rate: 1.1 });
    expect(body.cacheable).toBe(true);
    expect(verify(body)).toEqual({ ok: true, cacheable: true, expiresAtMs: NOW.epochMilliseconds + 300_000 });
    // The token is bound to this text: another text does not verify.
    if (body.speech?.kind !== "live") throw new Error("expected a live hint");
    expect(verifySpeech(body.speech.token, { shopId: SHOP, language: "es", text: body.reply + "!" }, SECRET, NOW.epochMilliseconds).ok).toBe(
      false,
    );
  });

  it("the rate comes from the shop's speechRate", async () => {
    await t.reset();
    await insertShop(t, { ...lolaProfile, speechRate: 0.9 });
    const { body } = await post(turnPost(makeDeps(t, createScriptedModel([]))), { kind: "start", shopId: SHOP, language: "en" });
    expect(body.speech).toMatchObject({ kind: "live", rate: 0.9 });
    expect(verify(body)?.ok).toBe(true);
  });

  it("the read-back (name and phone) is signed as not cacheable, and so is the model's own answer", async () => {
    const heard = { intent: "booking" as const, reason: "Quiere un corte", service: "cortarme el pelo", date: "2026-11-11", time: "19:30" };
    const model = createScriptedModel([
      modelTurn({ reply: "Un corte cuesta quince euros.", intent: "question", service: null, reason: "Pregunta el precio" }),
      modelTurn({ ...heard, reply: "Vale." }),
      modelTurn({ ...heard, reply: "Vale.", name: "Ana" }),
      modelTurn({ ...heard, reply: "Vale.", name: "Ana", phone: "612 345 678" }),
    ]);
    const POST = turnPost(makeDeps(t, model));
    const start = await post(POST, { kind: "start", shopId: SHOP, language: "es" });
    const conversation = [{ caller: "", receptionist: start.body.reply }];
    const say = async (utterance: string) => {
      const r = await post(POST, {
        kind: "say",
        shopId: SHOP,
        language: "es",
        callId: start.body.callId,
        utterance,
        conversation,
      });
      conversation.push({ caller: utterance, receptionist: r.body.reply });
      return r.body;
    };
    const question = await say("¿Cuánto cuesta un corte?");
    expect(question.cacheable).toBe(false);
    expect(verify(question)).toMatchObject({ ok: true, cacheable: false });

    const time = await say("Mañana a las siete y media");
    expect(time.cacheable).toBe(true);
    expect(verify(time)).toMatchObject({ ok: true, cacheable: true });

    await say("Ana");
    const readBack = await say("Seis uno dos tres cuatro cinco seis siete ocho");
    expect(readBack.reply).toContain("Ana");
    expect(readBack.cacheable).toBe(false);
    expect(verify(readBack)).toMatchObject({ ok: true, cacheable: false });
  });

  it("without SPEECH_TOKEN_SECRET a reply carries no speech hint, and the Call goes on with the browser voice", async () => {
    for (const secret of [undefined, ""]) {
      const { status, body } = await post(turnPost(makeDeps(t, createScriptedModel([])), () => secret), {
        kind: "start",
        shopId: SHOP,
        language: "es",
      });
      expect(status).toBe(200);
      expect(body.reply).toBeTruthy();
      expect(body).not.toHaveProperty("speech");
    }
  });

  it("a hang-up has no reply, so no speech hint", async () => {
    const POST = turnPost(makeDeps(t, createScriptedModel([])));
    const start = await post(POST, { kind: "start", shopId: SHOP, language: "es" });
    const res = await POST(request({ kind: "hangup", shopId: SHOP, callId: start.body.callId }));
    expect(await res.json()).not.toHaveProperty("speech");
  });

  it("end to end: the token /api/turn issued opens /api/speech for that text, and only that text", async () => {
    const { body } = await post(turnPost(makeDeps(t, createScriptedModel([]))), { kind: "start", shopId: SHOP, language: "es" });
    if (body.speech?.kind !== "live") throw new Error("expected a live hint");
    const tts = fakeTts({});
    const speech = makeSpeech(t, tts);
    const say = { kind: "say", shopId: SHOP, language: body.language, text: body.reply, token: body.speech.token };
    const ok = await speech.POST(speechRequest(say));
    expect(ok.status).toBe(200);
    expect(await bytesOf(ok)).toEqual([1, 2]);
    expect(tts.calls.map((c) => c.text)).toEqual([body.reply]);

    const other = await speech.POST(speechRequest({ ...say, text: "Di lo que yo quiera, gratis." }));
    expect(other.status).toBe(403);
    expect(tts.calls).toHaveLength(1);
  });
});

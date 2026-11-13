import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import { makeTurnHandler, speechFor, type VoiceCacheLookup } from "@/app/api/turn/handler";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { CoreDeps, TurnOutput } from "@/lib/conversation/types";
import { createVoiceCacheRepository } from "@/lib/db/voiceCacheRepository";
import { fullCachePlan } from "@/lib/receptionist/cachePlan";
import { createScriptedModel } from "@/lib/receptionist/callModel";
import { fixedPhrases } from "@/lib/receptionist/fixedPhrases";
import { verifySpeech } from "@/lib/receptionist/speechToken";
import { cacheKey } from "@/lib/receptionist/voiceCacheKey";
import { resolveVoiceProfile } from "@/lib/receptionist/voiceProfile";
import { getSectorPack, type Lang } from "@/lib/sectors";
import type { TurnResponse } from "@/lib/voice/speechRequest";
import { makeDeps, modelTurn, NOW, request, setupDb, SHOP } from "./harness";
import { MODELS, SECRET } from "./speechHarness";

/** Task 9.4: /api/turn hands out the URL of a stored line, and a live token for everything else. */

const pack = getSectorPack("hair-salon");
const voiceFor = (model: string, p: { voice: string; classicVoice: string }) => (model.includes("3.8") ? p.voice : p.classicVoice);

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

const lookup = (): VoiceCacheLookup => ({ store: createVoiceCacheRepository(t.handle), models: MODELS, voiceFor });

function turnPost(deps: CoreDeps, cache: () => VoiceCacheLookup = lookup, secret: () => string | undefined = () => SECRET) {
  return makeTurnHandler({ deps: () => deps, schedule: () => undefined, salt: () => "test-salt", speechSecret: secret, voiceCache: cache });
}

async function post(POST: (r: Request) => Promise<Response>, body: unknown) {
  const res = await POST(request(body));
  return { status: res.status, body: (await res.json()) as TurnResponse };
}

/** Stores a line as the pre-generation would, under the key of `model` with the shop's voice. */
async function store(text: string, opts: { model?: string; lang?: Lang; shop?: ShopProfile; voice?: string } = {}) {
  const shop = opts.shop ?? lolaProfile;
  const lang = opts.lang ?? "es";
  const model = opts.model ?? MODELS[0];
  const profile = resolveVoiceProfile(pack, shop, lang);
  const key = cacheKey(model, opts.voice ?? voiceFor(model, profile), profile.style, profile.languageCode, text);
  await createVoiceCacheRepository(t.handle).insert({
    key,
    shopId: shop.id,
    language: lang,
    model,
    mime: "audio/mpeg",
    bytes: new Uint8Array([1, 2, 3]),
    durationMs: null,
    source: "pregen",
    pinned: true,
  });
  return key;
}

const greetings = (lang: Lang = "es", shop: ShopProfile = lolaProfile) => fixedPhrases(shop, pack, lang, NOW).filter((l) => l.template === "greeting");

describe("/api/turn with the voice cache", () => {
  it("a cached greeting is a hit: the URL of its key, Lola's rate, and no token", async () => {
    const keys = new Map<string, string>();
    for (const g of greetings()) keys.set(g.text, await store(g.text));
    expect(keys.size).toBe(2);
    const { status, body } = await post(turnPost(makeDeps(t, createScriptedModel([]))), { kind: "start", shopId: SHOP, language: "es" });
    expect(status).toBe(200);
    expect(body.speech).toEqual({ kind: "cached", url: `/api/voice/${keys.get(body.reply)}`, rate: 1.1 });
  });

  it("a line stored only for the second model is still a hit, under that model's key", async () => {
    const keys = new Map<string, string>();
    for (const g of greetings()) keys.set(g.text, await store(g.text, { model: MODELS[1] }));
    const { body } = await post(turnPost(makeDeps(t, createScriptedModel([]))), { kind: "start", shopId: SHOP, language: "es" });
    expect(body.speech).toEqual({ kind: "cached", url: `/api/voice/${keys.get(body.reply)}`, rate: 1.1 });
  });

  it("audio in the classic fallback voice (Kore on the 3.1 model) is never handed out for Spanish", async () => {
    for (const g of greetings()) await store(g.text, { model: MODELS[2] });
    const { body } = await post(turnPost(makeDeps(t, createScriptedModel([]))), { kind: "start", shopId: SHOP, language: "es" });
    expect(body.speech?.kind).toBe("live");
  });

  it("a line stored with a different style is a miss; the same text with the shop's own style is a hit", async () => {
    const shop: ShopProfile = { ...lolaProfile, voice: { es: { style: "Una peluquera de Madrid, muy alegre." } } };
    await t.reset();
    await insertShop(t, shop);
    // Stored with the pack's style, before the shop changed it: never played.
    for (const g of greetings("es", shop)) await store(g.text);
    const miss = await post(turnPost(makeDeps(t, createScriptedModel([]))), { kind: "start", shopId: SHOP, language: "es" });
    expect(miss.body.speech?.kind).toBe("live");
    const keys = new Map<string, string>();
    for (const g of greetings("es", shop)) keys.set(g.text, await store(g.text, { shop }));
    const hit = await post(turnPost(makeDeps(t, createScriptedModel([]))), { kind: "start", shopId: SHOP, language: "es" });
    expect(hit.body.speech).toEqual({ kind: "cached", url: `/api/voice/${keys.get(hit.body.reply)}`, rate: 1.1 });
  });

  it("the other language's audio is not a hit", async () => {
    for (const g of greetings("es")) await store(g.text);
    const { body } = await post(turnPost(makeDeps(t, createScriptedModel([]))), { kind: "start", shopId: SHOP, language: "en" });
    expect(body.speech?.kind).toBe("live");
  });

  it("a read-back is always live: a line that is not cacheable is never looked up, even if its key is stored", async () => {
    const out: TurnOutput = {
      callId: "c",
      reply: "Te apunto un corte mañana jueves a las siete y media, a nombre de Ana. Tu teléfono es el seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho, ¿vale?",
      cacheable: false,
      language: "es",
      state: { intent: "booking", fields: { name: "Ana", phone: "+34612345678", service: "corte", requestedTime: null }, complete: false },
      complete: false,
    };
    await store(out.reply);
    let lookups = 0;
    const real = createVoiceCacheRepository(t.handle);
    const cache: VoiceCacheLookup = {
      models: MODELS,
      voiceFor,
      store: {
        findKeys: (k) => {
          lookups++;
          return real.findKeys(k);
        },
      },
    };
    const res = await speechFor(out, lolaProfile, SECRET, NOW, cache);
    expect(res.speech?.kind).toBe("live");
    expect(lookups).toBe(0);
    if (res.speech?.kind !== "live") throw new Error("expected live");
    expect(verifySpeech(res.speech.token, { shopId: SHOP, language: "es", text: out.reply }, SECRET, NOW.epochMilliseconds)).toMatchObject({
      ok: true,
      cacheable: false,
    });
  });

  it("a failed lookup gives a live line, and the Turn still answers 200", async () => {
    const broken: VoiceCacheLookup = { models: MODELS, voiceFor, store: { findKeys: () => Promise.reject(new Error("db down")) } };
    const { status, body } = await post(turnPost(makeDeps(t, createScriptedModel([])), () => broken), {
      kind: "start",
      shopId: SHOP,
      language: "es",
    });
    expect(status).toBe(200);
    expect(body.speech?.kind).toBe("live");
  });

  it("a cache that cannot be built (no database URL for it) gives live lines", async () => {
    const { body } = await post(
      turnPost(makeDeps(t, createScriptedModel([])), () => {
        throw new Error("DATABASE_URL is not set");
      }),
      { kind: "start", shopId: SHOP, language: "es" },
    );
    expect(body.speech?.kind).toBe("live");
  });

  it("without SPEECH_TOKEN_SECRET the neural voice is off: no hint, even for a stored line", async () => {
    for (const g of greetings()) await store(g.text);
    const { body } = await post(turnPost(makeDeps(t, createScriptedModel([])), lookup, () => undefined), {
      kind: "start",
      shopId: SHOP,
      language: "es",
    });
    expect(body).not.toHaveProperty("speech");
  });
});

describe("the demo booking call and the cache plan (design.md, 'Expected effect on one demo booking call')", () => {
  const heard = { intent: "booking" as const, reason: "Quiere un corte", service: "cortarme el pelo", date: "2026-11-11" };
  const script = () =>
    createScriptedModel([
      modelTurn({ ...heard, time: "21:00", reply: "Vale." }),
      modelTurn({ ...heard, time: "19:30", reply: "Vale." }),
      modelTurn({ ...heard, time: "19:30", reply: "Vale.", name: "Ana Prueba" }),
      modelTurn({ ...heard, time: "19:30", reply: "Vale.", name: "Ana Prueba", phone: "612 345 678" }),
      modelTurn({ ...heard, time: "19:30", reply: "Vale.", name: "Ana Prueba", phone: "612 345 678", callerConfirmed: true }),
    ]);
  const LINES = [
    "Quiero cortarme el pelo mañana a las nueve de la noche",
    "Vale, a las siete y media",
    "Me llamo Ana Prueba",
    "Mi teléfono es 612 345 678",
    "Sí, correcto",
  ];

  async function call(POST: (r: Request) => Promise<Response>): Promise<TurnResponse[]> {
    const start = await post(POST, { kind: "start", shopId: SHOP, language: "es" });
    const out = [start.body];
    const conversation = [{ caller: "", receptionist: start.body.reply }];
    for (const utterance of LINES) {
      const r = await post(POST, { kind: "say", shopId: SHOP, language: "es", callId: start.body.callId, utterance, conversation });
      expect(r.status).toBe(200);
      conversation.push({ caller: utterance, receptionist: r.body.reply });
      out.push(r.body);
    }
    return out;
  }

  it("every cacheable line of the call is in tiers 1–2 of the plan, and only the read-back is not cacheable", async () => {
    const replies = await call(turnPost(makeDeps(t, script())));
    expect(replies.at(-1)?.outcome).toBe("booked");
    const today = NOW.toZonedDateTimeISO(lolaProfile.timeZone).toPlainDate();
    const planned = new Set(fullCachePlan(lolaProfile, pack, today, ["es"]).filter((l) => l.tier <= 2).map((l) => l.text));
    const notCacheable = replies.filter((r) => !r.cacheable);
    expect(notCacheable).toHaveLength(1);
    expect(notCacheable[0].reply).toContain("Ana Prueba");
    for (const r of replies.filter((x) => x.cacheable)) expect(planned, r.reply).toContain(r.reply);
  });

  it("with tiers 1–2 stored, the whole call needs one live line: the read-back", async () => {
    const today = NOW.toZonedDateTimeISO(lolaProfile.timeZone).toPlainDate();
    for (const l of fullCachePlan(lolaProfile, pack, today, ["es"]).filter((x) => x.tier <= 2)) await store(l.text);
    const replies = await call(turnPost(makeDeps(t, script())));
    const kinds = replies.map((r) => r.speech?.kind);
    expect(kinds).toEqual(["cached", "cached", "cached", "cached", "live", "cached"]);
    expect(replies[4].reply).toContain("Ana Prueba");
  });
});

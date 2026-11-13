import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import { voiceCache } from "@/lib/db/schema";
import { createVoiceCacheRepository } from "@/lib/db/voiceCacheRepository";
import { cacheKey } from "@/lib/receptionist/voiceCacheKey";
import { wavFromPcm, type CacheWriteFailedEvent, type VoiceCacheStore } from "@/lib/receptionist/voiceCacheBudget";
import { setupDb } from "./harness";
import { apiError, bytesOf, fakeTts, makeSpeech, MODELS, sayBody, speechRequest } from "./speechHarness";

/** Task 9.6: /api/speech stores a clean, cacheable, primary-voice stream after the response, and only then. */

const GREETING = "¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual. ¿En qué te puedo ayudar?";
const STYLE = "Una peluquera simpática de Madrid, relajada, a ritmo natural y sonriendo.";
const keyFor = (model: string, text = GREETING, voice = "es-es-commercial-3") => cacheKey(model, voice, STYLE, "es-ES", text);

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

const rows = () => t.handle.db.select().from(voiceCache);

function withCache(tts: ReturnType<typeof fakeTts>, over: Parameters<typeof makeSpeech>[2] = {}) {
  const writes: CacheWriteFailedEvent[] = [];
  const setup = makeSpeech(t, tts, {
    voiceCache: createVoiceCacheRepository(t.handle),
    logCacheWrite: (e) => writes.push(e),
    ...over,
  });
  return { ...setup, writes };
}

describe("/api/speech and the voice cache", () => {
  it("a clean cacheable stream is stored once, as WAV, under the key of the model and voice that spoke it", async () => {
    const tts = fakeTts({ [MODELS[0]]: { kind: "chunks", chunks: [[1, 2, 3, 4], [5, 6]] } });
    const { POST, settle } = withCache(tts);
    const res = await POST(speechRequest(sayBody(GREETING)));
    expect(res.status).toBe(200);
    expect(await bytesOf(res)).toEqual([1, 2, 3, 4, 5, 6]);
    await settle();
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      key: keyFor(MODELS[0]),
      shopId: lolaProfile.id,
      language: "es",
      model: MODELS[0],
      mime: "audio/wav",
      sizeBytes: 50,
      durationMs: 0,
      source: "live",
      pinned: false,
    });
    expect([...stored[0].bytes]).toEqual([...wavFromPcm(new Uint8Array([1, 2, 3, 4, 5, 6]), 24000)]);

    // The same line again: still one row, with the first audio.
    const tts2 = fakeTts({ [MODELS[0]]: { kind: "chunks", chunks: [[9, 9]] } });
    const again = withCache(tts2);
    await bytesOf(await again.POST(speechRequest(sayBody(GREETING))));
    await again.settle();
    const after = await rows();
    expect(after).toHaveLength(1);
    expect([...after[0].bytes]).toEqual([...stored[0].bytes]);
  });

  it("a line on the second model (the first answered 429) is stored under the second model's key", async () => {
    const tts = fakeTts({ [MODELS[0]]: { kind: "throw", error: apiError(429, "quota") } });
    const { POST, settle } = withCache(tts);
    await bytesOf(await POST(speechRequest(sayBody(GREETING))));
    await settle();
    expect((await rows()).map((r) => r.key)).toEqual([keyFor(MODELS[1])]);
  });

  it("a line whose token says not cacheable (a read-back, the model's own words) is never stored", async () => {
    const { POST, settle } = withCache(fakeTts({}));
    const res = await POST(speechRequest(sayBody("Te apunto un corte a nombre de Ana.", { cacheable: false })));
    expect(await bytesOf(res)).toEqual([1, 2]);
    await settle();
    expect(await rows()).toEqual([]);
  });

  it("a stream the browser aborts is never stored", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tts = fakeTts({});
    tts.stream = async function* () {
      yield { pcm: new Uint8Array([9, 9]), sampleRate: 24000 };
      await gate;
      yield { pcm: new Uint8Array([8, 8]), sampleRate: 24000 };
    };
    const { POST, settle } = withCache(tts);
    const res = await POST(speechRequest(sayBody(GREETING)));
    const reader = res.body!.getReader();
    expect([...((await reader.read()).value ?? [])]).toEqual([9, 9]);
    await reader.cancel();
    release();
    await settle();
    expect(await rows()).toEqual([]);
  });

  it("a stream cut by a model error after the first chunk is never stored", async () => {
    const tts = fakeTts({ [MODELS[0]]: { kind: "chunksThenThrow", chunks: [[1, 1], [2, 2]], error: apiError(500, "internal") } });
    const { POST, settle } = withCache(tts);
    await bytesOf(await POST(speechRequest(sayBody(GREETING))));
    await settle();
    expect(await rows()).toEqual([]);
  });

  it("audio in the classic fallback voice (Kore, after both 3.8 models answered 429) is never stored", async () => {
    const tts = fakeTts({
      [MODELS[0]]: { kind: "throw", error: apiError(429, "quota") },
      [MODELS[1]]: { kind: "throw", error: apiError(429, "quota") },
    });
    const { POST, settle } = withCache(tts);
    const res = await POST(speechRequest(sayBody(GREETING)));
    expect(res.status).toBe(200);
    expect(tts.calls.at(-1)).toMatchObject({ model: MODELS[2], voice: "Kore" });
    await bytesOf(res);
    await settle();
    expect(await rows()).toEqual([]);
  });

  it("a failed write logs one voice_cache_write_failed line with the key and the error class only", async () => {
    const failing: Pick<VoiceCacheStore, "insert" | "evict"> = {
      insert: () => Promise.reject(Object.assign(new TypeError(`insert failed for ${GREETING} \\x0102`), { params: [GREETING] })),
      evict: () => Promise.resolve([]),
    };
    const { POST, settle, writes, logs } = withCache(fakeTts({}), { voiceCache: failing });
    const res = await POST(speechRequest(sayBody(GREETING)));
    expect(await bytesOf(res)).toEqual([1, 2]);
    await settle();
    expect(writes).toEqual([{ event: "voice_cache_write_failed", key: keyFor(MODELS[0]), errorClass: "TypeError" }]);
    expect(JSON.stringify(writes)).not.toContain("Lola");
    expect(logs).toEqual([]);
  });

  it("after a write, the cache is evicted down to VOICE_CACHE_MAX_BYTES: the least recently used unpinned rows go", async () => {
    const repo = createVoiceCacheRepository(t.handle);
    const old = "f".repeat(32);
    await repo.insert({
      key: old,
      shopId: lolaProfile.id,
      language: "es",
      model: MODELS[0],
      mime: "audio/wav",
      bytes: new Uint8Array(100),
      durationMs: null,
      source: "live",
      pinned: false,
    });
    await t.handle.db.update(voiceCache).set({ lastUsedAt: new Date("2026-01-01T00:00:00Z") }).where(eq(voiceCache.key, old));
    const { POST, settle } = withCache(fakeTts({}), { cacheMaxBytes: 120 });
    await bytesOf(await POST(speechRequest(sayBody(GREETING))));
    await settle();
    expect((await rows()).map((r) => r.key)).toEqual([keyFor(MODELS[0])]);
  });

  it("without a voice cache configured, nothing is scheduled and the route behaves as before", async () => {
    const { POST, settle } = makeSpeech(t, fakeTts({}));
    expect(await bytesOf(await POST(speechRequest(sayBody(GREETING))))).toEqual([1, 2]);
    await settle();
    expect(await rows()).toEqual([]);
  });
});

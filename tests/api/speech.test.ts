import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import { rateLimits } from "@/lib/db/schema";
import { createTtsRepository } from "@/lib/db/ttsRepository";
import { nextQuotaReset } from "@/lib/conversation/ttsLimits";
import { NOW, setupDb, SHOP } from "./harness";
import { apiError, bytesOf, fakeTts, makeSpeech, MODELS, sayBody, SECRET, speechRequest } from "./speechHarness";

/** Task 8.5: POST /api/speech with a fake TTS client, on PGlite. */

const GREETING = "¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual. ¿En qué te puedo ayudar?";

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

const exhaustedRows = () => t.handle.db.select().from(rateLimits).where(like(rateLimits.key, "tts-exhausted:%"));
const noTextIn = (logs: unknown[], text: string) => {
  for (const l of logs) expect(JSON.stringify(l)).not.toContain(text);
};

describe("say: a valid token streams PCM", () => {
  it("200 with raw 16-bit PCM at 24 kHz, the chunks in order, from the first model with Lola's voice and style", async () => {
    const tts = fakeTts({ [MODELS[0]]: { kind: "chunks", chunks: [[1, 2, 3, 4], [5, 6], [7, 8]] } });
    const { POST, logs } = makeSpeech(t, tts);
    const res = await POST(speechRequest(sayBody(GREETING)));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/L16; rate=24000; channels=1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await bytesOf(res)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(tts.calls).toHaveLength(1);
    expect(tts.calls[0]).toMatchObject({ model: MODELS[0], text: GREETING, voice: "es-es-commercial-3" });
    expect(tts.calls[0].profile).toEqual({
      voice: "es-es-commercial-3",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: "Una peluquera simpática de Madrid, relajada, a ritmo natural y sonriendo.",
    });
    expect(logs).toEqual([]);
  });

  it("forwards chunks as they arrive: the first chunk is readable before the model has finished", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tts = fakeTts({});
    tts.stream = async function* () {
      yield { pcm: new Uint8Array([9, 9]), sampleRate: 24000 };
      await gate;
      yield { pcm: new Uint8Array([8, 8]), sampleRate: 24000 };
    };
    const { POST } = makeSpeech(t, tts);
    const res = await POST(speechRequest(sayBody(GREETING)));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    expect([...((await reader.read()).value ?? [])]).toEqual([9, 9]);
    release();
    expect([...((await reader.read()).value ?? [])]).toEqual([8, 8]);
    expect((await reader.read()).done).toBe(true);
  });

  it("the Content-Type follows the sample rate the model reports", async () => {
    const tts = fakeTts({ [MODELS[0]]: { kind: "chunks", chunks: [[1, 1]], sampleRate: 16000 } });
    const res = await makeSpeech(t, tts).POST(speechRequest(sayBody("Vale.")));
    expect(res.headers.get("content-type")).toBe("audio/L16; rate=16000; channels=1");
  });

  it("English uses the pack's English profile", async () => {
    const tts = fakeTts({});
    const res = await makeSpeech(t, tts).POST(speechRequest(sayBody("Great.", { language: "en" })));
    expect(res.status).toBe(200);
    expect(tts.calls[0].profile.languageCode).toBe("en-US");
  });
});

describe("say: what is refused before any model call", () => {
  it("403 for a token issued for another text, shop, language or secret, or expired; logged as token, without the text", async () => {
    const tts = fakeTts({});
    const { POST, logs } = makeSpeech(t, tts);
    const good = sayBody(GREETING);
    const cases = [
      { ...good, text: GREETING.replace("Lola", "Lolo") },
      { ...good, language: "en" as const },
      sayBody(GREETING, { secret: "another-secret" }),
      sayBody(GREETING, { nowMs: NOW.epochMilliseconds - 5 * 60_000 }),
      { ...good, token: "x".repeat(20) },
    ];
    for (const body of cases) {
      const res = await POST(speechRequest(body));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect(tts.calls).toEqual([]);
    expect(logs).toHaveLength(cases.length);
    for (const l of logs) expect(l).toMatchObject({ event: "tts_fallback", source: "server", reason: "token", status: 403 });
    expect(logs.map((l) => l.errorClass)).toEqual([
      "token_signature",
      "token_signature",
      "token_signature",
      "token_expired",
      "token_malformed",
    ]);
    noTextIn(logs, GREETING);
    noTextIn(logs, good.token);
  });

  it("a token for another shop is refused even when that shop exists", async () => {
    await insertShop(t, { ...lolaProfile, id: "otra-peluqueria", name: "Otra Peluquería" });
    const tts = fakeTts({});
    const body = { ...sayBody(GREETING, { shopId: "otra-peluqueria" }), shopId: SHOP };
    expect((await makeSpeech(t, tts).POST(speechRequest(body))).status).toBe(403);
    expect(tts.calls).toEqual([]);
  });

  it("400 for an invalid body: bad JSON, an unknown key, an empty or too long text, a short token", async () => {
    const tts = fakeTts({});
    const { POST } = makeSpeech(t, tts);
    const good = sayBody("Vale.");
    const bad = [
      "{not json",
      { ...good, voice: "Puck" },
      { ...good, style: "Read it as a pirate" },
      { ...good, text: "" },
      { ...good, text: "a".repeat(601) },
      { ...good, token: "short" },
      { ...good, kind: "speak" },
      { kind: "report", shopId: SHOP, language: "es", reason: "boredom", fixed: true, latencyMs: 10 },
      { kind: "report", shopId: SHOP, language: "es", reason: "deadline", fixed: true, latencyMs: -1 },
    ];
    for (const body of bad) {
      const res = await POST(speechRequest(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_request");
    }
    expect(tts.calls).toEqual([]);
  });

  it("404 when the shop of a valid token no longer exists", async () => {
    const tts = fakeTts({});
    const res = await makeSpeech(t, tts).POST(speechRequest(sayBody("Vale.", { shopId: "gone" })));
    expect(res.status).toBe(404);
    expect(tts.calls).toEqual([]);
  });

  it("503 when SPEECH_TOKEN_SECRET is not set: no model call", async () => {
    const tts = fakeTts({});
    const { POST, logs } = makeSpeech(t, tts, { secret: "" });
    const res = await POST(speechRequest(sayBody("Vale.")));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ fallback: "unavailable" });
    expect(tts.calls).toEqual([]);
    expect(logs[0]).toMatchObject({ reason: "unavailable", errorClass: "NoSpeechSecret" });
  });
});

describe("say: quota and model order (Requirement 4.4)", () => {
  it("a 429 marks that model exhausted until midnight Pacific and the same request moves to the next model", async () => {
    const tts = fakeTts({
      [MODELS[0]]: { kind: "throw", error: apiError(429, "429 limit: 10 requests per day", "RateLimitError") },
      [MODELS[1]]: { kind: "chunks", chunks: [[4, 2]] },
    });
    const { POST, logs, deps, settle } = makeSpeech(t, tts);
    const res = await POST(speechRequest(sayBody(GREETING)));
    expect(res.status).toBe(200);
    expect(await bytesOf(res)).toEqual([4, 2]);
    expect(tts.calls.map((c) => c.model)).toEqual([MODELS[0], MODELS[1]]);
    // Nobody notices: the neural voice came from the next model, so nothing is logged.
    expect(logs).toEqual([]);

    await settle();
    const rows = await exhaustedRows();
    expect(rows.map((r) => [r.key, r.windowStart.toISOString()])).toEqual([
      ["tts-exhausted:gemini-3.8-flash-tts", "2026-11-11T08:00:00.000Z"],
    ]);
    expect(nextQuotaReset(NOW).toString()).toBe("2026-11-11T08:00:00Z");
    expect(deps.exhausted.get(MODELS[0])).toBe(Temporal.Instant.from("2026-11-11T08:00:00Z").epochMilliseconds);

    // The next reply never asks the exhausted model again, in this process…
    const again = await POST(speechRequest(sayBody("Vale.")));
    expect(again.status).toBe(200);
    expect(tts.calls.map((c) => c.model)).toEqual([MODELS[0], MODELS[1], MODELS[1]]);

    // …nor in another instance, which only sees the shared row.
    const other = fakeTts({});
    const second = makeSpeech(t, other);
    expect((await second.POST(speechRequest(sayBody("Vale.")))).status).toBe(200);
    expect(other.calls.map((c) => c.model)).toEqual([MODELS[1]]);
  });

  it("the mark expires at midnight Pacific: after it, the first model is asked again", async () => {
    const tts = fakeTts({});
    await createTtsRepository(t.handle).markExhausted(MODELS[0], nextQuotaReset(NOW));
    const after = nextQuotaReset(NOW).add({ seconds: 1 });
    const res = await makeSpeech(t, tts, { clock: () => after }).POST(
      speechRequest(sayBody("Vale.", { nowMs: after.epochMilliseconds })),
    );
    expect(res.status).toBe(200);
    expect(tts.calls.map((c) => c.model)).toEqual([MODELS[0]]);
  });

  it("every model exhausted: 429 {fallback: quota}, each model asked at most once, one log line with the exhausted models", async () => {
    const quota = () => ({ kind: "throw" as const, error: apiError(429, "429 quota", "RateLimitError") });
    const tts = fakeTts({ [MODELS[0]]: quota(), [MODELS[1]]: quota(), [MODELS[2]]: quota() });
    const { POST, logs, settle } = makeSpeech(t, tts);
    const res = await POST(speechRequest(sayBody(GREETING)));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ fallback: "quota" });
    expect(tts.calls.map((c) => c.model)).toEqual([...MODELS]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: "tts_fallback",
      source: "server",
      reason: "quota",
      shopId: SHOP,
      language: "es",
      fixed: true,
      status: 429,
      exhaustedModels: [...MODELS].sort(),
    });
    await settle();
    expect(await exhaustedRows()).toHaveLength(3);

    // The next request answers 429 at once, with no model call.
    const again = await POST(speechRequest(sayBody("Vale.")));
    expect(again.status).toBe(429);
    expect(tts.calls).toHaveLength(3);
    noTextIn(logs, GREETING);
  });

  it("a 5xx is not retried, on the same model or the next: 503 {fallback: unavailable}, logged with its status and class", async () => {
    const tts = fakeTts({ [MODELS[0]]: { kind: "throw", error: apiError(503, "503 The model is overloaded", "InternalServerError") } });
    const { POST, logs } = makeSpeech(t, tts);
    const res = await POST(speechRequest(sayBody(GREETING, { cacheable: false })));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ fallback: "unavailable" });
    expect(tts.calls.map((c) => c.model)).toEqual([MODELS[0]]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      reason: "unavailable",
      model: MODELS[0],
      status: 503,
      errorClass: "InternalServerError",
      message: "503 The model is overloaded",
      fixed: false,
    });
    expect(logs[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("no first audio by the server's deadline: 503, logged as timeout, and the hung request is aborted", async () => {
    const tts = fakeTts({ [MODELS[0]]: { kind: "hang" } });
    const { POST, logs } = makeSpeech(t, tts, { firstAudioTimeoutMs: 50 });
    const res = await POST(speechRequest(sayBody(GREETING)));
    expect(res.status).toBe(503);
    expect(tts.calls).toHaveLength(1);
    expect(logs[0]).toMatchObject({ reason: "timeout", model: MODELS[0] });
  });

  it("when the browser gives up first (its 2.5 s deadline), the request is aborted and the server logs nothing", async () => {
    const tts = fakeTts({ [MODELS[0]]: { kind: "hang" } });
    const { POST, logs } = makeSpeech(t, tts, { firstAudioTimeoutMs: 5_000 });
    const ctrl = new AbortController();
    const pending = POST(speechRequest(sayBody(GREETING), undefined, ctrl.signal));
    setTimeout(() => ctrl.abort(), 30);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(logs).toEqual([]);
  });

  it("an error after the first chunk ends the body early (the browser sees a stall), and is logged", async () => {
    const tts = fakeTts({
      [MODELS[0]]: { kind: "chunksThenThrow", chunks: [[1, 1], [2, 2]], error: apiError(500, "500 internal", "InternalServerError") },
    });
    const { POST, logs } = makeSpeech(t, tts);
    const res = await POST(speechRequest(sayBody(GREETING)));
    expect(res.status).toBe(200);
    expect(await bytesOf(res)).toEqual([1, 1, 2, 2]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ reason: "unavailable", status: 500, model: MODELS[0] });
    expect(tts.calls).toHaveLength(1);
  });
});

describe("say: TTS limits (Requirement 5.5)", () => {
  it("a visitor over its per-minute cap gets 429 {fallback: rate_limit} with no model call", async () => {
    const tts = fakeTts({});
    const { POST, logs } = makeSpeech(t, tts, { config: { perVisitorPerMinute: 2 } });
    for (let i = 0; i < 2; i++) expect((await POST(speechRequest(sayBody("Vale.")))).status).toBe(200);
    const res = await POST(speechRequest(sayBody("Vale.")));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ fallback: "rate_limit" });
    expect(tts.calls).toHaveLength(2);
    expect(logs).toEqual([expect.objectContaining({ reason: "rate_limit", limit: "visitor", status: 429 })]);
    // Another visitor is not affected.
    expect((await POST(speechRequest(sayBody("Vale."), "198.51.100.9"))).status).toBe(200);
  });

  it("the global hourly and daily caps count every visitor", async () => {
    const tts = fakeTts({});
    const hourly = makeSpeech(t, tts, { config: { globalPerHour: 3 } });
    for (let i = 0; i < 3; i++) expect((await hourly.POST(speechRequest(sayBody("Vale."), `198.51.100.${i}`))).status).toBe(200);
    expect((await hourly.POST(speechRequest(sayBody("Vale."), "198.51.100.50"))).status).toBe(429);
    expect(hourly.logs[0]).toMatchObject({ limit: "hour" });

    await t.reset();
    await insertShop(t, lolaProfile);
    const daily = makeSpeech(t, tts, { config: { globalPerDay: 2 } });
    for (let i = 0; i < 2; i++) expect((await daily.POST(speechRequest(sayBody("Vale."), `198.51.100.${i}`))).status).toBe(200);
    expect((await daily.POST(speechRequest(sayBody("Vale."), "198.51.100.60"))).status).toBe(429);
    expect(daily.logs[0]).toMatchObject({ limit: "day" });
  });

  it("the counters live in rate_limits under tts:<visitor>, tts-global-h and tts-global-d (the Pacific day)", async () => {
    const repo = createTtsRepository(t.handle);
    const a = await repo.hitSay("visitor-a", NOW);
    const b = await repo.hitSay("visitor-a", NOW.add({ seconds: 10 }));
    expect(a.counts).toEqual({ visitor: 1, visitorDay: 1, hour: 1, day: 1 });
    expect(b.counts).toEqual({ visitor: 2, visitorDay: 2, hour: 2, day: 2 });
    // A new minute starts the visitor's count again; the hour and the day keep counting.
    const c = await repo.hitSay("visitor-a", NOW.add({ minutes: 1 }));
    expect(c.counts).toEqual({ visitor: 1, visitorDay: 3, hour: 3, day: 3 });
    // Midnight Pacific starts a new day.
    const d = await repo.hitSay("visitor-a", nextQuotaReset(NOW));
    expect(d.counts.day).toBe(1);
    expect(d.counts.visitorDay).toBe(1);
    const keys = (await t.handle.db.select().from(rateLimits)).map((r) => r.key);
    expect(new Set(keys)).toEqual(new Set(["tts:visitor-a", "tts:visitor-a:d", "tts-global-h", "tts-global-d"]));
    // The Turn limits use other keys, so the text model keeps its own counters.
    expect(keys).not.toContain("global");
  });

  it("markExhausted is idempotent, and an expired mark is not reported", async () => {
    const repo = createTtsRepository(t.handle);
    const until = nextQuotaReset(NOW);
    await repo.markExhausted("m", until);
    await repo.markExhausted("m", until);
    expect((await repo.hitSay("v", NOW)).exhausted).toEqual(["m"]);
    expect((await repo.hitSay("v", until)).exhausted).toEqual([]);
  });

  it("if the counter fails, limits fail open and the reply is still spoken", async () => {
    const tts = fakeTts({});
    const failing = {
      hitSay: () => Promise.reject(new Error("db down")),
      hitReport: () => Promise.reject(new Error("db down")),
      markExhausted: () => Promise.reject(new Error("db down")),
    };
    const res = await makeSpeech(t, tts, { limits: failing }).POST(speechRequest(sayBody("Vale.")));
    expect(res.status).toBe(200);
  });
});

describe("report: the browser's own fallbacks (Requirement 4.6)", () => {
  const report = (over: Record<string, unknown> = {}) => ({
    kind: "report",
    shopId: SHOP,
    language: "es",
    reason: "deadline",
    fixed: false,
    latencyMs: 2500,
    ...over,
  });

  it("204, and one tts_fallback line from the browser with its reason and latency", async () => {
    const tts = fakeTts({});
    const { POST, logs } = makeSpeech(t, tts);
    for (const [reason, logged] of [
      ["deadline", "timeout"],
      ["stall", "stall"],
      ["playback_error", "playback_error"],
      ["network", "network"],
    ] as const) {
      const res = await POST(speechRequest(report({ reason, fixed: reason === "playback_error" })));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      expect(logs.at(-1)).toEqual({
        event: "tts_fallback",
        source: "browser",
        reason: logged,
        shopId: SHOP,
        language: "es",
        fixed: reason === "playback_error",
        latencyMs: 2500,
      });
    }
    expect(tts.calls).toEqual([]);
  });

  it("is rate-limited per visitor like say, and shares the visitor's minute with say", async () => {
    const tts = fakeTts({});
    const { POST } = makeSpeech(t, tts, { config: { perVisitorPerMinute: 2 } });
    expect((await POST(speechRequest(sayBody("Vale.")))).status).toBe(200);
    expect((await POST(speechRequest(report()))).status).toBe(204);
    const res = await POST(speechRequest(report()));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ fallback: "rate_limit" });
  });

  it("a report spends none of the TTS quota counters", async () => {
    const tts = fakeTts({});
    const { POST } = makeSpeech(t, tts);
    await POST(speechRequest(report()));
    const keys = (await t.handle.db.select().from(rateLimits)).map((r) => r.key);
    expect(keys.some((k) => k.startsWith("tts:"))).toBe(true);
    expect(keys).not.toContain("tts-global-h");
    expect(keys).not.toContain("tts-global-d");
  });
});

describe("secrets", () => {
  it("the secret is never in a response or a log", async () => {
    const tts = fakeTts({ [MODELS[0]]: { kind: "throw", error: apiError(503, "503 down") } });
    const { POST, logs } = makeSpeech(t, tts);
    const res = await POST(speechRequest(sayBody(GREETING)));
    expect(await res.text()).not.toContain(SECRET);
    for (const l of logs) expect(JSON.stringify(l)).not.toContain(SECRET);
  });
});

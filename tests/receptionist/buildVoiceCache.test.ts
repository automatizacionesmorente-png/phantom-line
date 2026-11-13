import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { insertShop } from "../db/helpers";
import { createTestDb, type TestDb } from "../db/pglite";
import { lolaProfile } from "../fixtures/lola";
import { nextQuotaReset } from "@/lib/conversation/ttsLimits";
import { rateLimits, voiceCache } from "@/lib/db/schema";
import { createPregenQuotaStore } from "@/lib/db/ttsRepository";
import { createVoiceCacheRepository } from "@/lib/db/voiceCacheRepository";
import { buildVoiceCache, summarizePlan, type BuildDeps, type SynthRequest } from "@/lib/receptionist/buildVoiceCache";
import { fullCachePlan, type PlanLine } from "@/lib/receptionist/cachePlan";
import { cacheKey } from "@/lib/receptionist/voiceCacheKey";
import { getSectorPack } from "@/lib/sectors";

/** Task 9.10: the pre-generation run, on PGlite with a fake synthesizer. No TTS request is made. */

const pack = getSectorPack("hair-salon");
const MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview"];
const voiceFor = (model: string, p: { voice: string; classicVoice: string }) => (model.includes("3.8") ? p.voice : p.classicVoice);
/** Friday 13 November 2026, 10:00 in Madrid (01:00 Pacific). */
const T0 = Temporal.Instant.from("2026-11-13T09:00:00Z");
const ES = pack.voice.es;

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 120_000);
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
});
afterAll(async () => {
  await t.close();
});

const PLAN = fullCachePlan(lolaProfile, pack, Temporal.PlainDate.from("2026-11-13"), ["es"]);
const quotaError = () => Object.assign(new Error("429 quota exceeded"), { status: 429 });

type Answer = "ok" | "429" | "500";

/** A fake synthesizer: answers per model from a script, and records every request. */
function fake(script: Record<string, Answer[]>) {
  const calls: { model: string; text: string; voice: string }[] = [];
  let ms = T0.epochMilliseconds;
  const slept: number[] = [];
  const deps: BuildDeps = {
    store: createVoiceCacheRepository(t.handle),
    quota: createPregenQuotaStore(t.handle),
    async synthesize(req: SynthRequest) {
      calls.push({ model: req.model, text: req.text, voice: voiceFor(req.model, req.profile) });
      const answer = script[req.model]?.shift() ?? "ok";
      if (answer === "429") throw quotaError();
      if (answer === "500") throw Object.assign(new Error("500 internal"), { status: 500 });
      return { bytes: new Uint8Array([0xff, 0xfb, 0x90, 0x00, calls.length]), mime: "audio/mpeg" };
    },
    clock: () => Temporal.Instant.fromEpochMilliseconds(ms),
    sleep: async (wait) => {
      slept.push(wait);
      ms += wait;
    },
  };
  return { deps, calls, slept, advance: (to: Temporal.Instant) => (ms = to.epochMilliseconds) };
}

const opts = (lines: readonly PlanLine[], over: Partial<Parameters<typeof buildVoiceCache>[1]> = {}) => ({
  shop: lolaProfile,
  pack,
  lines,
  models: MODELS,
  voiceFor,
  gapMs: 20_000,
  ...over,
});
const storedKeys = async () => new Set((await t.handle.db.select({ key: voiceCache.key }).from(voiceCache)).map((r) => r.key));
const keyOf = (model: string, text: string) => cacheKey(model, ES.voice, ES.style, ES.languageCode, text);

describe("buildVoiceCache", () => {
  it("requests only the missing lines, on the Spanish voice's models, and pins tiers 1–2", async () => {
    const lines = [PLAN[0], PLAN[1], PLAN.find((l) => l.tier === 3)!];
    // The first line is already stored, under the second model's key.
    await createVoiceCacheRepository(t.handle).insert({
      key: keyOf(MODELS[1], lines[0].text),
      shopId: lolaProfile.id,
      language: "es",
      model: MODELS[1],
      mime: "audio/mpeg",
      bytes: new Uint8Array([1]),
      durationMs: null,
      source: "pregen",
      pinned: true,
    });
    const f = fake({});
    const report = await buildVoiceCache(f.deps, opts(lines));
    expect(f.calls.map((c) => c.text)).toEqual([lines[1].text, lines[2].text]);
    expect(f.calls.every((c) => c.model === MODELS[0] && c.voice === "es-es-commercial-3")).toBe(true);
    expect(report).toMatchObject({ built: 2, failed: 0, stoppedAt: null, plan: { lines: 3, cachedBefore: 1, missingBefore: 2 } });
    const rows = await t.handle.db.select({ key: voiceCache.key, pinned: voiceCache.pinned, source: voiceCache.source }).from(voiceCache);
    expect(rows).toContainEqual({ key: keyOf(MODELS[0], lines[1].text), pinned: true, source: "pregen" });
    expect(rows).toContainEqual({ key: keyOf(MODELS[0], lines[2].text), pinned: false, source: "pregen" });
    // Spaced: one wait between the two requests, the full gap since the clock did not move.
    expect(f.slept).toEqual([20_000]);
  });

  it("stops a model after per-day − reserve successes in the Pacific day, counted across runs", async () => {
    const lines = PLAN.slice(0, 20);
    const f = fake({});
    const first = await buildVoiceCache(f.deps, opts(lines, { gapMs: 0 }));
    // 8 on each 3.8 model (10 − 2), and never the 3.1 model: it has no Castilian voice.
    expect(f.calls.filter((c) => c.model === MODELS[0])).toHaveLength(8);
    expect(f.calls.filter((c) => c.model === MODELS[1])).toHaveLength(8);
    expect(f.calls.some((c) => c.model === MODELS[2])).toBe(false);
    expect(first.built).toBe(16);
    expect(first.stoppedAt).toMatchObject({ index: 16, linesLeft: 4, tier: 1, lang: "es" });
    expect(first.perModel[MODELS[0]]).toMatchObject({ successes: 8, stoppedAtReserve: true });

    // A second run on the same Pacific day spends nothing more.
    const g = fake({});
    const again = await buildVoiceCache(g.deps, opts(lines, { gapMs: 0 }));
    expect(g.calls).toEqual([]);
    expect(again.perModel[MODELS[0]]).toMatchObject({ successesBefore: 8, successes: 0 });
  });

  it("after a 429 it marks the model exhausted, moves the same line to the next model, never asks that model again; a second run resumes at the next missing line", async () => {
    const lines = PLAN.slice(0, 6);
    const f = fake({ [MODELS[0]]: ["ok", "ok", "429"], [MODELS[1]]: ["429"] });
    const report = await buildVoiceCache(f.deps, opts(lines));
    expect(f.calls.map((c) => [c.model, lines.findIndex((l) => l.text === c.text)])).toEqual([
      [MODELS[0], 0],
      [MODELS[0], 1],
      [MODELS[0], 2],
      [MODELS[1], 2],
    ]);
    expect(report.built).toBe(2);
    expect(report.stoppedAt).toMatchObject({ index: 2, linesLeft: 4 });
    expect(report.stoppedAt?.resume).toContain("09:00 Madrid");
    const marks = await t.handle.db.select().from(rateLimits).where(like(rateLimits.key, "tts-exhausted:%"));
    expect(marks.map((m) => m.key).sort()).toEqual([`tts-exhausted:${MODELS[0]}`, `tts-exhausted:${MODELS[1]}`].sort());
    expect(marks.every((m) => m.windowStart.getTime() === nextQuotaReset(T0).epochMilliseconds)).toBe(true);

    // The same day: both marks hold, so nothing is asked.
    const sameDay = fake({});
    await buildVoiceCache(sameDay.deps, opts(lines));
    expect(sameDay.calls).toEqual([]);

    // The next day, after the reset: it starts at the first missing line, the one the 429 stopped.
    const next = fake({});
    next.advance(nextQuotaReset(T0).add({ hours: 1 }));
    const resumed = await buildVoiceCache(next.deps, opts(lines));
    expect(next.calls[0].text).toBe(lines[2].text);
    expect(next.calls.map((c) => c.text)).toEqual(lines.slice(2).map((l) => l.text));
    expect(resumed).toMatchObject({ built: 4, stoppedAt: null, plan: { cachedBefore: 2 } });
    const keys = await storedKeys();
    for (const l of lines) expect([keyOf(MODELS[0], l.text), keyOf(MODELS[1], l.text)].some((k) => keys.has(k))).toBe(true);
  });

  it("an error that is not quota leaves the line for the next run; three in a row stop that model for this run", async () => {
    const lines = PLAN.slice(0, 5);
    const f = fake({ [MODELS[0]]: ["500", "500", "500"] });
    const report = await buildVoiceCache(f.deps, opts(lines, { gapMs: 0 }));
    // Lines 0–2 fail once each on the first model (no retry), then lines 3–4 go to the second model.
    expect(f.calls.map((c) => c.model)).toEqual([MODELS[0], MODELS[0], MODELS[0], MODELS[1], MODELS[1]]);
    expect(report.built).toBe(2);
    expect(report.stoppedAt).toMatchObject({ index: 0, linesLeft: 3 });
    expect(report.perModel[MODELS[0]]).toMatchObject({ errors: 3, exhausted: false });
  });

  it("reports the size per tier", async () => {
    const f = fake({});
    const report = await buildVoiceCache(f.deps, opts(PLAN.slice(0, 3), { gapMs: 0 }));
    expect(report.sizes[1]).toEqual({ lines: 3, bytes: { min: 5, median: 5, max: 5, total: 15 }, seconds: { min: 0.026, median: 0.026, max: 0.026 } });
  });
});

describe("summarizePlan (--plan)", () => {
  it("Lola in Spanish: the line count per tier and the days the two 3.8 models need at 8 a day each", () => {
    const s = summarizePlan(PLAN, lolaProfile, pack, MODELS, voiceFor);
    expect(s.perLang.es.models).toEqual([MODELS[0], MODELS[1]]);
    expect(s.perLang.es.perDay).toBe(16);
    expect(s.perLang.es.lines).toBe(PLAN.length);
    expect(s.perLang.es.days).toBe(Math.ceil(PLAN.length / 16));
    expect(Object.values(s.perLang.es.tiers).reduce((a, b) => a + (b ?? 0), 0)).toBe(PLAN.length);
  });
});

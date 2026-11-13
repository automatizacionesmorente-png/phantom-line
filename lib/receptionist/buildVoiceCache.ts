import { Temporal } from "temporal-polyfill";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { nextQuotaReset, quotaDayStart, type PregenQuotaStore } from "@/lib/conversation/ttsLimits";
import type { Lang, SectorPack } from "@/lib/sectors";
import type { VoiceProfile } from "@/lib/sectors/types";
import { PINNED_TIERS, type PlanLine, type Tier } from "./cachePlan";
import { lineKeys, primaryVoiceModels, type VoiceFor } from "./voiceCacheKey";
import { mp3DurationMs, type VoiceCacheStore } from "./voiceCacheBudget";
import { resolveVoiceProfile } from "./voiceProfile";

/**
 * The voice cache pre-generation (task 9.10, design.md "Pre-generation for the demo shop").
 * All I/O goes through `deps`; `scripts/build-voice-cache.ts` wires the real ones, and the tests
 * pass PGlite and a fake synthesizer.
 *
 * - Only the plan's lines with no stored audio under any primary-voice model's key are requested.
 * - Each language uses only the models of its primary voice, in GEMINI_TTS_MODEL order.
 * - A model stops after `perDay − reserve` successes in the Pacific day (counted across runs).
 * - A 429 writes `tts-exhausted:<model>` (the app then skips that model too) and the same line
 *   moves to the next model; the same model is never asked again in that run.
 * - Any other error leaves the line for the next run; three in a row on one model stop that model.
 * - Tiers 1–2 are pinned.
 */

export const FREE_TIER_PER_DAY = 10;
export const DEFAULT_RESERVE = 2;
export const DEFAULT_GAP_MS = 20_000;
/** Non-streamed MP3 calls took 3–22 s in the spike. */
export const SYNTH_TIMEOUT_MS = 60_000;
/** Non-quota errors in a row before a model is left alone for the rest of the run. */
export const MAX_ERRORS_IN_A_ROW = 3;

export interface SynthRequest {
  text: string;
  profile: VoiceProfile;
  model: string;
  signal: AbortSignal;
}

export interface BuildDeps {
  store: Pick<VoiceCacheStore, "findKeys" | "insert">;
  quota: PregenQuotaStore;
  synthesize(req: SynthRequest): Promise<{ bytes: Uint8Array; mime: string }>;
  clock: () => Temporal.Instant;
  sleep: (ms: number) => Promise<void>;
  /** Progress lines: never the text of a line beyond its tier and index. */
  log?: (line: string) => void;
}

export interface BuildOptions {
  shop: ShopProfile;
  pack: SectorPack;
  lines: readonly PlanLine[];
  models: readonly string[];
  voiceFor: VoiceFor;
  gapMs?: number;
  perDay?: number;
  reserve?: number;
  timeoutMs?: number;
}

export interface TierSizes {
  lines: number;
  bytes: { min: number; median: number; max: number; total: number };
  seconds: { min: number; median: number; max: number } | null;
}

export interface BuildReport {
  /** The Pacific quota day the run spent. */
  quotaDay: string;
  startedAt: string;
  finishedAt: string;
  plan: { lines: number; cachedBefore: number; missingBefore: number };
  built: number;
  failed: number;
  perModel: Record<string, { successesBefore: number; successes: number; errors: number; exhausted: boolean; stoppedAtReserve: boolean }>;
  /** Where the run stopped with lines still missing, or null when every planned line is stored. */
  stoppedAt: { tier: Tier; lang: Lang; index: number; linesLeft: number; resume: string } | null;
  sizes: Partial<Record<Tier, TierSizes>>;
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const statusOf = (err: unknown): number | undefined => {
  const e = err as { status?: unknown; statusCode?: unknown } | null;
  return typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : undefined;
};

export async function buildVoiceCache(deps: BuildDeps, opts: BuildOptions): Promise<BuildReport> {
  const log = deps.log ?? (() => undefined);
  const perDay = opts.perDay ?? FREE_TIER_PER_DAY;
  const reserve = opts.reserve ?? DEFAULT_RESERVE;
  const gapMs = opts.gapMs ?? DEFAULT_GAP_MS;
  const startedAt = deps.clock();
  const quotaDay = quotaDayStart(startedAt).toZonedDateTimeISO("America/Los_Angeles").toPlainDate().toString();

  // Each language's primary voice, and the models that speak with it.
  const langs = [...new Set(opts.lines.map((l) => l.lang))];
  const profiles = new Map<Lang, VoiceProfile>(langs.map((l) => [l, resolveVoiceProfile(opts.pack, opts.shop, l)]));
  const modelsOf = new Map<Lang, string[]>(
    langs.map((l) => [l, primaryVoiceModels(opts.models, profiles.get(l)!, opts.voiceFor)]),
  );

  // Which lines are already stored, under any of their keys.
  const keysOf = opts.lines.map((l) => lineKeys(l.text, profiles.get(l.lang)!, opts.models, opts.voiceFor));
  const allKeys = keysOf.flatMap((ks) => ks.map((k) => k.key));
  const found = new Set<string>();
  for (let i = 0; i < allKeys.length; i += 500) {
    for (const k of await deps.store.findKeys(allKeys.slice(i, i + 500))) found.add(k);
  }
  const missing = opts.lines.map((_, i) => i).filter((i) => !keysOf[i].some((k) => found.has(k.key)));

  const exhausted = new Set(await deps.quota.exhausted(startedAt));
  const usedModels = [...new Set([...modelsOf.values()].flat())];
  const perModel: BuildReport["perModel"] = {};
  const budget = new Map<string, number>();
  const errorsInARow = new Map<string, number>();
  for (const m of usedModels) {
    const before = await deps.quota.successesToday(m, startedAt);
    perModel[m] = { successesBefore: before, successes: 0, errors: 0, exhausted: exhausted.has(m), stoppedAtReserve: false };
    budget.set(m, Math.max(0, perDay - reserve - before));
  }
  const usable = (m: string) => !exhausted.has(m) && (budget.get(m) ?? 0) > 0 && (errorsInARow.get(m) ?? 0) < MAX_ERRORS_IN_A_ROW;

  const sizes = new Map<Tier, { bytes: number[]; seconds: number[] }>();
  let built = 0;
  let lastStartMs: number | null = null;
  const left: number[] = [];

  for (const index of missing) {
    const line = opts.lines[index];
    const profile = profiles.get(line.lang)!;
    let done = false;
    for (;;) {
      const model = modelsOf.get(line.lang)!.find(usable);
      if (!model) break;
      if (lastStartMs !== null) {
        const wait = lastStartMs + gapMs - deps.clock().epochMilliseconds;
        if (wait > 0) await deps.sleep(wait);
      }
      lastStartMs = deps.clock().epochMilliseconds;
      const signal = AbortSignal.timeout(opts.timeoutMs ?? SYNTH_TIMEOUT_MS);
      try {
        const audio = await deps.synthesize({ text: line.text, profile, model, signal });
        const key = keysOf[index].find((k) => k.model === model)!.key;
        const durationMs = /mpeg|mp3/i.test(audio.mime) ? mp3DurationMs(audio.bytes) : null;
        await deps.store.insert({
          key,
          shopId: opts.shop.id,
          language: line.lang,
          model,
          mime: audio.mime,
          bytes: audio.bytes,
          durationMs,
          source: "pregen",
          pinned: PINNED_TIERS.has(line.tier),
        });
        await deps.quota.countSuccess(model, deps.clock());
        budget.set(model, (budget.get(model) ?? 0) - 1);
        errorsInARow.set(model, 0);
        perModel[model].successes += 1;
        if ((budget.get(model) ?? 0) <= 0) perModel[model].stoppedAtReserve = true;
        const s = sizes.get(line.tier) ?? { bytes: [], seconds: [] };
        s.bytes.push(audio.bytes.byteLength);
        if (durationMs !== null) s.seconds.push(durationMs / 1000);
        sizes.set(line.tier, s);
        built += 1;
        done = true;
        log(`ok tier ${line.tier} ${line.lang} #${index} on ${model}: ${audio.bytes.byteLength} bytes`);
        break;
      } catch (err) {
        const status = statusOf(err);
        if (status === 429) {
          // That model's bucket is empty for the day: mark it as the app does, and try the next one.
          exhausted.add(model);
          perModel[model].exhausted = true;
          await deps.quota.markExhausted(model, nextQuotaReset(deps.clock()));
          log(`429 on ${model}: exhausted until midnight Pacific`);
          continue;
        }
        perModel[model].errors += 1;
        errorsInARow.set(model, (errorsInARow.get(model) ?? 0) + 1);
        log(`error ${status ?? (err as Error)?.name ?? "error"} on ${model} for tier ${line.tier} #${index}; left for the next run`);
        break;
      }
    }
    if (!done) left.push(index);
  }

  const first = left[0];
  const stoppedAt =
    first === undefined
      ? null
      : {
          tier: opts.lines[first].tier,
          lang: opts.lines[first].lang,
          index: first,
          linesLeft: left.length,
          resume: "after 09:00 Madrid (midnight Pacific), when the quota resets",
        };
  return {
    quotaDay,
    startedAt: startedAt.toString(),
    finishedAt: deps.clock().toString(),
    plan: { lines: opts.lines.length, cachedBefore: opts.lines.length - missing.length, missingBefore: missing.length },
    built,
    failed: left.length,
    perModel,
    stoppedAt,
    sizes: Object.fromEntries(
      [...sizes].map(([tier, s]) => [
        tier,
        {
          lines: s.bytes.length,
          bytes: { min: Math.min(...s.bytes), median: median(s.bytes), max: Math.max(...s.bytes), total: s.bytes.reduce((a, b) => a + b, 0) },
          seconds: s.seconds.length
            ? { min: Math.min(...s.seconds), median: median(s.seconds.map((x) => Math.round(x * 1000))) / 1000, max: Math.max(...s.seconds) }
            : null,
        },
      ]),
    ),
  };
}

/** `--plan`: the list sizes per language and tier, and the days the quota needs, with no API call. */
export interface PlanSummary {
  perLang: Record<string, { tiers: Partial<Record<Tier, number>>; lines: number; models: string[]; perDay: number; days: number }>;
  lines: number;
  /** Languages built one after the other on the models they share, so the days add up. */
  days: number;
}

export function summarizePlan(
  lines: readonly PlanLine[],
  shop: ShopProfile,
  pack: SectorPack,
  models: readonly string[],
  voiceFor: VoiceFor,
  opts: { perDay?: number; reserve?: number } = {},
): PlanSummary {
  const perDayPerModel = (opts.perDay ?? FREE_TIER_PER_DAY) - (opts.reserve ?? DEFAULT_RESERVE);
  const perLang: PlanSummary["perLang"] = {};
  for (const lang of [...new Set(lines.map((l) => l.lang))]) {
    const mine = lines.filter((l) => l.lang === lang);
    const tiers: Partial<Record<Tier, number>> = {};
    for (const l of mine) tiers[l.tier] = (tiers[l.tier] ?? 0) + 1;
    const ms = primaryVoiceModels(models, resolveVoiceProfile(pack, shop, lang), voiceFor);
    const perDay = ms.length * perDayPerModel;
    perLang[lang] = { tiers, lines: mine.length, models: ms, perDay, days: perDay > 0 ? Math.ceil(mine.length / perDay) : Infinity };
  }
  return {
    perLang,
    lines: lines.length,
    days: Object.values(perLang).reduce((d, l) => d + l.days, 0),
  };
}

/** The date the report file is named after: the run's day in Madrid. */
export const reportDate = (now: Temporal.Instant, timeZone: string) => now.toZonedDateTimeISO(timeZone).toPlainDate().toString();

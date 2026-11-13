// Pre-generates the voice cache of a shop (natural-voice task 9.10, design.md "Pre-generation
// for the demo shop"): the lines of `cachePlan`, most heard first, as non-streamed MP3, into the
// `voice_cache` table.
//
//   Dry run, no API call and no database:
//     node --conditions=react-server --import tsx scripts/build-voice-cache.ts --plan
//   Real run (writes to the database in DATABASE_URL; only with the owner's approval):
//     node --env-file=.env.local --conditions=react-server --import tsx scripts/build-voice-cache.ts
//
// `--conditions=react-server` lets `import "server-only"` in the TTS client and the database
// client load, as check-turn.ts does. Node loads .env.local itself; this script never prints
// process.env, the key or the database URL, and every printed error goes through redact().
//
// Options:
//   --plan            print the list sizes and the estimated days, then exit.
//   --lang=es[,en]    languages to build (default es: English waits for the voice audition, task 2.4).
//   --today=YYYY-MM-DD the first "today" of the plan (default: today in the shop's zone).
//   --gap=<ms>        least time between the starts of two requests (default 20000).
//   --reserve=<n>     requests left unspent per model per Pacific day (default 2 of 10).
//   --per-day=<n>     the free tier's requests per model per day (default 10).
//
// A real run stops on a model after `per-day − reserve` successes in the Pacific day, marks a
// model that answers 429 with `tts-exhausted:<model>` and moves on to the next one, never asks the
// same model again, and when every allowed model has stopped writes where it stopped to
// .measurements/voice-cache-run-<date>.json and exits 0. Run it again the next day after 09:00
// Madrid: it skips every line already stored.

import { mkdirSync, writeFileSync } from "node:fs";
import { Temporal } from "temporal-polyfill";
import { ShopProfileSchema } from "@/lib/conversation/shopProfile";
import { neonHandle } from "@/lib/db/client";
import { createRepository } from "@/lib/db/repository";
import { lolaSeedProfile } from "@/lib/db/seed";
import { createPregenQuotaStore } from "@/lib/db/ttsRepository";
import { createVoiceCacheRepository } from "@/lib/db/voiceCacheRepository";
import {
  buildVoiceCache,
  DEFAULT_GAP_MS,
  DEFAULT_RESERVE,
  FREE_TIER_PER_DAY,
  reportDate,
  summarizePlan,
} from "@/lib/receptionist/buildVoiceCache";
import { fullCachePlan } from "@/lib/receptionist/cachePlan";
import { defaultVoiceFor, parseTtsModelList, ttsSynthesizerFromEnv } from "@/lib/receptionist/ttsClient";
import { getSectorPack, type Lang } from "@/lib/sectors";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  }),
);
const int = (name: string, fallback: number) => {
  const raw = args.get(name);
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : fallback;
};

const secrets = [process.env.GEMINI_API_KEY, process.env.DATABASE_URL].filter((s): s is string => Boolean(s));
const redact = (text: string) => secrets.reduce((t, s) => t.split(s).join("***"), text);
const say = (text: string) => console.log(redact(text));

const langs = (args.get("lang") ?? "es").split(",").filter((l): l is Lang => l === "es" || l === "en");
const gapMs = int("gap", DEFAULT_GAP_MS);
const reserve = int("reserve", DEFAULT_RESERVE);
const perDay = int("per-day", FREE_TIER_PER_DAY);
const models = parseTtsModelList(process.env.GEMINI_TTS_MODEL);

async function main(): Promise<void> {
  if (args.has("plan")) {
    // The seed profile, so the dry run needs no database.
    const shop = ShopProfileSchema.parse(lolaSeedProfile);
    const pack = getSectorPack(shop.sectorPackId);
    const today = args.get("today") ? Temporal.PlainDate.from(args.get("today")!) : Temporal.Now.plainDateISO(shop.timeZone);
    const t0 = performance.now();
    const lines = fullCachePlan(shop, pack, today, langs);
    const ms = Math.round(performance.now() - t0);
    const summary = summarizePlan(lines, shop, pack, models, defaultVoiceFor, { perDay, reserve });
    say(JSON.stringify({ shop: shop.id, today: today.toString(), langs, models, perDay, reserve, planMs: ms, ...summary }, null, 2));
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const handle = neonHandle(url);
  const shopId = args.get("shop") ?? lolaSeedProfile.id;
  const shop = await createRepository(handle).getShop(shopId);
  if (!shop) throw new Error(`shop ${shopId} not found`);
  const pack = getSectorPack(shop.sectorPackId);
  const today = args.get("today") ? Temporal.PlainDate.from(args.get("today")!) : Temporal.Now.plainDateISO(shop.timeZone);
  const lines = fullCachePlan(shop, pack, today, langs);
  const synth = ttsSynthesizerFromEnv();

  const report = await buildVoiceCache(
    {
      store: createVoiceCacheRepository(handle),
      quota: createPregenQuotaStore(handle),
      synthesize: (req) => synth.synthesize(req),
      clock: () => Temporal.Now.instant(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: say,
    },
    { shop, pack, lines, models: synth.models, voiceFor: synth.voiceFor, gapMs, perDay, reserve },
  );
  mkdirSync(".measurements", { recursive: true });
  const file = `.measurements/voice-cache-run-${reportDate(Temporal.Now.instant(), shop.timeZone)}.json`;
  writeFileSync(file, `${redact(JSON.stringify(report, null, 2))}\n`);
  say(`built ${report.built} lines, ${report.plan.missingBefore - report.built} still missing; report in ${file}`);
}

main().catch((err: unknown) => {
  const e = err as { constructor?: { name?: string }; message?: unknown } | null;
  say(`build-voice-cache failed: ${e?.constructor?.name ?? "Error"} ${redact(String(e?.message ?? ""))}`.trim());
  process.exit(1);
});

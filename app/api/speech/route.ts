import { rateLimitSalt } from "@/app/api/visitorKey";
import { after } from "next/server";
import { Temporal } from "temporal-polyfill";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { ttsLimitsFromEnv } from "@/lib/conversation/ttsLimits";
import { getDb, getRepository } from "@/lib/db/client";
import { createTtsRepository } from "@/lib/db/ttsRepository";
import { createVoiceCacheRepository } from "@/lib/db/voiceCacheRepository";
import { ttsClientFromEnv } from "@/lib/receptionist/ttsClient";
import { voiceCacheMaxBytesFromEnv } from "@/lib/receptionist/voiceCacheBudget";
import { makeSpeechHandler, type SpeechDeps } from "./handler";

/**
 * POST /api/speech: Neural_Voice audio for one reply. Default Node.js runtime and no `runtime`
 * export (cacheComponents forbids it). The only route that calls a TTS model.
 */

/** Shop profiles change rarely; keeping them a minute saves a database read before the first chunk. */
const SHOP_CACHE_MS = 60_000;

let deps: SpeechDeps | undefined;

function productionDeps(): SpeechDeps {
  if (deps) return deps;
  const repo = getRepository();
  const shops = new Map<string, { at: number; shop: ShopProfile | null }>();
  deps = {
    tts: ttsClientFromEnv(),
    limits: createTtsRepository(getDb()),
    async getShop(id) {
      const hit = shops.get(id);
      if (hit && Date.now() - hit.at < SHOP_CACHE_MS) return hit.shop;
      const shop = await repo.getShop(id);
      shops.set(id, { at: Date.now(), shop });
      return shop;
    },
    clock: () => Temporal.Now.instant(),
    config: ttsLimitsFromEnv(process.env),
    secret: process.env.SPEECH_TOKEN_SECRET ?? "",
    apiKey: process.env.GEMINI_API_KEY,
    exhausted: new Map(),
    voiceCache: createVoiceCacheRepository(getDb()),
    cacheMaxBytes: voiceCacheMaxBytesFromEnv(process.env),
  };
  return deps;
}

export const POST = makeSpeechHandler({
  deps: productionDeps,
  schedule: (task) => after(task),
  salt: () => rateLimitSalt(),
});

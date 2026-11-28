import { rateLimitSalt } from "@/app/api/visitorKey";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { Temporal } from "temporal-polyfill";
import { limitsFromEnv } from "@/lib/conversation/limits";
import type { CoreDeps, ModelClient } from "@/lib/conversation/types";
import { getDb, getRepository } from "@/lib/db/client";
import { createVoiceCacheRepository } from "@/lib/db/voiceCacheRepository";
import { MODEL_TIMEOUT_MS } from "@/lib/receptionist/callModel";
import { geminiClientFromEnv } from "@/lib/receptionist/geminiClient";
import { defaultVoiceFor, parseTtsModelList } from "@/lib/receptionist/ttsClient";
import { makeTurnHandler, type VoiceCacheLookup } from "./handler";

/**
 * POST /api/turn: the voice Channel adapter. Default Node.js runtime and no
 * `runtime` export (cacheComponents forbids it; the Edge runtime is deprecated).
 */

let deps: CoreDeps | undefined;

function productionDeps(): CoreDeps {
  if (deps) return deps;
  const repo = getRepository();
  // Created on the first model call: a missing key becomes a model failure
  // (the fallback path with a saved Message), not a broken `start`.
  let client: ModelClient | undefined;
  const model: ModelClient = {
    generate: (req) => (client ??= geminiClientFromEnv()).generate(req),
  };
  deps = {
    repo,
    model,
    limiter: { hit: (key, now) => repo.hitRateLimits(key, now) },
    clock: () => Temporal.Now.instant(),
    newId: () => randomUUID(),
    config: { modelTimeoutMs: MODEL_TIMEOUT_MS, brainOnly: process.env.PHANTOM_BRAIN_ONLY === "1", maxTurns: 20, maxConsecutiveInvalid: 2, ...limitsFromEnv(process.env) },
  };
  return deps;
}

let cache: VoiceCacheLookup | undefined;

function voiceCache(): VoiceCacheLookup {
  cache ??= {
    store: createVoiceCacheRepository(getDb()),
    models: parseTtsModelList(process.env.GEMINI_TTS_MODEL),
    voiceFor: defaultVoiceFor,
  };
  return cache;
}

export const POST = makeTurnHandler({
  deps: productionDeps,
  schedule: (task) => after(task),
  salt: () => rateLimitSalt(),
  speechSecret: () => process.env.SPEECH_TOKEN_SECRET,
  voiceCache,
});

import { after } from "next/server";
import { getDb } from "@/lib/db/client";
import { createVoiceCacheRepository } from "@/lib/db/voiceCacheRepository";
import { makeVoiceHandler, type VoiceDeps } from "../handler";

/**
 * GET /api/voice/[key]: a cached line's audio. Default Node.js runtime and no `runtime` export
 * (cacheComponents forbids it). With Cache Components a GET handler that queries a database runs
 * at request time, so nothing is prerendered at build time; the CDN caches the immutable answer.
 */

let deps: VoiceDeps | undefined;

function productionDeps(): VoiceDeps {
  deps ??= { store: createVoiceCacheRepository(getDb()), nowMs: () => Date.now() };
  return deps;
}

export const GET = makeVoiceHandler({ deps: productionDeps, schedule: (task) => after(task) });

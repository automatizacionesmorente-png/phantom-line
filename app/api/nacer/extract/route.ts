import { Temporal } from "temporal-polyfill";
import { rateLimitSalt } from "@/app/api/visitorKey";
import { getDb } from "@/lib/db/client";
import { createWizardLimiter } from "@/lib/db/trialRepository";
import { geminiExtractorFromEnv } from "@/lib/rebirth/geminiExtract";
import { makeExtractHandler } from "./handler";

/** POST /api/nacer/extract. Built on first use, so `next build` needs no key or database. */
export const maxDuration = 60;

export const POST = makeExtractHandler({
  model: () => geminiExtractorFromEnv(),
  limiter: () => createWizardLimiter(getDb()),
  clock: () => Temporal.Now.instant(),
  salt: () => rateLimitSalt(),
});

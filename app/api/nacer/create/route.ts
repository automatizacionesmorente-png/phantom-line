import { Temporal } from "temporal-polyfill";
import { rateLimitSalt } from "@/app/api/visitorKey";
import { getDb } from "@/lib/db/client";
import { createTrialStore, createWizardLimiter } from "@/lib/db/trialRepository";
import { makeCreateHandler } from "./handler";

/** POST /api/nacer/create. Built on first use, so `next build` needs no DATABASE_URL. */
export const POST = makeCreateHandler({
  store: () => createTrialStore(getDb()),
  limiter: () => createWizardLimiter(getDb()),
  clock: () => Temporal.Now.instant(),
  salt: () => rateLimitSalt(),
});

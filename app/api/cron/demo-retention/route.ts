import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { getDb } from "@/lib/db/client";
import { createOwnerRepository } from "@/lib/db/ownerRepository";
import { createTrialStore } from "@/lib/db/trialRepository";
import type { DemoRetentionDeps } from "@/lib/owner/demoRetention";
import { makeCronHandler } from "./handler";

/**
 * GET /api/cron/demo-retention: called once a day by Vercel Cron (vercel.json). Default
 * Node.js runtime and no `runtime` export (cacheComponents forbids it).
 */
export const GET = makeCronHandler({
  deps: (): DemoRetentionDeps => ({
    repo: createOwnerRepository(getDb()),
    clock: () => Temporal.Now.instant(),
    newId: () => randomUUID(),
  }),
  secret: () => process.env.CRON_SECRET,
  sweepTrials: () => createTrialStore(getDb()).deleteExpired(Temporal.Now.instant()),
});

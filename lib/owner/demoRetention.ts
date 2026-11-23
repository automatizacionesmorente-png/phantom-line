/**
 * Demo_Retention (owner-machine Requirement 16): the Demo_Shop forgets old calls and never
 * looks empty. I/O only through the OwnerRepository port; the rules are the pure ones in
 * demo.ts. It never throws: a failure is one `demo_retention` log line with counts only, and
 * the request that triggered it answers as if it had not run (16.7).
 */
import type { Clock } from "@/lib/conversation/types";
import { summarizeError } from "@/lib/conversation/fallbackLog";
import { getSectorPack } from "@/lib/sectors";
import { DEMO_SHOP_ID, demoCutoffs, demoSamples, samplesToRestore } from "./demo";
import { consoleOwnerLogger, type DemoRetentionCounts, type OwnerLogger, type OwnerRepository } from "./types";

export interface DemoRetentionDeps {
  repo: OwnerRepository;
  clock: Clock;
  newId: () => string;
  log?: OwnerLogger;
}

/**
 * 1. Claim the 10-minute throttle in the database; stop if another request holds it (16.6).
 * 2. Erase and delete by the cutoffs (16.2, 16.3).
 * 3. Restore the missing Sample_Messages when fewer than 3 New_Messages remain (16.4).
 * Returns whether this call ran (held the claim), for the triggers' tests.
 */
export async function runDemoRetention(deps: DemoRetentionDeps): Promise<boolean> {
  const log = deps.log ?? consoleOwnerLogger;
  const counts: DemoRetentionCounts & { samplesAdded: number } = {
    erased: 0,
    deletedCalls: 0,
    deletedMessages: 0,
    deletedBookings: 0,
    deletedAuditRecords: 0,
    deletedClients: 0,
    samplesAdded: 0,
  };
  let step: "claim" | "cutoffs" | "samples" = "claim";
  try {
    const now = deps.clock();
    if (!(await deps.repo.claimDemoRetention(now))) return false;

    step = "cutoffs";
    Object.assign(counts, await deps.repo.applyDemoCutoffs(demoCutoffs(now)));

    step = "samples";
    const keys = samplesToRestore(await deps.repo.demoTapeState());
    if (keys.length > 0) {
      const access = await deps.repo.getShopAccess(DEMO_SHOP_ID);
      if (access) {
        const samples = demoSamples(keys, {
          now,
          shop: access.profile,
          pack: getSectorPack(access.profile.sectorPackId),
          newId: deps.newId,
        });
        counts.samplesAdded = await deps.repo.insertDemoSamples(samples);
      }
    }
    log({ event: "demo_retention", step, outcome: "ok", counts });
    return true;
  } catch (err) {
    log({ event: "demo_retention", step, outcome: "failed", counts, error: summarizeError(err) });
    return step !== "claim";
  }
}

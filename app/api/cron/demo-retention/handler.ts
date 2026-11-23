import { createHash, timingSafeEqual } from "node:crypto";
import { summarizeError } from "@/lib/conversation/fallbackLog";
import { DEMO_SHOP_ID } from "@/lib/owner/demo";
import { runDemoRetention, type DemoRetentionDeps } from "@/lib/owner/demoRetention";
import { consoleOwnerLogger } from "@/lib/owner/types";

/**
 * GET /api/cron/demo-retention: the daily Demo_Retention (owner-machine 16.6, 16.8) and the
 * deletion of expired trial shops (BACKLOG 16).
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the project has a
 * `CRON_SECRET` variable (docs read in task 1.5). Without that variable every request is
 * refused: nobody can run it on a deployment that never configured it.
 */
export interface CronHandlerOptions {
  /** Built on first use, so `next build` needs no DATABASE_URL. */
  deps: () => DemoRetentionDeps;
  /** CRON_SECRET, read per request. */
  secret: () => string | undefined;
  /** Deletes the expired trial shops of the /nacer wizard and their data; returns how many. Runs after the demo's retention. */
  sweepTrials?: () => Promise<number>;
}

const headers = { "cache-control": "no-store" };
const refused = () => new Response(null, { status: 401, headers });

/** Compares sha256 digests, so the secret's length never shows in the time taken. */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function makeCronHandler(opts: CronHandlerOptions): (request: Request) => Promise<Response> {
  return async function GET(request: Request): Promise<Response> {
    const secret = opts.secret();
    if (!secret) return refused();
    const auth = request.headers.get("authorization") ?? "";
    const prefix = "Bearer ";
    if (!auth.startsWith(prefix) || !sameSecret(auth.slice(prefix.length), secret)) return refused();

    let deps: DemoRetentionDeps | undefined;
    try {
      deps = opts.deps();
      // It never throws: a failed step is one `demo_retention` line with counts only (16.7).
      await runDemoRetention(deps);
      if (opts.sweepTrials) {
        try {
          const deleted = await opts.sweepTrials();
          // Counts only: no shop name, id or anything a trial owner typed.
          console.log(JSON.stringify({ event: "trial_sweep", outcome: "ok", deleted }));
        } catch (err) {
          console.error(JSON.stringify({ event: "trial_sweep", outcome: "failed", error: summarizeError(err) }));
          return new Response(null, { status: 503, headers });
        }
      }
      return new Response(null, { status: 204, headers });
    } catch (err) {
      try {
        (deps?.log ?? consoleOwnerLogger)({
          event: "owner_error",
          route: "cron",
          shopId: DEMO_SHOP_ID,
          error: summarizeError(err),
        });
      } catch {
        // Logging must never change the response.
      }
      return new Response(null, { status: 503, headers });
    }
  };
}

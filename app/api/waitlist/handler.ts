import type { Temporal } from "temporal-polyfill";
import { toIssues, visitorKeyOf } from "@/app/api/turn/handler";
import { DEFAULT_WAITLIST_LIMITS, WaitlistRequestSchema, type WaitlistLimits, type WaitlistStore } from "@/lib/waitlist/schema";

/**
 * POST /api/waitlist: the /startup sign-up (BACKLOG 12). Thin: validate, rate-limit, store.
 * 400 invalid or no consent, 429 rate limited, 503 store unavailable, 200 `{ ok: true }`.
 * A repeat email also answers 200, so the endpoint never tells who is already on the list.
 * It never logs or returns the email or the shop name.
 */
export interface WaitlistHandlerOptions {
  store: () => WaitlistStore;
  clock: () => Temporal.Instant;
  salt: () => string;
  limits?: WaitlistLimits;
}

const json = (body: unknown, status: number) => Response.json(body, { status });

export function makeWaitlistHandler(opts: WaitlistHandlerOptions): (request: Request) => Promise<Response> {
  const limits = opts.limits ?? DEFAULT_WAITLIST_LIMITS;
  return async function POST(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_request", issues: [{ path: "", message: "The body is not valid JSON" }] }, 400);
    }
    const parsed = WaitlistRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: "invalid_request", issues: toIssues(parsed.error) }, 400);

    try {
      const store = opts.store();
      const now = opts.clock();
      const key = visitorKeyOf(request.headers.get("x-forwarded-for"), opts.salt());
      const counts = await store.hit(key, now);
      if (counts.visitor > limits.perVisitorPerHour || counts.day > limits.globalPerDay) {
        return json({ error: "rate_limited" }, 429);
      }
      await store.add(parsed.data, now);
      return json({ ok: true }, 200);
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  };
}

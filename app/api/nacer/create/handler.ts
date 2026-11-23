import type { Temporal } from "temporal-polyfill";
import type { z } from "zod";
import { visitorKeyOf } from "@/app/api/visitorKey";
import { ShopProfileSchema, type ShopProfile } from "@/lib/conversation/shopProfile";
import { hashPin } from "@/lib/owner/pin";
import { sectorById } from "@/lib/rebirth/sectors";
import { buildProfile, CreateRequestSchema, LIMITS, MAX_CREATE_BODY_BYTES, profileIssues, TRIAL_DAYS } from "@/lib/rebirth/draft";
import type { TrialStore, WizardLimiter } from "@/lib/rebirth/ports";
import { randomSuffix, slugCandidates, slugify } from "@/lib/rebirth/slug";
import { readBodyLimited } from "../body";

/**
 * POST /api/nacer/create: makes a trial shop from the wizard's draft (BACKLOG 16).
 * 400 invalid (with `issues`: path + code), 409 the name is taken, 413 body too big, 429 rate
 * limited (3 per visitor and 50 in all per day), 503 the store failed, 201 `{ ok, shopId,
 * callPath, machinePath, expiresAt }`. It only ever inserts: an existing shop is never updated.
 * The PIN is hashed with the machine's scrypt and never logged or returned.
 */
export interface CreateHandlerOptions {
  store: () => TrialStore;
  limiter: () => WizardLimiter;
  clock: () => Temporal.Instant;
  salt: () => string;
  /** Random bytes for slug suffixes; tests pass fixed ones. */
  random?: (n: number) => Uint8Array;
  hash?: (pin: string) => Promise<string>;
}

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const issuesOf = (error: z.ZodError) => error.issues.map((i) => ({ path: i.path.map(String).join("."), code: i.message }));
const SUFFIX_TRIES = 5;

export function makeCreateHandler(opts: CreateHandlerOptions): (request: Request) => Promise<Response> {
  const random = opts.random ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const hash = opts.hash ?? hashPin;
  return async function POST(request: Request): Promise<Response> {
    const bytes = await readBodyLimited(request, MAX_CREATE_BODY_BYTES);
    if (bytes === null) return json({ error: "too_large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ error: "invalid_request", issues: [{ path: "", code: "invalid_json" }] }, 400);
    }
    const parsed = CreateRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: "invalid_request", issues: issuesOf(parsed.error) }, 400);
    const { draft, pin } = parsed.data;

    if (!sectorById(draft.sectorId)) return json({ error: "invalid_request", issues: [{ path: "sectorId", code: "unknown_sector" }] }, 400);
    const base = slugify(draft.business.name);
    // The whole profile through the same schema every shop is read with.
    const issues = profileIssues(draft, base);
    if (issues.length > 0) return json({ error: "invalid_request", issues }, 400);

    try {
      const now = opts.clock();
      const key = visitorKeyOf(request.headers.get("x-forwarded-for"), opts.salt());
      const counts = await opts.limiter().hit("create", key, now);
      const limit = LIMITS.create;
      if (counts.visitor > limit.perVisitorPerDay || counts.day > limit.globalPerDay) return json({ error: "rate_limited" }, 429);

      const pinHash = await hash(pin);
      const expiresAt = now.add({ hours: TRIAL_DAYS * 24 });
      const suffixes = Array.from({ length: SUFFIX_TRIES }, () => randomSuffix(random(4)));
      const result = await opts.store().createShop({
        name: draft.business.name,
        candidates: slugCandidates(base, suffixes),
        buildProfile: (id): ShopProfile => ShopProfileSchema.parse(buildProfile(draft, id)),
        pinHash,
        now,
        expiresAt,
      });
      if (!result.ok) return json({ error: result.reason }, result.reason === "name_taken" ? 409 : 503);
      const id = encodeURIComponent(result.shopId);
      return json(
        { ok: true, shopId: result.shopId, callPath: `/call/${id}`, machinePath: `/machine/${id}`, expiresAt: expiresAt.toString() },
        201,
      );
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  };
}

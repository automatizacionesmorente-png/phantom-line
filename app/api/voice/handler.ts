import { isCacheKey } from "@/lib/receptionist/voiceCacheKey";
import { shouldTouch, type VoiceCacheStore } from "@/lib/receptionist/voiceCacheBudget";

/**
 * GET /api/voice/[key]: one stored line of Neural_Voice audio (natural-voice design.md, "Serving").
 * The key is content-addressed, so a hit never changes: it is sent with a one-year immutable
 * Cache-Control and the CDN serves repeat plays. Kept out of route.ts so tests can build it with
 * PGlite.
 */

/** The bytes under a key never change, so browsers and the CDN may keep them for a year. */
export const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";
/** A miss may become a hit once the line is synthesized, so it is cached briefly. */
export const MISS_CACHE = "public, max-age=60, s-maxage=60";

export interface VoiceDeps {
  store: Pick<VoiceCacheStore, "get" | "touch">;
  nowMs: () => number;
}

export interface VoiceHandlerOptions {
  /** Built on first use, so `next build` needs no DATABASE_URL. */
  deps: () => VoiceDeps;
  /** Runs work after the response (`after` from next/server in production). */
  schedule: (task: () => Promise<void>) => void;
}

export type VoiceContext = { params: Promise<{ key: string }> };

const notFound = () => Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": MISS_CACHE } });

export function makeVoiceHandler(opts: VoiceHandlerOptions): (request: Request, ctx: VoiceContext) => Promise<Response> {
  return async function GET(_request: Request, ctx: VoiceContext): Promise<Response> {
    const { key } = await ctx.params;
    // A malformed key never reaches the database.
    if (!isCacheKey(key)) return notFound();
    let deps: VoiceDeps;
    let hit;
    try {
      deps = opts.deps();
      hit = await deps.store.get(key);
    } catch (err) {
      console.error("voice cache read failed:", (err as Error)?.name ?? "error");
      return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    if (!hit) return notFound();
    const nowMs = deps.nowMs();
    if (shouldTouch(hit.lastUsedAtMs, nowMs)) {
      const store = deps.store;
      opts.schedule(() => store.touch(key, nowMs).catch(() => undefined));
    }
    return new Response(hit.bytes as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        "content-type": hit.mime,
        "content-length": String(hit.bytes.byteLength),
        "cache-control": IMMUTABLE,
      },
    });
  };
}

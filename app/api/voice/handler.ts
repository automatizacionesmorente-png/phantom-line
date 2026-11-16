import { isCacheKey } from "@/lib/receptionist/voiceCacheKey";
import { shouldTouch, type VoiceCacheStore } from "@/lib/receptionist/voiceCacheBudget";

/**
 * GET /api/voice/[key]: one stored line of Neural_Voice audio (natural-voice design.md, "Serving").
 * The key is content-addressed, so a hit never changes: it is sent with a one-year immutable
 * Cache-Control and the CDN serves repeat plays. Kept out of route.ts so tests can build it with
 * PGlite.
 */

/**
 * The bytes under a key never change, so the browser may keep them for a year. The CDN may not:
 * once Vercel's CDN held a full 200 it answered Safari's `Range: bytes=0-1` probe with that 200,
 * and Safari refused to play it (2026-11-16). So only the browser caches, and every Range reaches
 * this handler.
 */
export const IMMUTABLE = "private, max-age=31536000, immutable";
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
  return async function GET(request: Request, ctx: VoiceContext): Promise<Response> {
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
    const bytes = hit.bytes as Uint8Array<ArrayBuffer>;
    const base = { "content-type": hit.mime, "cache-control": IMMUTABLE, "accept-ranges": "bytes" };
    const range = parseRange(request.headers.get("range"), bytes.byteLength);
    if (range === "unsatisfiable") {
      return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${bytes.byteLength}` } });
    }
    if (range) {
      const [start, end] = range;
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { ...base, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${bytes.byteLength}` },
      });
    }
    return new Response(bytes, { status: 200, headers: { ...base, "content-length": String(bytes.byteLength) } });
  };
}

/**
 * One `Range: bytes=…` request (RFC 9110 14.1.2): `start-end`, `start-` or `-suffix`, as inclusive
 * offsets clamped to the body. Safari's <audio> asks for `bytes=0-1` first and refuses to play a
 * body sent without 206 (found on the owner's calls, 2026-11-16). Several ranges, or anything
 * malformed, are ignored and the whole body is sent, as the RFC allows.
 */
export function parseRange(header: string | null, size: number): [number, number] | "unsatisfiable" | null {
  const m = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return [Math.max(0, size - suffix), size - 1];
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return [start, end];
}

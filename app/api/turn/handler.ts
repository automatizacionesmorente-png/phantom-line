import type { Temporal } from "temporal-polyfill";
import type { z } from "zod";
import { firstIp, visitorKeyOf } from "../visitorKey";
import { CallNotFoundError, handleTurn, sweep } from "@/lib/conversation/handleTurn";
import { consoleFallbackLogger, summarizeError, type FallbackLogEvent } from "@/lib/conversation/fallbackLog";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { CoreDeps, TurnInput, TurnOutput } from "@/lib/conversation/types";
import { phrases } from "@/lib/receptionist/phrases";
import { signSpeech } from "@/lib/receptionist/speechToken";
import { lineKeys, type VoiceFor } from "@/lib/receptionist/voiceCacheKey";
import type { VoiceCacheStore } from "@/lib/receptionist/voiceCacheBudget";
import { resolveVoiceProfile } from "@/lib/receptionist/voiceProfile";
import { getSectorPack } from "@/lib/sectors";
import { MAX_SPEECH_TEXT, type TurnResponse } from "@/lib/voice/speechRequest";
import { TurnRequestSchema } from "@/lib/voice/turnRequest";

/**
 * The voice Channel adapter (Requirement 10.2). It only identifies the sender,
 * validates the payload, loads the Shop and calls the Conversation_Core.
 * Kept out of route.ts so tests can build it with fakes: a route file may
 * export only HTTP methods and segment config.
 */
export interface TurnHandlerOptions {
  /** Builds the dependencies on first use, so `next build` needs no DATABASE_URL or key. */
  deps: () => CoreDeps;
  /** Runs work after the response (`after` from next/server in production). */
  schedule: (task: () => Promise<void>) => void;
  /** Salt for the hashed visitor key, read per request. */
  salt: () => string;
  /**
   * SPEECH_TOKEN_SECRET, read per request. When it is missing or empty, replies carry no
   * `speech` hint and the Call_Page speaks them with the browser voice.
   */
  speechSecret?: () => string | undefined;
  /**
   * The voice cache, built on first use. When it is missing, or its lookup fails, every reply
   * gets a live hint, as before the cache existed.
   */
  voiceCache?: () => VoiceCacheLookup;
}

/** What /api/turn needs to find a reply's stored audio: the store, the TTS models in order, and their voices. */
export interface VoiceCacheLookup {
  store: Pick<VoiceCacheStore, "findKeys">;
  /** GEMINI_TTS_MODEL, in order. */
  models: readonly string[];
  voiceFor: VoiceFor;
}

/** The URL a cached line is served from (app/api/voice/[key]/route.ts). */
/**
 * `?r=2`: audio sent before 2026-11-16 was cached by browsers for a year as a whole 200, which
 * Safari cannot play (no Range support then). A new URL makes every browser fetch it again.
 */
export const voiceUrl = (key: string) => `/api/voice/${key}?r=2`;

/**
 * The adapter's `speech` hint for a reply (natural-voice 8.5 and 9.4). A cacheable reply whose
 * audio is stored, under the key of any model that speaks with the primary voice (in
 * GEMINI_TTS_MODEL order), gets `{ kind: "cached", url, rate }`, and the browser fetches the
 * file with no TTS request. Every other reply gets `{ kind: "live", token, rate }`: a token that
 * binds the shop, the language, the exact text and whether its audio may be cached. A line with
 * a name or a phone, or the model's own text, is never looked up, so it is always live.
 */
export async function speechFor(
  out: TurnOutput,
  shop: ShopProfile,
  secret: string | undefined,
  now: Temporal.Instant,
  cache: VoiceCacheLookup | undefined,
): Promise<TurnResponse> {
  if (!secret || !out.reply || out.reply.length > MAX_SPEECH_TEXT) return out;
  if (out.cacheable && cache) {
    try {
      const profile = resolveVoiceProfile(getSectorPack(shop.sectorPackId), shop, out.language);
      const keys = lineKeys(out.reply, profile, cache.models, cache.voiceFor);
      const found = keys.length > 0 ? await cache.store.findKeys(keys.map((k) => k.key)) : new Set<string>();
      const hit = keys.find((k) => found.has(k.key));
      if (hit) return { ...out, speech: { kind: "cached", url: voiceUrl(hit.key), rate: shop.speechRate } };
    } catch (err) {
      // The cache is an optimisation: a failed lookup means a live line, never a failed Turn.
      console.error("voice cache lookup failed:", (err as Error)?.name ?? "error");
    }
  }
  return withSpeech(out, shop, secret, now);
}

/**
 * The adapter's `speech` hint for a reply (natural-voice 8.5): a token that binds the shop, the
 * language, the exact text and whether its audio may be cached, and the shop's playback rate.
 */
export function withSpeech(out: TurnOutput, shop: ShopProfile, secret: string | undefined, now: Temporal.Instant): TurnResponse {
  if (!secret || !out.reply || out.reply.length > MAX_SPEECH_TEXT) return out;
  const token = signSpeech(
    { shopId: shop.id, language: out.language, text: out.reply, cacheable: out.cacheable },
    secret,
    now.epochMilliseconds,
  );
  return { ...out, speech: { kind: "live", token, rate: shop.speechRate } };
}

export interface Issue {
  path: string;
  message: string;
  /** For unknown keys: the keys that are not allowed. */
  keys?: string[];
}

/** Used when the Shop could not be loaded, so its own phrases are not available. */
const GENERIC_UNAVAILABLE = {
  es: "Perdona, ahora mismo la línea no funciona. Vuelve a llamar en unos minutos.",
  en: "Sorry, the line isn't working right now. Please call again in a few minutes.",
} as const;

// Moved to app/api/visitorKey.ts (owner-machine 10.1), shared with the Machine_API. Re-exported so
// the speech adapter and its tests keep importing them from here.
export { firstIp, visitorKeyOf };

export function toIssues(error: z.ZodError): Issue[] {
  return error.issues.map((i) => ({
    path: i.path.map(String).join("."),
    message: i.message,
    ...(i.code === "unrecognized_keys" ? { keys: i.keys } : {}),
  }));
}

const json = (body: unknown, status: number) => Response.json(body, { status });

export function makeTurnHandler(opts: TurnHandlerOptions): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_request", issues: [{ path: "", message: "The body is not valid JSON" }] }, 400);
    }
    const parsed = TurnRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: "invalid_request", issues: toIssues(parsed.error) }, 400);
    const req = parsed.data;
    const lang = req.kind === "hangup" ? "es" : req.language;

    let deps: CoreDeps;
    let shop;
    try {
      deps = opts.deps();
      shop = await deps.repo.getShop(req.shopId);
    } catch (err) {
      // No deps (or no logger) yet if building them failed, so this one goes straight to stderr.
      consoleFallbackLogger({
        event: "turn_fallback",
        path: "http_503",
        reason: "exception",
        shopId: req.shopId,
        error: summarizeError(err),
      });
      return json({ error: "unavailable", reply: GENERIC_UNAVAILABLE[lang] }, 503);
    }
    if (!shop) return json({ error: "shop_not_found" }, 404);

    const channel = "voice" as const;
    const visitorKey = visitorKeyOf(request.headers.get("x-forwarded-for"), opts.salt());
    const input: TurnInput =
      req.kind === "start"
        ? { kind: "start", channel, shop, language: req.language, visitorKey }
        : req.kind === "say"
          ? {
              kind: "say",
              channel,
              shop,
              language: req.language,
              visitorKey,
              callId: req.callId,
              utterance: req.utterance,
              conversation: req.conversation,
            }
          : { kind: "hangup", channel, shop, callId: req.callId };

    const shopId = shop.id;
    const sweepDeps = deps;
    opts.schedule(() => sweep(shopId, sweepDeps));

    try {
      const out = await handleTurn(input, deps);
      let cache: VoiceCacheLookup | undefined;
      try {
        cache = opts.voiceCache?.();
      } catch {
        // No cache (for example no database URL for it): live lines only.
      }
      return json(await speechFor(out, shop, opts.speechSecret?.(), deps.clock(), cache), 200);
    } catch (err) {
      if (err instanceof CallNotFoundError) return json({ error: "call_not_found" }, 404);
      const event: FallbackLogEvent = {
        event: "turn_fallback",
        path: "http_503",
        reason: "exception",
        shopId: shop.id,
        ...(req.kind !== "start" ? { callId: req.callId } : {}),
        error: summarizeError(err),
      };
      try {
        (deps.logFallback ?? consoleFallbackLogger)(event);
      } catch {
        // Logging must never change the response.
      }
      const reply = phrases(req.kind === "hangup" ? shop.languages[0] : lang, getSectorPack(shop.sectorPackId), shop).fallbackEnd().text;
      return json({ error: "unavailable", reply }, 503);
    }
  };
}

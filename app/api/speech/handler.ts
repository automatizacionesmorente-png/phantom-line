import type { Temporal } from "temporal-polyfill";
import {
  consoleTtsFallbackLogger,
  ttsErrorFields,
  type TtsFallbackLogEvent,
  type TtsFallbackLogger,
} from "@/lib/conversation/fallbackLog";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import {
  checkTtsLimits,
  exhaustedNow,
  modelsToTry,
  nextQuotaReset,
  type TtsCounts,
  type TtsLimitConfig,
  type TtsLimitStore,
} from "@/lib/conversation/ttsLimits";
import { verifySpeech } from "@/lib/receptionist/speechToken";
import type { TtsChunk, TtsClient } from "@/lib/receptionist/ttsClient";
import { cacheKey } from "@/lib/receptionist/voiceCacheKey";
import {
  consoleCacheWriteLogger,
  DEFAULT_VOICE_CACHE_MAX_BYTES,
  errorClassOf,
  pcmDurationMs,
  wavFromPcm,
  type CacheWriteFailedEvent,
  type VoiceCacheStore,
} from "@/lib/receptionist/voiceCacheBudget";
import { resolveVoiceProfile } from "@/lib/receptionist/voiceProfile";
import { getSectorPack } from "@/lib/sectors";
import { pcmContentType, SpeechRequestSchema, type SpeechRequest } from "@/lib/voice/speechRequest";
import { toIssues, visitorKeyOf } from "@/app/api/turn/handler";

/**
 * POST /api/speech: the voice adapter for audio (natural-voice design.md, "/api/speech contract").
 * Thin: it validates the body, checks the speech token and the TTS limits, picks a model that is
 * not exhausted, and forwards the model's PCM chunks as they arrive. Kept out of route.ts so tests
 * can build it with fakes.
 *
 * Every status is decided before the first chunk is sent: 400 invalid, 403 token, 404 shop,
 * 429 {fallback: "quota" | "rate_limit"}, 503 {fallback: "unavailable"}. An error after the first
 * chunk ends the body early, and the browser sees a stall.
 */

/** The server's own cap on the first audio, above the browser's 2.5 s deadline, for an SDK that ignores the abort. */
export const TTS_FIRST_AUDIO_TIMEOUT_MS = 6_000;
/** The longest one reply may stream (the spike capped calls at 30 s). */
export const TTS_STREAM_TIMEOUT_MS = 30_000;

export interface SpeechDeps {
  tts: TtsClient;
  limits: TtsLimitStore;
  getShop(id: string): Promise<ShopProfile | null>;
  clock: () => Temporal.Instant;
  config: TtsLimitConfig;
  /** SPEECH_TOKEN_SECRET. Empty means the neural voice is off: every `say` gets 503. */
  secret: string;
  /** Only to scrub error messages; the TTS client already redacts it. */
  apiKey?: string;
  /** Models this process saw answer 429, with the epoch ms when they may be asked again. */
  exhausted: Map<string, number>;
  log?: TtsFallbackLogger;
  firstAudioTimeoutMs?: number;
  streamTimeoutMs?: number;
  /**
   * The voice cache (task 9.6). When set, a live line whose token says `cacheable`, spoken with the
   * profile's primary voice, is stored after its stream ends cleanly, then the cache is evicted
   * down to `cacheMaxBytes`.
   */
  voiceCache?: Pick<VoiceCacheStore, "insert" | "evict">;
  cacheMaxBytes?: number;
  logCacheWrite?: (event: CacheWriteFailedEvent) => void;
}

export interface SpeechHandlerOptions {
  /** Built on first use, so `next build` needs no DATABASE_URL, key or secret. */
  deps: () => SpeechDeps;
  /** Runs work after the response (`after` from next/server in production). */
  schedule: (task: () => Promise<void>) => void;
  /** Salt for the hashed visitor key, read per request. */
  salt: () => string;
}

const json = (body: unknown, status: number) => Response.json(body, { status });

const REPORT_REASON = {
  deadline: "timeout",
  stall: "stall",
  playback_error: "playback_error",
  network: "network",
} as const satisfies Record<Extract<SpeechRequest, { kind: "report" }>["reason"], TtsFallbackLogEvent["reason"]>;

export function makeSpeechHandler(opts: SpeechHandlerOptions): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const startedMs = Date.now();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_request", issues: [{ path: "", message: "The body is not valid JSON" }] }, 400);
    }
    const parsed = SpeechRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: "invalid_request", issues: toIssues(parsed.error) }, 400);
    const req = parsed.data;

    let deps: SpeechDeps;
    try {
      deps = opts.deps();
    } catch (err) {
      // Building the deps failed (no key, no database URL), so there is no logger yet either.
      consoleTtsFallbackLogger({
        event: "tts_fallback",
        source: "server",
        reason: "unavailable",
        shopId: req.shopId,
        language: req.language,
        fixed: req.kind === "report" ? req.fixed : false,
        ...ttsErrorFields(err, {}),
        latencyMs: Date.now() - startedMs,
      });
      return json({ fallback: "unavailable" }, 503);
    }
    const log = (event: Omit<TtsFallbackLogEvent, "event" | "latencyMs">) => {
      try {
        (deps.log ?? consoleTtsFallbackLogger)({ event: "tts_fallback", ...event, latencyMs: Date.now() - startedMs });
      } catch {
        // Logging must never change the response.
      }
    };
    const visitorKey = visitorKeyOf(request.headers.get("x-forwarded-for"), opts.salt());

    if (req.kind === "report") return report(req, deps, visitorKey);
    return say(req, deps, request, visitorKey, log, opts.schedule);
  };
}

type Log = (event: Omit<TtsFallbackLogEvent, "event" | "latencyMs">) => void;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

async function report(
  req: Extract<SpeechRequest, { kind: "report" }>,
  deps: SpeechDeps,
  visitorKey: string,
): Promise<Response> {
  let count = 0;
  try {
    count = await deps.limits.hitReport(visitorKey, deps.clock());
  } catch {
    // The counter failed (database down): limits fail open, as for Turns.
  }
  if (count > deps.config.perVisitorPerMinute) return json({ fallback: "rate_limit" }, 429);
  try {
    (deps.log ?? consoleTtsFallbackLogger)({
      event: "tts_fallback",
      source: "browser",
      reason: REPORT_REASON[req.reason],
      shopId: req.shopId,
      language: req.language,
      fixed: req.fixed,
      // The browser's own measurement: from having the reply text to giving up on the neural voice.
      latencyMs: req.latencyMs,
    });
  } catch {
    // Logging must never change the response.
  }
  return new Response(null, { status: 204 });
}

async function say(
  req: Extract<SpeechRequest, { kind: "say" }>,
  deps: SpeechDeps,
  request: Request,
  visitorKey: string,
  log: Log,
  schedule: SpeechHandlerOptions["schedule"],
): Promise<Response> {
  const now = deps.clock();
  const where = { shopId: req.shopId, language: req.language };
  const secrets = { apiKey: deps.apiKey, text: req.text, token: req.token, visitorKey };

  if (!deps.secret) {
    log({ source: "server", reason: "unavailable", ...where, fixed: false, errorClass: "NoSpeechSecret" });
    return json({ fallback: "unavailable" }, 503);
  }
  const verdict = verifySpeech(req.token, { shopId: req.shopId, language: req.language, text: req.text }, deps.secret, now.epochMilliseconds);
  if (!verdict.ok) {
    log({ source: "server", reason: "token", ...where, fixed: false, status: 403, errorClass: `token_${verdict.reason}` });
    return json({ error: "forbidden" }, 403);
  }
  const fixed = verdict.cacheable;

  let shop: ShopProfile | null;
  let hit: { counts: TtsCounts; exhausted: string[] } | null = null;
  try {
    [shop, hit] = await Promise.all([
      deps.getShop(req.shopId),
      // If the counter itself fails, limits fail open and only this process's marks are used.
      deps.limits.hitSay(visitorKey, now).catch(() => null),
    ]);
  } catch (err) {
    log({ source: "server", reason: "unavailable", ...where, fixed, ...ttsErrorFields(err, secrets) });
    return json({ fallback: "unavailable" }, 503);
  }
  if (!shop) return json({ error: "shop_not_found" }, 404);

  if (hit) {
    const limited = checkTtsLimits(hit.counts, deps.config);
    if (limited.blocked) {
      log({ source: "server", reason: "rate_limit", ...where, fixed, limit: limited.limit, status: 429 });
      return json({ fallback: "rate_limit" }, 429);
    }
  }

  const exhausted = exhaustedNow(deps.exhausted, hit?.exhausted ?? [], now);
  let profile;
  try {
    profile = resolveVoiceProfile(getSectorPack(shop.sectorPackId), shop, req.language);
  } catch (err) {
    log({ source: "server", reason: "unavailable", ...where, fixed, ...ttsErrorFields(err, secrets) });
    return json({ fallback: "unavailable" }, 503);
  }

  for (const model of modelsToTry(deps.tts.models, exhausted)) {
    const ctrl = new AbortController();
    const onClientAbort = () => ctrl.abort(request.signal.reason);
    request.signal.addEventListener("abort", onClientAbort, { once: true });
    let timedOut = false;
    const firstTimer = setTimeout(() => {
      timedOut = true;
      ctrl.abort(new DOMException("No first audio in time", "TimeoutError"));
    }, deps.firstAudioTimeoutMs ?? TTS_FIRST_AUDIO_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(firstTimer);
      request.signal.removeEventListener("abort", onClientAbort);
    };

    const it = deps.tts.stream({ text: req.text, profile, model, signal: ctrl.signal })[Symbol.asyncIterator]();
    let first: IteratorResult<TtsChunk>;
    try {
      first = await it.next();
    } catch (err) {
      cleanup();
      const fields = ttsErrorFields(err, secrets);
      if (fields.status === 429) {
        // That model's daily bucket is empty: mark it until midnight Pacific and move on at once to
        // the next model, a different bucket. Never the same model again (Requirement 4.4).
        const until = nextQuotaReset(now);
        deps.exhausted.set(model, until.epochMilliseconds);
        exhausted.add(model);
        schedule(() => deps.limits.markExhausted(model, until).catch(() => undefined));
        continue;
      }
      // A 5xx, a 400, a network error or the server's own deadline: no retry, the browser speaks.
      // When the browser itself gave up (its 2.5 s deadline), it reports that, so nothing is logged here.
      if (!request.signal.aborted) {
        log({ source: "server", reason: timedOut ? "timeout" : "unavailable", ...where, fixed, model, ...fields });
      }
      return json({ fallback: "unavailable" }, 503);
    }
    clearTimeout(firstTimer);
    if (first.done) {
      cleanup();
      log({ source: "server", reason: "unavailable", ...where, fixed, model, errorClass: "NoAudio" });
      return json({ fallback: "unavailable" }, 503);
    }

    /** Tells the cache write whether the stream ended cleanly; a no-op when nothing is kept. */
    let settleCache: (clean: boolean) => void = () => undefined;
    const streamTimer = setTimeout(() => {
      settleCache(false);
      ctrl.abort(new DOMException("The stream ran too long", "TimeoutError"));
    }, deps.streamTimeoutMs ?? TTS_STREAM_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(streamTimer);
      cleanup();
    };
    const firstChunk = first.value;

    // The voice cache: only a line signed cacheable, spoken with the primary voice, and only once
    // its stream has ended cleanly. An aborted, stalled or cut stream is never stored.
    const store = deps.voiceCache;
    const voiceUsed = deps.tts.voiceFor(model, profile);
    const keep = fixed && store !== undefined && voiceUsed === profile.voice;
    const kept: Uint8Array[] = keep ? [firstChunk.pcm] : [];
    if (keep) {
      const ended = new Promise<boolean>((resolve) => {
        let done = false;
        settleCache = (clean) => {
          if (!done) {
            done = true;
            resolve(clean);
          }
        };
      });
      const key = cacheKey(model, voiceUsed, profile.style, profile.languageCode, req.text);
      const sampleRate = firstChunk.sampleRate;
      const logWrite = deps.logCacheWrite ?? consoleCacheWriteLogger;
      schedule(async () => {
        if (!(await ended)) return;
        try {
          const pcm = concat(kept);
          await store.insert({
            key,
            shopId: req.shopId,
            language: req.language,
            model,
            mime: "audio/wav",
            bytes: wavFromPcm(pcm, sampleRate),
            durationMs: pcmDurationMs(pcm.byteLength, sampleRate),
            source: "live",
            pinned: false,
          });
          await store.evict(deps.cacheMaxBytes ?? DEFAULT_VOICE_CACHE_MAX_BYTES);
        } catch (err) {
          try {
            logWrite({ event: "voice_cache_write_failed", key, errorClass: errorClassOf(err) });
          } catch {
            // Logging must never throw out of after().
          }
        }
      });
    }

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(firstChunk.pcm);
      },
      async pull(controller) {
        try {
          const next = await it.next();
          if (next.done) {
            finish();
            controller.close();
            settleCache(true);
          } else {
            if (keep) kept.push(next.value.pcm);
            controller.enqueue(next.value.pcm);
          }
        } catch (err) {
          finish();
          settleCache(false);
          if (!request.signal.aborted) {
            log({ source: "server", reason: "unavailable", ...where, fixed, model, ...ttsErrorFields(err, secrets) });
          }
          // The status is already sent: end the body early, and the browser sees a stall.
          controller.close();
        }
      },
      cancel() {
        finish();
        settleCache(false);
        ctrl.abort(new DOMException("The browser closed the stream", "AbortError"));
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": pcmContentType(firstChunk.sampleRate), "cache-control": "no-store" },
    });
  }

  // Every configured model is exhausted for today: the browser voice for the rest of the Call.
  log({ source: "server", reason: "quota", ...where, fixed, status: 429, exhaustedModels: [...exhausted].sort() });
  return json({ fallback: "quota" }, 429);
}

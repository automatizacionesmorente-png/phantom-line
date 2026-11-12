import { createHash } from "node:crypto";
import type { z } from "zod";
import { CallNotFoundError, handleTurn, sweep } from "@/lib/conversation/handleTurn";
import type { CoreDeps, TurnInput } from "@/lib/conversation/types";
import { phrases } from "@/lib/receptionist/phrases";
import { getSectorPack } from "@/lib/sectors";
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

/** The first address of `x-forwarded-for` (Vercel overwrites the header, so it cannot be spoofed there). */
export function firstIp(forwardedFor: string | null): string {
  const ip = forwardedFor?.split(",")[0]?.trim();
  return ip ? ip : "unknown";
}

/** sha256(salt + ip). The raw IP is never stored. */
export function visitorKeyOf(forwardedFor: string | null, salt: string): string {
  return createHash("sha256").update(salt + firstIp(forwardedFor)).digest("hex");
}

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
      console.error("turn: shop lookup failed:", (err as Error)?.name ?? "error");
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
      return json(await handleTurn(input, deps), 200);
    } catch (err) {
      if (err instanceof CallNotFoundError) return json({ error: "call_not_found" }, 404);
      console.error("turn failed:", (err as Error)?.name ?? "error");
      const reply = phrases(req.kind === "hangup" ? shop.languages[0] : lang, getSectorPack(shop.sectorPackId), shop).fallbackEnd();
      return json({ error: "unavailable", reply }, 503);
    }
  };
}

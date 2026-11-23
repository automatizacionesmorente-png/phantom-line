import type { z } from "zod";
import { ClientActionSchema } from "@/lib/clients/api";
import { summarizeError } from "@/lib/conversation/fallbackLog";
import {
  BookingActionSchema,
  LoginRequestSchema,
  MessageActionSchema,
  PollQuerySchema,
  SlotsQuerySchema,
  type MachineErrorBody,
} from "@/lib/owner/api";
import {
  handleBookingAction,
  handleClientAction,
  handleClients,
  handleLogin,
  handleMessageAction,
  handlePoll,
  handleSlots,
  type OwnerDeps,
  type OwnerResult,
} from "@/lib/owner/handleOwner";
import { SESSION_COOKIE } from "@/lib/owner/session";
import { consoleOwnerLogger } from "@/lib/owner/types";
import { visitorKeyOf } from "../visitorKey";

/**
 * The Machine_API as testable handlers (owner-machine design, "Request checks for every
 * Machine_API handler"). The route files only unwrap `params` and call these, as
 * app/api/turn/route.ts does for the Turn_API. Everything that is not HTTP lives in
 * lib/owner/handleOwner.ts.
 *
 * Every response, errors and 204s included, carries `Cache-Control: no-store` (12.8), and no
 * body ever holds the PIN, its hash, the session secret or the token (14.3).
 */
export interface MachineHandlerOptions {
  /** Builds the dependencies on first use, so `next build` needs no DATABASE_URL. */
  owner: () => OwnerDeps;
  /** RATE_LIMIT_SALT, read per request: the same Visitor key as the Turn_API. */
  salt: () => string;
}

export interface ShopParams {
  shopId: string;
}
export interface MessageParams extends ShopParams {
  messageId: string;
}
export interface BookingParams extends ShopParams {
  bookingId: string;
}
export interface ClientParams extends ShopParams {
  clientId: string;
}

type Handler<P> = (request: Request, params: P) => Promise<Response>;

export interface MachineHandlers {
  /** POST /api/machine/[shopId]/session */
  login: Handler<ShopParams>;
  /** DELETE /api/machine/[shopId]/session */
  logout: Handler<ShopParams>;
  /** GET /api/machine/[shopId] */
  poll: Handler<ShopParams>;
  /** POST /api/machine/[shopId]/messages/[messageId] */
  message: Handler<MessageParams>;
  /** POST /api/machine/[shopId]/bookings/[bookingId] */
  booking: Handler<BookingParams>;
  /** GET /api/machine/[shopId]/bookings/[bookingId]/slots */
  slots: Handler<BookingParams>;
  /** GET /api/machine/[shopId]/clients */
  clients: Handler<ShopParams>;
  /** POST /api/machine/[shopId]/clients/[clientId] */
  client: Handler<ClientParams>;
}

const NO_STORE = "no-store";
/** Nothing the Machine_API accepts is larger than a few hundred bytes. */
const MAX_BODY_CHARS = 4096;

const json = (body: MachineErrorBody | object, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": NO_STORE, ...extra },
  });
const empty = (status: number, extra: Record<string, string> = {}) =>
  new Response(null, { status, headers: { "cache-control": NO_STORE, ...extra } });

/** The cookie as the browser must store it (1.4): `__Host-` needs Secure, Path=/ and no Domain. */
const cookieAttributes = "Path=/; HttpOnly; Secure; SameSite=Strict";
export const sessionCookie = (token: string, maxAgeSeconds: number) =>
  `${SESSION_COOKIE}=${token}; Max-Age=${maxAgeSeconds}; ${cookieAttributes}`;
export const clearedSessionCookie = () => `${SESSION_COOKIE}=; Max-Age=0; ${cookieAttributes}`;

/** The value of one cookie of the request, or undefined. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** A malformed escape in the URL is an unknown shop, not a server error (as the call page does). */
function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

const issuesOf = (error: z.ZodError) =>
  error.issues.map((i) => ({ path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)), message: i.message }));

const invalid = (message: string, status = 400) =>
  json({ error: "invalid_request", issues: [{ path: [], message }] } satisfies MachineErrorBody, status);

/** State-changing requests only come from the machine's own origin (1.10). `SameSite=Strict` is the second layer. */
function checkOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (origin === null || origin !== new URL(request.url).origin) return json({ error: "bad_origin" }, 403);
  return null;
}

function checkJson(request: Request): Response | null {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return type === "application/json" ? null : invalid("The content type must be application/json", 415);
}

/** Reads and validates a JSON body, or answers with the 400 / 415. */
async function readBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const wrongType = checkJson(request);
  if (wrongType) return { ok: false, response: wrongType };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: invalid("The body could not be read") };
  }
  if (text.length > MAX_BODY_CHARS) return { ok: false, response: invalid("The body is too large") };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, response: invalid("The body is not valid JSON") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: json({ error: "invalid_request", issues: issuesOf(parsed.error) }, 400) };
  }
  return { ok: true, data: parsed.data };
}

function readQuery<S extends z.ZodType>(
  request: Request,
  schema: S,
): { ok: true; data: z.infer<S> } | { ok: false; response: Response } {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return { ok: false, response: json({ error: "invalid_request", issues: issuesOf(parsed.error) }, 400) };
  }
  return { ok: true, data: parsed.data };
}

function respond<T extends object>(result: OwnerResult<T>, success: (body: T) => Response): Response {
  if (result.ok) return success(result.body);
  return result.body === null ? empty(result.status) : json(result.body, result.status);
}

export function makeMachineHandlers(opts: MachineHandlerOptions): MachineHandlers {
  /**
   * Runs one route with its checks done. A failure that is not a normal answer (the database
   * is down) becomes `503 unavailable` and one `owner_error` line with the error's summary
   * only: no name, phone, reason, Transcript or token (14.4).
   */
  async function guarded(route: string, rawShopId: string, run: (shopId: string, deps: OwnerDeps) => Promise<Response>) {
    const shopId = safeDecode(rawShopId);
    if (shopId === null) return json({ error: "shop_not_found" }, 404);
    let deps: OwnerDeps | undefined;
    try {
      deps = opts.owner();
      return await run(shopId, deps);
    } catch (err) {
      try {
        (deps?.log ?? consoleOwnerLogger)({
          event: "owner_error",
          route,
          shopId: shopId.slice(0, 100),
          error: summarizeError(err),
        });
      } catch {
        // Logging must never change the response.
      }
      return json({ error: "unavailable" }, 503);
    }
  }

  return {
    async login(request, params) {
      const bad = checkOrigin(request);
      if (bad) return bad;
      const body = await readBody(request, LoginRequestSchema);
      if (!body.ok) return body.response;
      return guarded("session", params.shopId, async (shopId, deps) => {
        const result = await handleLogin(
          {
            shopId,
            pin: body.data.pin,
            label: body.data.label,
            visitorKey: visitorKeyOf(request.headers.get("x-forwarded-for"), opts.salt()),
          },
          deps,
        );
        return respond(result, (g) => empty(204, { "set-cookie": sessionCookie(g.token, g.maxAgeSeconds) }));
      });
    },

    async logout(request) {
      // Nothing is read: locking only clears this browser's cookie (1.9). The token itself
      // stays valid until it expires, as with any stateless session, so a stolen copy is
      // revoked by changing the PIN (1.8).
      const bad = checkOrigin(request);
      if (bad) return bad;
      return empty(204, { "set-cookie": clearedSessionCookie() });
    },

    async poll(request, params) {
      const query = readQuery(request, PollQuerySchema);
      if (!query.ok) return query.response;
      return guarded("poll", params.shopId, async (shopId, deps) =>
        respond(
          await handlePoll(
            { shopId, since: query.data.since ?? null, token: readCookie(request.headers.get("cookie"), SESSION_COOKIE) },
            deps,
          ),
          (b) => json(b, 200),
        ),
      );
    },

    async message(request, params) {
      const bad = checkOrigin(request);
      if (bad) return bad;
      const body = await readBody(request, MessageActionSchema);
      if (!body.ok) return body.response;
      return guarded("message", params.shopId, async (shopId, deps) =>
        respond(
          await handleMessageAction(
            {
              shopId,
              messageId: params.messageId,
              action: body.data.action,
              token: readCookie(request.headers.get("cookie"), SESSION_COOKIE),
            },
            deps,
          ),
          (b) => json(b, 200),
        ),
      );
    },

    async booking(request, params) {
      const bad = checkOrigin(request);
      if (bad) return bad;
      const body = await readBody(request, BookingActionSchema);
      if (!body.ok) return body.response;
      return guarded("booking", params.shopId, async (shopId, deps) =>
        respond(
          await handleBookingAction(
            {
              shopId,
              bookingId: params.bookingId,
              req: body.data,
              token: readCookie(request.headers.get("cookie"), SESSION_COOKIE),
            },
            deps,
          ),
          (b) => json(b, 200),
        ),
      );
    },

    async slots(request, params) {
      const query = readQuery(request, SlotsQuerySchema);
      if (!query.ok) return query.response;
      return guarded("slots", params.shopId, async (shopId, deps) =>
        respond(
          await handleSlots(
            {
              shopId,
              bookingId: params.bookingId,
              date: query.data.date,
              token: readCookie(request.headers.get("cookie"), SESSION_COOKIE),
            },
            deps,
          ),
          (b) => json(b, 200),
        ),
      );
    },

    async clients(request, params) {
      return guarded("clients", params.shopId, async (shopId, deps) =>
        respond(
          await handleClients({ shopId, token: readCookie(request.headers.get("cookie"), SESSION_COOKIE) }, deps),
          (b) => json(b, 200),
        ),
      );
    },

    async client(request, params) {
      const bad = checkOrigin(request);
      if (bad) return bad;
      const body = await readBody(request, ClientActionSchema);
      if (!body.ok) return body.response;
      return guarded("client", params.shopId, async (shopId, deps) =>
        respond(
          await handleClientAction(
            {
              shopId,
              clientId: params.clientId,
              req: body.data,
              token: readCookie(request.headers.get("cookie"), SESSION_COOKIE),
            },
            deps,
          ),
          (b) => json(b, 200),
        ),
      );
    },
  };
}

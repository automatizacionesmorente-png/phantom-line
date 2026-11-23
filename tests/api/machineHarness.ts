import { expect } from "vitest";
import { Temporal } from "temporal-polyfill";
import { makeMachineHandlers, type MachineHandlers } from "@/app/api/machine/handlers";
import { createSalonRepository } from "@/lib/db/salonRepository";
import type { SalonDeps } from "@/lib/salon/types";
import { DEFAULT_PIN_LIMITS } from "@/lib/owner/limits";
import { hashPin } from "@/lib/owner/pin";
import { SESSION_COOKIE, pinVersionOf, signSession, type SessionPayload } from "@/lib/owner/session";
import type { OwnerLogEvent, OwnerRepository } from "@/lib/owner/types";
import { lolaProfile } from "../fixtures/lola";
import { insertShop } from "../db/helpers";
import { ownerRepoOf, realProfile } from "../db/ownerFixtures";
import type { TestDb } from "../db/pglite";

/** Tuesday 10 November 2026, 09:00 in Madrid. */
export const CLOCK0 = Temporal.Instant.from("2026-11-10T08:00:00Z");
export const SECRET = "owner-session-secret-for-tests-0123456789";
export const PIN = "246810";
/** When the PIN was last set; sessions carry it as `pv`. */
export const PIN_SET_AT = Temporal.Instant.from("2026-11-01T00:00:00Z");
export const BASE = "http://localhost";
export const DEMO = lolaProfile.id;
export const REAL = realProfile.id;

let hashed: Promise<string> | undefined;
/** One scrypt hash for the whole file: hashing is deliberately slow. */
export const pinHash = () => (hashed ??= hashPin(PIN));

export interface MachineEnv {
  t: TestDb;
  deps: SalonDeps;
  handlers: MachineHandlers;
  logs: OwnerLogEvent[];
  /** How many times each Demo_Retention step of the repository was reached. */
  spy: { claims: number; cutoffs: number };
  now: () => Temporal.Instant;
  setNow(at: Temporal.Instant): void;
  /** The session secret the deps read; set to `undefined` to simulate a missing variable. */
  setSecret(secret: string | undefined): void;
}

/** The two shops (the Demo_Shop and a Real_Shop), each with the PIN `PIN`. */
export async function seedShops(t: TestDb): Promise<void> {
  await insertShop(t, lolaProfile);
  await insertShop(t, realProfile);
  const repo = ownerRepoOf(t);
  const hash = await pinHash();
  await repo.setOwnerPin(DEMO, hash, PIN_SET_AT);
  await repo.setOwnerPin(REAL, hash, PIN_SET_AT);
}

export function createMachineEnv(t: TestDb, over: Partial<SalonDeps> = {}): MachineEnv {
  let at = CLOCK0;
  let secret: string | undefined = SECRET;
  let n = 0;
  const logs: OwnerLogEvent[] = [];
  const spy = { claims: 0, cutoffs: 0 };
  const base: OwnerRepository = ownerRepoOf(t);
  const repo: OwnerRepository = {
    ...base,
    claimDemoRetention: (now) => {
      spy.claims++;
      return base.claimDemoRetention(now);
    },
    applyDemoCutoffs: (c) => {
      spy.cutoffs++;
      return base.applyDemoCutoffs(c);
    },
  };
  const deps: SalonDeps = {
    repo,
    salon: createSalonRepository(t.handle),
    core: t.repo,
    clock: () => at,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    secret: () => secret,
    pinLimits: DEFAULT_PIN_LIMITS,
    log: (e) => logs.push(e),
    ...over,
  };
  return {
    t,
    deps,
    handlers: makeMachineHandlers({ owner: () => deps, salt: () => "test-salt" }),
    logs,
    spy,
    now: () => at,
    setNow: (i) => {
      at = i;
    },
    setSecret: (s) => {
      secret = s;
    },
  };
}

/** A valid session token for `shopId`, as login would issue it, with any field overridden. */
export function tokenFor(shopId: string, over: Partial<SessionPayload> = {}, secret = SECRET, at = CLOCK0): string {
  const iat = Math.floor(at.epochMilliseconds / 1000);
  return signSession(
    { v: 1, shopId, sid: "c2Vzc2lvbi1pZC0xMjM0", label: "Lola", iat, exp: iat + 12 * 3600, pv: pinVersionOf(PIN_SET_AT), ...over },
    secret,
  );
}

export interface ReqOptions {
  body?: unknown;
  /** The session token to send as the cookie. */
  token?: string;
  /** Raw `Cookie` header, instead of `token`. */
  cookie?: string;
  /** `null` sends none; the default is this app's own origin. */
  origin?: string | null;
  contentType?: string | null;
  ip?: string;
  query?: string;
}

export function mreq(method: string, path: string, o: ReqOptions = {}): Request {
  const headers: Record<string, string> = { "x-forwarded-for": `${o.ip ?? "203.0.113.7"}, 10.0.0.1` };
  const writes = method !== "GET";
  if (writes && o.origin !== null) headers.origin = o.origin ?? BASE;
  if (o.contentType !== null && o.body !== undefined) headers["content-type"] = o.contentType ?? "application/json";
  if (o.cookie !== undefined) headers.cookie = o.cookie;
  else if (o.token !== undefined) headers.cookie = `${SESSION_COOKIE}=${o.token}`;
  return new Request(`${BASE}${path}${o.query ?? ""}`, {
    method,
    headers,
    body: o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body),
  });
}

/** What a test needs from a response. Every response must be `no-store` (12.8). */
export interface Answer {
  status: number;
  text: string;
  json: Record<string, unknown> | null;
  headers: Headers;
}

export async function answer(res: Response): Promise<Answer> {
  expect(res.headers.get("cache-control")).toBe("no-store");
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text === "" ? null : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

/** Every route of the Machine_API as a call that returns an Answer. */
export function client(h: MachineHandlers, seen: string[] = []) {
  const run = async (res: Promise<Response>) => {
    const a = await answer(await res);
    seen.push(a.text);
    return a;
  };
  return {
    seen,
    login: (shopId: string, body: unknown, o: ReqOptions = {}) =>
      run(h.login(mreq("POST", `/api/machine/${shopId}/session`, { body, ...o }), { shopId })),
    logout: (shopId: string, o: ReqOptions = {}) =>
      run(h.logout(mreq("DELETE", `/api/machine/${shopId}/session`, o), { shopId })),
    poll: (shopId: string, since: number | null, o: ReqOptions = {}) =>
      run(
        h.poll(mreq("GET", `/api/machine/${shopId}`, { ...o, query: since === null ? "" : `?since=${since}` }), { shopId }),
      ),
    message: (shopId: string, messageId: string, body: unknown, o: ReqOptions = {}) =>
      run(h.message(mreq("POST", `/api/machine/${shopId}/messages/${messageId}`, { body, ...o }), { shopId, messageId })),
    booking: (shopId: string, bookingId: string, body: unknown, o: ReqOptions = {}) =>
      run(h.booking(mreq("POST", `/api/machine/${shopId}/bookings/${bookingId}`, { body, ...o }), { shopId, bookingId })),
    clients: (shopId: string, o: ReqOptions = {}) =>
      run(h.clients(mreq("GET", `/api/machine/${shopId}/clients`, o), { shopId })),
    clientAction: (shopId: string, clientId: string, body: unknown, o: ReqOptions = {}) =>
      run(h.client(mreq("POST", `/api/machine/${shopId}/clients/${clientId}`, { body, ...o }), { shopId, clientId })),
    createBooking: (shopId: string, body: unknown, o: ReqOptions = {}) =>
      run(h.createBooking(mreq("POST", `/api/machine/${shopId}/bookings`, { body, ...o }), { shopId })),
    blocks: (shopId: string, o: ReqOptions = {}) => run(h.blocks(mreq("GET", `/api/machine/${shopId}/blocks`, o), { shopId })),
    createBlock: (shopId: string, body: unknown, o: ReqOptions = {}) =>
      run(h.createBlock(mreq("POST", `/api/machine/${shopId}/blocks`, { body, ...o }), { shopId })),
    deleteBlock: (shopId: string, blockId: string, o: ReqOptions = {}) =>
      run(h.deleteBlock(mreq("DELETE", `/api/machine/${shopId}/blocks/${blockId}`, o), { shopId, blockId })),
    pay: (shopId: string, bookingId: string, body: unknown, o: ReqOptions = {}) =>
      run(h.pay(mreq("POST", `/api/machine/${shopId}/bookings/${bookingId}/pay`, { body, ...o }), { shopId, bookingId })),
    note: (shopId: string, bookingId: string, body: unknown, o: ReqOptions = {}) =>
      run(h.note(mreq("POST", `/api/machine/${shopId}/bookings/${bookingId}/note`, { body, ...o }), { shopId, bookingId })),
    getNote: (shopId: string, bookingId: string, o: ReqOptions = {}) =>
      run(h.getNote(mreq("GET", `/api/machine/${shopId}/bookings/${bookingId}/note`, o), { shopId, bookingId })),
    sale: (shopId: string, body: unknown, o: ReqOptions = {}) =>
      run(h.sale(mreq("POST", `/api/machine/${shopId}/payments`, { body, ...o }), { shopId })),
    payments: (shopId: string, day: string, o: ReqOptions = {}) =>
      run(h.payments(mreq("GET", `/api/machine/${shopId}/payments`, { ...o, query: `?day=${day}` }), { shopId })),
    slots: (shopId: string, bookingId: string, date: string, o: ReqOptions = {}) =>
      run(
        h.slots(mreq("GET", `/api/machine/${shopId}/bookings/${bookingId}/slots`, { ...o, query: `?date=${date}` }), {
          shopId,
          bookingId,
        }),
      ),
  };
}

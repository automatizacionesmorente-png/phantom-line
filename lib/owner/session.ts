/**
 * The Owner_Session: a server-signed token in an HttpOnly cookie (Requirement 1.4, 1.8).
 * "v1.<b64url(json)>.<b64url(hmac-sha256)>", signed with OWNER_SESSION_SECRET.
 * `pv` is the Shop's owner_pin_set_at, so changing the PIN revokes every session. Pure.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Temporal } from "temporal-polyfill";
import { z } from "zod";
import type { Lang } from "@/lib/sectors";

/** `__Host-` forces Secure, Path=/ and no Domain. */
export const SESSION_COOKIE = "__Host-pl_owner";
export const SESSION_HOURS = 12;
/** OWNER_SESSION_SECRET shorter than this makes every session invalid and login refuse (503). */
export const MIN_SESSION_SECRET_LENGTH = 32;
export const LABEL_MAX = 30;

export interface SessionPayload {
  v: 1;
  shopId: string;
  /** 16 random bytes, base64url: the Actor's session id. */
  sid: string;
  /** normalizeLabel(input): 1–30 chars, no control characters, collapsed spaces. */
  label: string;
  /** Epoch seconds. */
  iat: number;
  /** iat + 12 h, epoch seconds. */
  exp: number;
  /** owner_pin_set_at in epoch seconds. */
  pv: number;
}

export type SessionFailure = "missing" | "malformed" | "bad_signature" | "expired" | "other_shop" | "pin_changed";
export type SessionCheck = { ok: true; session: SessionPayload } | { ok: false; reason: SessionFailure };

const PREFIX = "v1";
const B64URL = /^[A-Za-z0-9_-]+$/;

const PayloadSchema = z.strictObject({
  v: z.literal(1),
  shopId: z.string().min(1),
  sid: z.string().min(1),
  label: z.string().refine((s) => {
    const n = Array.from(s).length;
    return n >= 1 && n <= LABEL_MAX;
  }),
  iat: z.number().int(),
  exp: z.number().int(),
  pv: z.number().int(),
});

export function isUsableSessionSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SESSION_SECRET_LENGTH;
}

function mac(signedPart: string, secret: string): string {
  return createHmac("sha256", secret).update(signedPart).digest("base64url");
}

/** Epoch seconds of the PIN change, as stored in `pv`. */
export function pinVersionOf(pinSetAt: Temporal.Instant): number {
  return Math.floor(pinSetAt.epochMilliseconds / 1000);
}

export function signSession(p: SessionPayload, secret: string): string {
  if (!isUsableSessionSecret(secret)) throw new Error("OWNER_SESSION_SECRET is missing or too short");
  const body = Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
  const signed = `${PREFIX}.${body}`;
  return `${signed}.${mac(signed, secret)}`;
}

export function verifySession(
  token: string | undefined,
  secret: string,
  expect: { shopId: string; now: Temporal.Instant; pinSetAt: Temporal.Instant | null },
): SessionCheck {
  if (token === undefined || token === "") return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX || !B64URL.test(parts[1]) || !B64URL.test(parts[2])) {
    return { ok: false, reason: "malformed" };
  }
  if (!isUsableSessionSecret(secret)) return { ok: false, reason: "bad_signature" };

  // Compare the canonical text of the MAC, not decoded bytes: base64url decoding ignores the
  // spare low bits of the last character, so two different strings can decode to the same bytes.
  const expected = Buffer.from(mac(`${parts[0]}.${parts[1]}`, secret), "utf8");
  const given = Buffer.from(parts[2], "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const session: SessionPayload = parsed.data;

  if (session.shopId !== expect.shopId) return { ok: false, reason: "other_shop" };
  if (!(expect.now.epochMilliseconds < session.exp * 1000)) return { ok: false, reason: "expired" };
  if (expect.pinSetAt === null || session.pv !== pinVersionOf(expect.pinSetAt)) {
    return { ok: false, reason: "pin_changed" };
  }
  return { ok: true, session };
}

const DEFAULT_LABEL: Record<Lang, string> = { es: "Dueño", en: "Owner" };
// Control (Cc), format (Cf: zero-width, bidi overrides), and line/paragraph separators.
const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** The Actor's typed name: no control characters, spaces collapsed, at most 30 characters, a default when empty. */
export function normalizeLabel(raw: string | undefined, lang: Lang): string {
  const cleaned = (raw ?? "")
    .normalize("NFC")
    .replace(/[\t\n\r\v\f]/g, " ")
    .replace(CONTROL, "")
    .replace(/\s+/gu, " ")
    .trim();
  // Cut by code point so a surrogate pair is never split.
  const cut = Array.from(cleaned).slice(0, LABEL_MAX).join("").trim();
  return cut === "" ? DEFAULT_LABEL[lang] : cut;
}

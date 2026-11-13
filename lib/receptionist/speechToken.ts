import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Lang } from "@/lib/sectors/types";

/**
 * The speech token (natural-voice Requirement 1.4, design.md "Speech token"). The Turn_API signs
 * each reply it returns; `/api/speech` makes audio only for a text whose token verifies, so the
 * endpoint cannot be used as a free text-to-speech service.
 *
 *   token = base64url(exp) "." base64url(cacheable) "." base64url(HMAC-SHA256(secret, payload))
 *   payload binds the shop, the language, exp, cacheable and sha256(text)
 *
 * The payload is a JSON array rather than "a|b|c", so no shop id can shift a field boundary.
 * Server only (node:crypto); the secret is a parameter, read from SPEECH_TOKEN_SECRET by the routes.
 */

/** How long a reply's token stays valid. */
export const SPEECH_TOKEN_TTL_MS = 5 * 60_000;

export interface SpeechClaims {
  shopId: string;
  language: Lang;
  text: string;
  /** Whether the audio may be stored and replayed for other callers (design.md, "What may be cached"). */
  cacheable: boolean;
}

export type SpeechVerdict =
  | { ok: true; cacheable: boolean; expiresAtMs: number }
  | { ok: false; reason: "malformed" | "expired" | "signature" };

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const fromB64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

function mac(secret: string, claims: Omit<SpeechClaims, "cacheable">, expMs: number, cacheable: boolean): Buffer {
  const textHash = createHash("sha256").update(claims.text, "utf8").digest("hex");
  const payload = JSON.stringify([claims.shopId, claims.language, expMs, cacheable ? 1 : 0, textHash]);
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

function requireSecret(secret: string): void {
  if (!secret) throw new Error("SPEECH_TOKEN_SECRET is not set");
}

export function signSpeech(claims: SpeechClaims, secret: string, nowMs: number, ttlMs = SPEECH_TOKEN_TTL_MS): string {
  requireSecret(secret);
  const expMs = nowMs + ttlMs;
  return [b64(String(expMs)), b64(claims.cacheable ? "1" : "0"), b64(mac(secret, claims, expMs, claims.cacheable))].join(".");
}

/**
 * Checks the token against the exact shop, language and text of the request, in constant time.
 * A changed text, shop, language or cacheable flag, or an expired token, fails.
 */
export function verifySpeech(
  token: string,
  claims: Omit<SpeechClaims, "cacheable">,
  secret: string,
  nowMs: number,
): SpeechVerdict {
  requireSecret(secret);
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: "malformed" };
  const expRaw = fromB64(parts[0]);
  const flag = fromB64(parts[1]);
  if (!/^\d{1,16}$/.test(expRaw) || (flag !== "0" && flag !== "1")) return { ok: false, reason: "malformed" };
  const expMs = Number(expRaw);
  const cacheable = flag === "1";
  const given = Buffer.from(parts[2], "base64url");
  const expected = mac(secret, claims, expMs, cacheable);
  // Lengths are compared first because timingSafeEqual throws on unequal lengths; the length of
  // an HMAC-SHA256 is public, so this leaks nothing.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };
  if (nowMs >= expMs) return { ok: false, reason: "expired" };
  return { ok: true, cacheable, expiresAtMs: expMs };
}

import { createHash } from "node:crypto";

/**
 * The Visitor key, shared by the channel adapters (the Turn_API, the speech route and the
 * Machine_API login) so one device has one key everywhere. Kept out of the route files and
 * out of `lib/conversation`, which does no HTTP.
 */

/** The first address of `x-forwarded-for` (Vercel overwrites the header, so it cannot be spoofed there). */
export function firstIp(forwardedFor: string | null): string {
  const ip = forwardedFor?.split(",")[0]?.trim();
  return ip ? ip : "unknown";
}

/**
 * RATE_LIMIT_SALT, required: without it the Visitor key would be a plain sha256 of the IP, which
 * can be reversed. Fails closed (the request errors) rather than storing reversible keys.
 */
export function rateLimitSalt(env: Record<string, string | undefined> = process.env): string {
  const salt = env.RATE_LIMIT_SALT ?? "";
  if (salt.length < 8) throw new Error("RATE_LIMIT_SALT is missing or shorter than 8 characters");
  return salt;
}

/** sha256(salt + ip). The raw IP is never stored. */
export function visitorKeyOf(forwardedFor: string | null, salt: string): string {
  return createHash("sha256").update(salt + firstIp(forwardedFor)).digest("hex");
}

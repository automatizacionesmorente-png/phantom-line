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

/** sha256(salt + ip). The raw IP is never stored. */
export function visitorKeyOf(forwardedFor: string | null, salt: string): string {
  return createHash("sha256").update(salt + firstIp(forwardedFor)).digest("hex");
}

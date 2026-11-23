import { isNull, gt, or, sql } from "drizzle-orm";
import { shops } from "./schema";

/**
 * A shop that has not expired: every shop except a trial shop past its `expires_at`. Used by
 * the reads that serve a shop (call, machine, turn) so an expired trial answers "not found" at
 * once, even before the daily cron deletes it.
 */
export const shopIsLive = () => or(isNull(shops.expiresAt), gt(shops.expiresAt, sql`now()`));

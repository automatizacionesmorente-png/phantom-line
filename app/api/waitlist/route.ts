import { Temporal } from "temporal-polyfill";
import { getDb } from "@/lib/db/client";
import { createWaitlistRepository } from "@/lib/db/waitlistRepository";
import { makeWaitlistHandler } from "./handler";

/** POST /api/waitlist. Default Node.js runtime; the store is built on first use so `next build` needs no DATABASE_URL. */
export const POST = makeWaitlistHandler({
  store: () => createWaitlistRepository(getDb()),
  clock: () => Temporal.Now.instant(),
  salt: () => process.env.RATE_LIMIT_SALT ?? "",
});

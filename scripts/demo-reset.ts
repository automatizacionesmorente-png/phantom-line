// Resets the demo shop (Peluquería Lola) to the curated set for judges and the video.
//
// Run with:  npm run demo:reset                 (a local database)
//            npm run demo:reset -- --allow-remote   (Neon: the owner's call)
// which is:  node --env-file=.env.local --import tsx scripts/demo-reset.ts
//
// Refuses a database that is not on this machine unless --allow-remote is given. Only the
// demo shop is touched. Never prints the URL or process.env.

import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Temporal } from "temporal-polyfill";
import { checkResetTarget } from "@/lib/demo/guard";
import { resetDemo } from "@/lib/demo/reset";
import type { DbHandle, Query } from "@/lib/db/repository";
import * as schema from "@/lib/db/schema";

const REFUSALS = {
  no_url: "DATABASE_URL is not set",
  bad_url: "DATABASE_URL is not a valid URL",
  remote_needs_flag: "DATABASE_URL points to a remote database; run again with --allow-remote if you mean it",
} as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const target = checkResetTarget(url, process.argv.slice(2));
  if (!target.ok) {
    console.log(`demo:reset refused: ${REFUSALS[target.reason]}`);
    process.exitCode = 1;
    return;
  }
  const redact = (text: unknown) => String(text).split(url ?? "").join("***");
  try {
    const db = drizzle(neon(url as string), { schema });
    const handle: DbHandle = {
      db,
      async atomic(build) {
        const queries = build(db);
        if (queries.length === 0) return [];
        return (await db.batch(queries as [Query, ...Query[]])) as unknown[];
      },
    };
    const r = await resetDemo(handle, { now: Temporal.Now.instant(), newId: randomUUID });
    console.log(
      `demo shop reset (${target.remote ? "remote" : "local"} database): ` +
        `deleted ${r.deleted.calls} calls, ${r.deleted.messages} messages, ${r.deleted.bookings} bookings ` +
        `(${r.deleted.testBookings} test bookings); ` +
        `loaded ${r.loaded.messages} messages and ${r.loaded.bookings} bookings`,
    );
  } catch (err) {
    const e = err as { constructor?: { name?: string }; code?: string; message?: string } | undefined;
    console.log(`demo:reset failed: ${e?.constructor?.name ?? "Error"} ${e?.code ?? ""} ${redact(e?.message ?? "")}`.trim());
    process.exitCode = 1;
  }
}

void main();

// Seeds the demo shop (Peluquería Lola) into the database in DATABASE_URL.
//
// Run with:  npm run db:seed
// which is:  node --env-file=.env.local --import tsx scripts/seed.ts
//
// Node loads .env.local itself; this script never prints the URL or process.env.
// Safe to run again: an existing shop with the same name is updated, never duplicated.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { seedOwnerPin, seedShop } from "@/lib/db/seed";
import * as schema from "@/lib/db/schema";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }
  const redact = (text: unknown) => String(text).split(url).join("***");
  try {
    const db = drizzle(neon(url), { schema });
    const result = await seedShop(db);
    console.log(`shop "${result.shopId}" ${result.created ? "created" : "updated (already existed)"}`);
    // Owner-machine 2.6. Prints what it did, never the PIN or its hash.
    await seedOwnerPin(db, result.shopId, process.env.DEMO_OWNER_PIN, console.log);
  } catch (err) {
    const e = err as { constructor?: { name?: string }; code?: string; message?: string } | undefined;
    console.log(`seed failed: ${e?.constructor?.name ?? "Error"} ${e?.code ?? ""} ${redact(e?.message ?? "")}`.trim());
    process.exitCode = 1;
  }
}

void main();

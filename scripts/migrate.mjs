// Applies every migration in drizzle/ (tables, then the bookings_no_overlap
// constraint) to the database in DATABASE_URL, over Neon's HTTP driver.
//
// Run with:  node --env-file=.env.local scripts/migrate.mjs
//
// Node loads .env.local itself; this script never prints the URL or process.env.
// Plain JavaScript (.mjs) so the machine's default Node 20.19 runs it directly.
// Already-applied migrations are skipped (drizzle.__drizzle_migrations).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("DATABASE_URL is not set");
  process.exit(1);
}

const redact = (text) => String(text).split(url).join("***");
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

try {
  const t0 = performance.now();
  await migrate(drizzle(neon(url)), { migrationsFolder });
  console.log(`migrations applied in ${Math.round(performance.now() - t0)} ms`);
} catch (err) {
  const e = /** @type {any} */ (err);
  console.log(`migration failed: ${e?.constructor?.name ?? "Error"} ${e?.code ?? ""} ${redact(e?.message ?? "")}`.trim());
  process.exit(1);
}

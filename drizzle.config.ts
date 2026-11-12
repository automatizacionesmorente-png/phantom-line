import { defineConfig } from "drizzle-kit";

// Only `drizzle-kit generate` uses this file; it needs no database connection.
// Migrations are applied by scripts/migrate.mjs (neon-http) and, in tests, on PGlite.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
});

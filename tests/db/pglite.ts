import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createRepository, type DbHandle } from "@/lib/db/repository";
import * as schema from "@/lib/db/schema";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../drizzle");

export interface TestDb {
  pg: PGlite;
  handle: DbHandle;
  repo: ReturnType<typeof createRepository>;
  /** Empties every table, keeping the schema. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * A fresh in-memory Postgres with every migration in drizzle/ applied,
 * including the custom no-overlap constraint (which needs btree_gist).
 * Writes run in `db.transaction`, the PGlite stand-in for neon-http's `db.batch`.
 */
export async function createTestDb(): Promise<TestDb> {
  const pg = await PGlite.create({ extensions: { btree_gist } });
  const db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  const handle: DbHandle = {
    db,
    async atomic(build) {
      return db.transaction(async (tx) => {
        const results: unknown[] = [];
        for (const q of build(tx)) results.push(await q);
        return results;
      });
    },
  };
  return {
    pg,
    handle,
    repo: createRepository(handle),
    reset: async () => {
      await db.execute(sql`TRUNCATE waitlist, owner_actions, voice_cache, messages, bookings, calls, rate_limits, shops CASCADE`);
    },
    close: () => pg.close(),
  };
}

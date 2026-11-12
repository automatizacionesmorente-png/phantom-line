import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { Repository } from "@/lib/conversation/types";
import { createRepository, type DbHandle, type Query } from "./repository";
import * as schema from "./schema";

/**
 * Neon over HTTP. Created lazily on first use, so `next build` never needs
 * DATABASE_URL. neon-http has no interactive transactions; every atomic write
 * is one `db.batch` (decisions are made in code before it, and the EXCLUDE
 * constraint catches races).
 */
let handle: DbHandle | undefined;

export function neonHandle(url: string): DbHandle {
  const db: NeonHttpDatabase<typeof schema> = drizzle(neon(url), { schema });
  return {
    db,
    async atomic(build) {
      const queries = build(db);
      if (queries.length === 0) return;
      await db.batch(queries as [Query, ...Query[]]);
    },
  };
}

export function getDb(): DbHandle {
  if (!handle) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = neonHandle(url);
  }
  return handle;
}

let repo: Repository | undefined;
export function getRepository(): Repository {
  repo ??= createRepository(getDb());
  return repo;
}

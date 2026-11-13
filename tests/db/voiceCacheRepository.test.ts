import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { createVoiceCacheRepository } from "@/lib/db/voiceCacheRepository";
import type { DbHandle } from "@/lib/db/repository";
import * as schema from "@/lib/db/schema";
import { voiceCache } from "@/lib/db/schema";
import type { NewCacheRow } from "@/lib/receptionist/voiceCacheBudget";
import { insertShop } from "./helpers";
import { createTestDb, type TestDb } from "./pglite";
import { lolaProfile } from "../fixtures/lola";

/** Task 9.3: the voice_cache table and its repository, on PGlite. */

let t: TestDb;
/** Every SQL statement the logged handle ran. */
const queries: string[] = [];
let logged: DbHandle;

beforeAll(async () => {
  t = await createTestDb();
  const db = drizzle({ client: t.pg, schema, logger: { logQuery: (q) => queries.push(q) } });
  logged = { db, atomic: t.handle.atomic };
}, 120_000);
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
  queries.length = 0;
});
afterAll(async () => {
  await t.close();
});

const KEY = (n: number) => n.toString(16).padStart(32, "0");
const row = (n: number, over: Partial<NewCacheRow> = {}): NewCacheRow => ({
  key: KEY(n),
  shopId: lolaProfile.id,
  language: "es",
  model: "gemini-3.8-flash-tts",
  mime: "audio/mpeg",
  bytes: new Uint8Array([0, 1, 127, 128, 254, 255, n % 256]),
  durationMs: 2440,
  source: "pregen",
  pinned: false,
  ...over,
});
const setLastUsed = (key: string, iso: string) =>
  t.handle.db.update(voiceCache).set({ lastUsedAt: new Date(iso) }).where(eq(voiceCache.key, key));

describe("voice_cache on PGlite", () => {
  it("insert stores the bytes exactly (every byte value), with their size, and get returns them", async () => {
    const repo = createVoiceCacheRepository(t.handle);
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(await repo.insert(row(1, { bytes }))).toBe(true);
    const hit = await repo.get(KEY(1));
    expect(hit?.mime).toBe("audio/mpeg");
    expect(hit?.bytes).toBeInstanceOf(Uint8Array);
    expect([...(hit?.bytes ?? [])]).toEqual([...bytes]);
    const [stored] = await t.handle.db.select({ size: voiceCache.sizeBytes, pinned: voiceCache.pinned }).from(voiceCache);
    expect(stored).toEqual({ size: 256, pinned: false });
  });

  it("insert on an existing key does nothing and keeps the first audio", async () => {
    const repo = createVoiceCacheRepository(t.handle);
    expect(await repo.insert(row(2, { bytes: new Uint8Array([1]) }))).toBe(true);
    expect(await repo.insert(row(2, { bytes: new Uint8Array([2, 2]) }))).toBe(false);
    expect([...((await repo.get(KEY(2)))?.bytes ?? [])]).toEqual([1]);
    expect(await t.handle.db.select().from(voiceCache)).toHaveLength(1);
  });

  it("get of a missing key is null", async () => {
    expect(await createVoiceCacheRepository(t.handle).get(KEY(99))).toBeNull();
  });

  it("findKeys answers which keys are stored, and its query never reads the audio", async () => {
    const repo = createVoiceCacheRepository(logged);
    await repo.insert(row(3));
    await repo.insert(row(4));
    queries.length = 0;
    expect(await repo.findKeys([KEY(3), KEY(5), KEY(4), KEY(3)])).toEqual(new Set([KEY(3), KEY(4)]));
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/select "key" from "voice_cache" where "voice_cache"\."key" in/i);
    expect(queries[0]).not.toContain('"bytes"');
    expect(await repo.findKeys([])).toEqual(new Set());
    expect(queries).toHaveLength(1);
  });

  it("the table rejects a malformed key, an unknown language and an empty file", async () => {
    const repo = createVoiceCacheRepository(t.handle);
    await expect(repo.insert(row(6, { key: "not-a-key" }))).rejects.toThrow();
    await expect(repo.insert(row(7, { language: "fr" as "es" }))).rejects.toThrow();
    await expect(repo.insert(row(8, { bytes: new Uint8Array() }))).rejects.toThrow();
  });

  it("touch refreshes last_used_at only when it is more than a day old", async () => {
    const repo = createVoiceCacheRepository(t.handle);
    await repo.insert(row(9));
    await setLastUsed(KEY(9), "2026-11-10T08:00:00Z");
    await repo.touch(KEY(9), Date.parse("2026-11-11T07:00:00Z")); // 23 h later: no write
    expect((await repo.get(KEY(9)))?.lastUsedAtMs).toBe(Date.parse("2026-11-10T08:00:00Z"));
    await repo.touch(KEY(9), Date.parse("2026-11-11T08:00:01Z")); // just over a day
    expect((await repo.get(KEY(9)))?.lastUsedAtMs).toBe(Date.parse("2026-11-11T08:00:01Z"));
  });

  it("evict deletes the least recently used unpinned rows until the total fits, and never a pinned one", async () => {
    const repo = createVoiceCacheRepository(t.handle);
    const ten = new Uint8Array(10).fill(1);
    await repo.insert(row(10, { bytes: ten, pinned: true }));
    await repo.insert(row(11, { bytes: ten }));
    await repo.insert(row(12, { bytes: ten }));
    await repo.insert(row(13, { bytes: ten }));
    await setLastUsed(KEY(10), "2026-01-01T00:00:00Z");
    await setLastUsed(KEY(11), "2026-11-01T00:00:00Z");
    await setLastUsed(KEY(12), "2026-10-01T00:00:00Z");
    await setLastUsed(KEY(13), "2026-11-10T00:00:00Z");
    expect(await repo.evict(25)).toEqual([KEY(12), KEY(11)]);
    const left = (await t.handle.db.select({ key: voiceCache.key }).from(voiceCache)).map((r) => r.key).sort();
    expect(left).toEqual([KEY(10), KEY(13)]);
    expect(await repo.evict(25)).toEqual([]);
    // Over the cap with only the pinned row and one more: the pinned row stays.
    expect(await repo.evict(1)).toEqual([KEY(13)]);
    expect((await t.handle.db.select({ key: voiceCache.key }).from(voiceCache)).map((r) => r.key)).toEqual([KEY(10)]);
  });
});

describe("the bytea column type, for each driver's output", () => {
  const column = voiceCache.bytes;
  it("sends a Buffer, which PGlite binds as binary and the Neon HTTP driver encodes as hex", () => {
    const sent = column.mapToDriverValue(new Uint8Array([0, 15, 255]));
    expect(Buffer.isBuffer(sent)).toBe(true);
    expect((sent as Buffer).toString("hex")).toBe("000fff");
  });
  it("reads a Buffer (Neon over HTTP), a Uint8Array (PGlite) and hex text alike", () => {
    const read = (v: unknown) => [...(column.mapFromDriverValue(v as never) as Uint8Array)];
    expect(read(Buffer.from([1, 2, 255]))).toEqual([1, 2, 255]);
    expect(read(new Uint8Array([1, 2, 255]))).toEqual([1, 2, 255]);
    expect(read("\\x0102ff")).toEqual([1, 2, 255]);
  });
  it("refuses text that is not hex output", () => {
    expect(() => column.mapFromDriverValue("abc")).toThrow();
  });
});

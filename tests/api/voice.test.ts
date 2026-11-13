import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { IMMUTABLE, makeVoiceHandler, MISS_CACHE, type VoiceDeps } from "@/app/api/voice/handler";
import { voiceCache } from "@/lib/db/schema";
import { createVoiceCacheRepository } from "@/lib/db/voiceCacheRepository";
import type { VoiceCacheStore } from "@/lib/receptionist/voiceCacheBudget";
import { insertShop } from "../db/helpers";
import type { TestDb } from "../db/pglite";
import { lolaProfile } from "../fixtures/lola";
import { setupDb } from "./harness";

/** Task 9.5: GET /api/voice/[key] on PGlite. */

let t: TestDb;
beforeAll(async () => {
  t = await setupDb();
}, 120_000);
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
});
afterAll(async () => {
  await t.close();
});

const KEY = "0123456789abcdef0123456789abcdef";
const NOW_MS = Date.parse("2026-11-10T08:00:00Z");
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);

function setup(over: Partial<VoiceDeps> = {}) {
  const scheduled: Promise<void>[] = [];
  const store = createVoiceCacheRepository(t.handle);
  const calls = { get: 0, touch: 0, deps: 0 };
  const deps: VoiceDeps = {
    store: {
      get: (k) => {
        calls.get++;
        return store.get(k);
      },
      touch: (k, n) => {
        calls.touch++;
        return store.touch(k, n);
      },
    },
    nowMs: () => NOW_MS,
    ...over,
  };
  const GET = makeVoiceHandler({
    deps: () => {
      calls.deps++;
      return deps;
    },
    schedule: (task) => {
      scheduled.push(task());
    },
  });
  const get = (key: string) => GET(new Request(`http://localhost/api/voice/${key}`), { params: Promise.resolve({ key }) });
  return { get, calls, settle: () => Promise.all(scheduled), store };
}

async function stored(lastUsedIso: string) {
  await createVoiceCacheRepository(t.handle).insert({
    key: KEY,
    shopId: lolaProfile.id,
    language: "es",
    model: "gemini-3.8-flash-tts",
    mime: "audio/mpeg",
    bytes: MP3,
    durationMs: null,
    source: "pregen",
    pinned: true,
  });
  await t.handle.db.update(voiceCache).set({ lastUsedAt: new Date(lastUsedIso) }).where(eq(voiceCache.key, KEY));
}

describe("GET /api/voice/[key]", () => {
  it("a hit: the bytes with their mime, their length and a one-year immutable Cache-Control", async () => {
    await stored("2026-11-10T07:00:00Z");
    const { get, calls, settle } = setup();
    const res = await get(KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("content-length")).toBe(String(MP3.length));
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, s-maxage=31536000, immutable");
    expect(IMMUTABLE).toBe("public, max-age=31536000, s-maxage=31536000, immutable");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...MP3]);
    await settle();
    // Used an hour ago: a hit is not a write.
    expect(calls.touch).toBe(0);
  });

  it("a hit on a line last used more than a day ago refreshes last_used_at after the response", async () => {
    await stored("2026-11-08T08:00:00Z");
    const { get, calls, settle } = setup();
    expect((await get(KEY)).status).toBe(200);
    await settle();
    expect(calls.touch).toBe(1);
    const [r] = await t.handle.db.select({ at: voiceCache.lastUsedAt }).from(voiceCache);
    expect(new Date(r.at).getTime()).toBe(NOW_MS);
  });

  it("a miss is a 404 cached for 60 s", async () => {
    const { get } = setup();
    const res = await get(KEY);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe(MISS_CACHE);
    expect(MISS_CACHE).toBe("public, max-age=60, s-maxage=60");
  });

  it("a malformed key is refused before any query, and before the database is even opened", async () => {
    const { get, calls } = setup();
    for (const bad of ["abc", KEY.toUpperCase(), `${KEY}0`, KEY.slice(1), "..%2F..%2Fetc", `${KEY.slice(0, 31)}'`]) {
      const res = await get(bad);
      expect(res.status).toBe(404);
    }
    expect(calls).toEqual({ get: 0, touch: 0, deps: 0 });
  });

  it("a database error is a 503 that no cache keeps", async () => {
    const failing: Pick<VoiceCacheStore, "get" | "touch"> = {
      get: () => Promise.reject(new Error("connection refused")),
      touch: () => Promise.resolve(),
    };
    const { get } = setup({ store: failing });
    const res = await get(KEY);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

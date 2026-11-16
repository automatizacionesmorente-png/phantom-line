import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { makeVoiceHandler, parseRange } from "@/app/api/voice/handler";

// Safari's <audio> first asks for `Range: bytes=0-1` and refuses a body sent without 206.
// The owner heard the browser voice on every cached line in Safari until this was added (2026-11-16).
const KEY = "0123456789abcdef0123456789abcdef";
const BYTES = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);

function handler() {
  return makeVoiceHandler({
    deps: () => ({
      store: { get: async (k: string) => (k === KEY ? { bytes: BYTES, mime: "audio/wav", lastUsedAtMs: 0 } : null), touch: async () => undefined },
      nowMs: () => 0,
    }),
    schedule: () => undefined,
  } as never);
}
const get = (range?: string) =>
  handler()(new Request(`http://x/api/voice/${KEY}`, { headers: range ? { range } : {} }), { params: Promise.resolve({ key: KEY }) });

describe("GET /api/voice/[key] with Range", () => {
  it("answers Safari's first probe bytes=0-1 with 206 and the first two bytes", async () => {
    const r = await get("bytes=0-1");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 0-1/1000");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([0, 1]);
  });

  it("sends the whole body with 200 and accept-ranges when no range is asked", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect((await r.arrayBuffer()).byteLength).toBe(1000);
  });

  it("answers a range past the end with 416", async () => {
    expect((await get("bytes=1000-")).status).toBe(416);
  });

  it("any satisfiable range returns exactly the bytes it names", async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat(999), fc.nat(1200), async (a, len) => {
        const r = await get(`bytes=${a}-${a + len}`);
        const end = Math.min(a + len, 999);
        expect(r.status).toBe(206);
        expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([...BYTES.slice(a, end + 1)]);
      }),
      { numRuns: 50 },
    );
  });

  it("parses suffix ranges and ignores malformed or multiple ranges", () => {
    expect(parseRange("bytes=-10", 1000)).toEqual([990, 999]);
    expect(parseRange("bytes=0-1,5-6", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
  });
});

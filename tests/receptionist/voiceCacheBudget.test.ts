import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_CACHE_MAX_BYTES,
  mp3DurationMs,
  pcmDurationMs,
  planEviction,
  shouldTouch,
  TOUCH_AFTER_MS,
  voiceCacheMaxBytesFromEnv,
  wavFromPcm,
} from "@/lib/receptionist/voiceCacheBudget";

/** Task 9.3 / 9.6: eviction, the touch rule, the cap from the environment, WAV and MP3 sizes. */

const row = (key: string, sizeBytes: number, lastUsedAtMs: number, pinned = false) => ({ key, sizeBytes, lastUsedAtMs, pinned });

describe("planEviction", () => {
  it("nothing when the total fits", () => {
    expect(planEviction([row("a", 10, 1), row("b", 10, 2)], 20)).toEqual([]);
  });

  it("the least recently used unpinned rows, oldest first, until the total fits", () => {
    const rows = [row("new", 10, 300), row("old", 10, 100), row("mid", 10, 200), row("pin", 10, 0, true)];
    expect(planEviction(rows, 25)).toEqual(["old", "mid"]);
    expect(planEviction(rows, 30)).toEqual(["old"]);
  });

  it("never a pinned row, even when only pinned rows are left over the cap", () => {
    const rows = [row("p1", 50, 0, true), row("p2", 50, 0, true), row("u", 1, 999)];
    expect(planEviction(rows, 10)).toEqual(["u"]);
  });

  it("ties on the date are broken by the key", () => {
    expect(planEviction([row("b", 10, 5), row("a", 10, 5)], 10)).toEqual(["a"]);
  });
});

describe("shouldTouch", () => {
  it("only when last_used_at is more than a day old", () => {
    expect(shouldTouch(0, TOUCH_AFTER_MS)).toBe(false);
    expect(shouldTouch(0, TOUCH_AFTER_MS + 1)).toBe(true);
    expect(shouldTouch(1000, 1000)).toBe(false);
  });
});

describe("voiceCacheMaxBytesFromEnv", () => {
  it("200 MB by default, the value when it is a positive integer", () => {
    expect(DEFAULT_VOICE_CACHE_MAX_BYTES).toBe(200_000_000);
    expect(voiceCacheMaxBytesFromEnv({})).toBe(200_000_000);
    expect(voiceCacheMaxBytesFromEnv({ VOICE_CACHE_MAX_BYTES: "" })).toBe(200_000_000);
    expect(voiceCacheMaxBytesFromEnv({ VOICE_CACHE_MAX_BYTES: "abc" })).toBe(200_000_000);
    expect(voiceCacheMaxBytesFromEnv({ VOICE_CACHE_MAX_BYTES: "0" })).toBe(200_000_000);
    expect(voiceCacheMaxBytesFromEnv({ VOICE_CACHE_MAX_BYTES: "-5" })).toBe(200_000_000);
    expect(voiceCacheMaxBytesFromEnv({ VOICE_CACHE_MAX_BYTES: " 50000000 " })).toBe(50_000_000);
  });
});

describe("wavFromPcm", () => {
  it("a 44-byte PCM header (mono, 16-bit, the stream's rate) and the samples as they came", () => {
    const wav = wavFromPcm(new Uint8Array([1, 2, 3, 4]), 24000);
    const v = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(40);
    expect(new TextDecoder().decode(wav.slice(8, 16))).toBe("WAVEfmt ");
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(28, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(new TextDecoder().decode(wav.slice(36, 40))).toBe("data");
    expect(v.getUint32(40, true)).toBe(4);
    expect([...wav.slice(44)]).toEqual([1, 2, 3, 4]);
  });

  it("48 kB of 24 kHz PCM is one second", () => {
    expect(pcmDurationMs(48_000, 24_000)).toBe(1000);
  });
});

describe("mp3DurationMs", () => {
  /** MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding: 417-byte frames of 1 152 samples. */
  const frame = () => {
    const f = new Uint8Array(417);
    f.set([0xff, 0xfb, 0x90, 0x00]);
    return f;
  };
  const join = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  it("counts the frames: 10 frames are 11 520 samples at 44.1 kHz, 261 ms", () => {
    expect(mp3DurationMs(join(...Array.from({ length: 10 }, frame)))).toBe(261);
  });

  it("skips an ID3v2 tag and ignores what follows the last frame (a content-credentials block)", () => {
    const id3 = new Uint8Array(10 + 20);
    id3.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]);
    const trailer = new TextEncoder().encode("C2PA content credentials".repeat(10));
    expect(mp3DurationMs(join(id3, ...Array.from({ length: 10 }, frame), trailer))).toBe(261);
  });

  it("null when there is no frame", () => {
    expect(mp3DurationMs(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(mp3DurationMs(new Uint8Array())).toBeNull();
  });
});

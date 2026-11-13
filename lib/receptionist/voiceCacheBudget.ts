/**
 * The voice cache's budget rules (natural-voice design.md, "Budget"). Pure: the rows come from
 * `voice_cache` through the repository, without their audio.
 */

/** 200 MB of the 0.5 GB Neon free-tier project, shared with every other table. */
export const DEFAULT_VOICE_CACHE_MAX_BYTES = 200_000_000;

/** A hit refreshes `last_used_at` only when it is older than this, so a hit is not a write. */
export const TOUCH_AFTER_MS = 24 * 60 * 60 * 1000;

export interface CacheRowMeta {
  key: string;
  sizeBytes: number;
  pinned: boolean;
  /** Epoch ms. */
  lastUsedAtMs: number;
}

/**
 * The keys to delete so the total size fits in `maxBytes`: unpinned rows, least recently used
 * first (ties by key, so the choice is deterministic). Pinned rows are never chosen, so when only
 * pinned rows are left the total may stay above the cap.
 */
export function planEviction(rows: readonly CacheRowMeta[], maxBytes: number): string[] {
  let total = rows.reduce((sum, r) => sum + r.sizeBytes, 0);
  if (total <= maxBytes) return [];
  const candidates = rows
    .filter((r) => !r.pinned)
    .sort((a, b) => a.lastUsedAtMs - b.lastUsedAtMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out: string[] = [];
  for (const r of candidates) {
    if (total <= maxBytes) break;
    out.push(r.key);
    total -= r.sizeBytes;
  }
  return out;
}

/** Whether a hit should refresh `last_used_at`. */
export function shouldTouch(lastUsedAtMs: number, nowMs: number): boolean {
  return nowMs - lastUsedAtMs > TOUCH_AFTER_MS;
}

/** VOICE_CACHE_MAX_BYTES; a missing, malformed or non-positive value uses the default. */
export function voiceCacheMaxBytesFromEnv(env: Record<string, string | undefined>): number {
  const raw = env.VOICE_CACHE_MAX_BYTES?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_VOICE_CACHE_MAX_BYTES;
  const n = Number(raw);
  return n >= 1 && Number.isSafeInteger(n) ? n : DEFAULT_VOICE_CACHE_MAX_BYTES;
}

/** A row to store. `bytes` is the whole file (MP3 or WAV). */
export interface NewCacheRow {
  key: string;
  shopId: string;
  language: "es" | "en";
  model: string;
  mime: string;
  bytes: Uint8Array;
  durationMs: number | null;
  source: "pregen" | "live";
  pinned: boolean;
}

export interface CachedAudio {
  mime: string;
  bytes: Uint8Array;
  lastUsedAtMs: number;
}

/** The port to `voice_cache` (lib/db/voiceCacheRepository.ts; PGlite in tests). */
export interface VoiceCacheStore {
  /** Which of these keys are stored. Reads no audio. */
  findKeys(keys: readonly string[]): Promise<Set<string>>;
  get(key: string): Promise<CachedAudio | null>;
  /** Stores the row unless the key exists (`on conflict do nothing`). True when it was inserted. */
  insert(row: NewCacheRow): Promise<boolean>;
  /** Sets `last_used_at` to `nowMs` if it is older than a day. */
  touch(key: string, nowMs: number): Promise<void>;
  /** Deletes the least recently used unpinned rows until the total fits in `maxBytes`. Returns the keys deleted. */
  evict(maxBytes: number): Promise<string[]>;
}

/** The default logger for a failed cache write: one JSON line, with the key and the error class only. */
export interface CacheWriteFailedEvent {
  event: "voice_cache_write_failed";
  key: string;
  errorClass: string;
}
export const consoleCacheWriteLogger = (e: CacheWriteFailedEvent) => console.error(JSON.stringify(e));

/** The class of an error, never its message (a query error's message holds the bytes as hex). */
export function errorClassOf(err: unknown): string {
  const e = err as { constructor?: { name?: unknown }; name?: unknown } | null;
  if (typeof e?.constructor?.name === "string" && e.constructor.name !== "Object") return e.constructor.name;
  return typeof e?.name === "string" ? e.name : typeof err;
}

/** A WAV file (44-byte header) around raw 16-bit mono PCM, as live lines are stored. */
export function wavFromPcm(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** The length of raw 16-bit mono PCM in milliseconds. */
export const pcmDurationMs = (bytes: number, sampleRate: number): number => Math.round((bytes / 2 / sampleRate) * 1000);

// MPEG audio Layer III frame headers (ISO 11172-3 and 13818-3), enough to time a file.
const MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MP3_RATES: Record<number, readonly number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * The length of an MP3 in milliseconds, from its Layer III frames (an ID3v2 tag at the start is
 * skipped, and anything after the last frame, such as a content-credentials block, is ignored).
 * Null when no frame is found.
 */
export function mp3DurationMs(bytes: Uint8Array): number | null {
  let i = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    i = 10 + size;
  }
  let seconds = 0;
  let frames = 0;
  while (i + 4 <= bytes.length) {
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const version = (b1 >> 3) & 0b11; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    const layer = (b1 >> 1) & 0b11; // 1 = Layer III
    const bitrateIndex = b2 >> 4;
    const rateIndex = (b2 >> 2) & 0b11;
    const valid =
      bytes[i] === 0xff && (b1 & 0xe0) === 0xe0 && version !== 1 && layer === 1 && bitrateIndex > 0 && bitrateIndex < 15 && rateIndex < 3;
    if (!valid) {
      if (frames > 0) break;
      i += 1; // look for the first frame
      continue;
    }
    const sampleRate = MP3_RATES[version][rateIndex];
    const kbps = (version === 3 ? MP3_BITRATES_V1 : MP3_BITRATES_V2)[bitrateIndex];
    const samples = version === 3 ? 1152 : 576;
    const padding = (b2 >> 1) & 1;
    const length = Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding;
    seconds += samples / sampleRate;
    frames += 1;
    i += length;
  }
  return frames > 0 ? Math.round(seconds * 1000) : null;
}

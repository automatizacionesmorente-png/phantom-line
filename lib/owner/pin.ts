import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** The Owner_PIN: exactly 6 digits. */
export const PIN_PATTERN = /^\d{6}$/;

const N = 16384;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const B64URL = /^[A-Za-z0-9_-]+$/;

function scryptAsync(pin: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  // Node throws invalid parameters synchronously (ERR_CRYPTO_INVALID_SCRYPT_PARAMS); inside the
  // executor that throw becomes a rejection, so verifyPin can turn it into `false`.
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Memory scrypt needs is about 128 * N * r bytes; give it twice that so the default 32 MiB cap never decides. */
function optionsFor(n: number, r: number, p: number): ScryptOptions {
  return { N: n, r, p, maxmem: 256 * n * r };
}

/** "scrypt$16384$8$1$<salt b64url>$<hash b64url>"; 16-byte random salt, 32-byte key. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(pin, salt, KEY_BYTES, optionsFor(N, R, P));
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function parseIntStrict(s: string, min: number, max: number): number | null {
  if (!/^[1-9]\d{0,7}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** A base64url field decoded only if it re-encodes to exactly the same text (Buffer.from is lenient). */
function decodeCanonical(s: string): Buffer | null {
  if (!B64URL.test(s)) return null;
  const buf = Buffer.from(s, "base64url");
  return buf.toString("base64url") === s ? buf : null;
}

interface StoredHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parseStored(stored: unknown): StoredHash | null {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  // Bounds keep a damaged or hostile row from asking for much memory or CPU: at most ~32 MiB (128 * N * r).
  const n = parseIntStrict(parts[1], 2, 1 << 15);
  const r = parseIntStrict(parts[2], 1, 8);
  const p = parseIntStrict(parts[3], 1, 4);
  if (n === null || r === null || p === null || (n & (n - 1)) !== 0) return null;
  const salt = decodeCanonical(parts[4]);
  const key = decodeCanonical(parts[5]);
  if (!salt || !key || salt.length < SALT_BYTES || key.length < 16 || key.length > 64) return null;
  return { n, r, p, salt, key };
}

/** Recomputes with the stored parameters; compares with crypto.timingSafeEqual. False for any malformed hash. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed || typeof pin !== "string") return false;
  try {
    const key = await scryptAsync(pin, parsed.salt, parsed.key.length, optionsFor(parsed.n, parsed.r, parsed.p));
    return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  } catch {
    return false;
  }
}

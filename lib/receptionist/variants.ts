/**
 * Requirement 9.4: a Phrase_Template may have several approved wordings
 * (Phrase_Variants). One is picked from the Variant_Seed (the Call id plus the
 * Turn number), so the same Call and Turn always get the same wording, and
 * consecutive Turns do not always repeat the same opener. Pure: no I/O, no
 * clock, no randomness.
 */

/** The Call id and the Turn number. */
export type VariantSeed = { readonly callId: string; readonly turn: number };

/** A template's approved wordings. Never empty. */
export type Variants<T> = readonly [T, ...T[]];

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const utf8 = new TextEncoder();

/** 32-bit FNV-1a over the UTF-8 bytes of `text`, as an unsigned integer. */
export function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of utf8.encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * `variants[fnv1a32(callId + ":" + turn + ":" + key) % variants.length]`.
 * With no seed, variant 0, so deterministic tests keep their shape.
 */
export function pickVariant<T>(seed: VariantSeed | undefined, key: string, variants: Variants<T>): T {
  if (seed === undefined) return variants[0];
  const index = fnv1a32(`${seed.callId}:${seed.turn}:${key}`) % variants.length;
  return variants[index] as T;
}

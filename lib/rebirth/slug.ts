/**
 * Slugs and ids for the wizard. Pure. A shop slug is the URL of its pages (`/call/<slug>`);
 * a service or resource id follows the profile's IdSchema (lowercase, digits, hyphens, starts
 * with a letter).
 */

/** "Peluquería  Lola!" → "peluqueria-lola". Empty or number-only input gets a letter prefix. */
export function slugify(input: string, maxLength = 40): string {
  const base = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let slug = base === "" ? "negocio" : /^[a-z]/.test(base) ? base : `n-${base}`;
  slug = slug.slice(0, maxLength).replace(/-+$/g, "");
  return slug === "" ? "negocio" : slug;
}

export const SLUG_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** `base`, then `base-<suffix>` for each random suffix, in order: the ids a shop may take. */
export function slugCandidates(base: string, suffixes: readonly string[]): string[] {
  return [base, ...suffixes.map((s) => `${base}-${s}`)];
}

/** A short lowercase suffix from random bytes (letters and digits only). */
export function randomSuffix(bytes: Uint8Array): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** `slugify(name)` made unique among `taken`: "corte", "corte-2", "corte-3"… Adds the result to `taken`. */
export function uniqueId(name: string, taken: Set<string>, maxLength = 50): string {
  const base = slugify(name, maxLength);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base.slice(0, maxLength - String(n).length - 1)}-${n}`;
  taken.add(id);
  return id;
}

/**
 * Whole-word term matching for the Urgency_Rules (owner-machine Requirement 5.9).
 * Pure: no I/O. Case, accents, spacing and punctuation never matter; letters glued
 * to a term do ("hoyo" is not "hoy").
 */
import { normalizeName } from "@/lib/conversation/matchCaller";

/** `normalizeName` (case, accents, spaces), then every run of non-letters/digits becomes one space. */
export function normalizeForMatch(text: string): string {
  return normalizeName(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The words of a text, normalized and padded, so a whole-word search is a substring search: " hoy a las 5 ". */
export function wordsOf(text: string): string {
  return ` ${normalizeForMatch(text)} `;
}

/** The first term (in list order) that occurs as whole words in any line, or null. Returns the term as written. */
export function findTerm(lines: readonly string[], terms: readonly string[]): string | null {
  const padded = lines.map(wordsOf);
  for (const term of terms) {
    const n = normalizeForMatch(term);
    if (n === "") continue;
    const needle = ` ${n} `;
    if (padded.some((line) => line.includes(needle))) return term;
  }
  return null;
}

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

/**
 * Not_Urgent_Phrases (front-desk-brain 16.5): the line's words with every phrase cut out, as
 * the pieces between them. A word inside any occurrence of any phrase (overlaps included) is
 * masked. The pieces are returned as separate lines, so the words on either side of a phrase
 * never join into a new term: "me prueba de alergia pica" gives ["me", "pica"], never "me pica".
 * The design sketched a single string with a blank word; `findTerm` normalizes every line
 * again and would drop any non-letter blank, so the pieces are the safe form of the same rule.
 */
export function maskPhrases(line: string, phrases: readonly string[]): string[] {
  const words = normalizeForMatch(line).split(" ").filter((w) => w !== "");
  if (phrases.length === 0) return words.length === 0 ? [] : [words.join(" ")];
  const masked = new Array<boolean>(words.length).fill(false);
  for (const phrase of phrases) {
    const p = normalizeForMatch(phrase).split(" ").filter((w) => w !== "");
    if (p.length === 0) continue;
    for (let i = 0; i + p.length <= words.length; i++) {
      if (p.every((w, j) => words[i + j] === w)) masked.fill(true, i, i + p.length);
    }
  }
  const pieces: string[] = [];
  let run: string[] = [];
  words.forEach((w, i) => {
    if (masked[i]) {
      if (run.length > 0) pieces.push(run.join(" "));
      run = [];
    } else run.push(w);
  });
  if (run.length > 0) pieces.push(run.join(" "));
  return pieces;
}

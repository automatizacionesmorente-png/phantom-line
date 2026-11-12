/**
 * Requirement 4.11: what the receptionist says is one or two short spoken
 * sentences, each at most 25 words, with no lists, emoji or markdown.
 * Every reply, templated or from the model, goes through `toSpokenReply`.
 */

export const MAX_SENTENCES = 2;
export const MAX_WORDS = 25;

/** Characters that only make sense as markup. */
const MARKUP = /[*_#`~[\]|<>{}\\^=]/g;
/** Emoji and their joiners, selectors, skin tones, flags and keycaps. */
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200d\ufe0e\ufe0f\u20e3]/gu;
/** A line that is a list item: "- x", "* x", "• x", "1. x", "2) x". */
const LIST_ITEM = /^\s*(?:[-+*•·]|\d+[.)])\s+/;
/** "." between two digits is part of a number ("15.50"), not the end of a sentence. */
const DECIMAL_DOT = /(\d)\.(?=\d)/g;
const DOT_PLACEHOLDER = "\u0000";

const hasWord = (s: string) => /[\p{L}\p{N}]/u.test(s);

/**
 * Splits text into sentences, each with its own end punctuation. A sentence
 * ends at ".", "!", "?" or "…" (a run of them counts once).
 */
export function splitSentences(text: string): string[] {
  const protectedText = text.replace(DECIMAL_DOT, `$1${DOT_PLACEHOLDER}`);
  const parts = protectedText.match(/[^.!?…]+[.!?…]*|[.!?…]+/g) ?? [];
  return parts.map((p) => p.replaceAll(DOT_PLACEHOLDER, ".").trim()).filter(hasWord);
}

function clampWords(sentence: string): string {
  const end = sentence.match(/[.!?…]+$/)?.[0] ?? "";
  const body = end ? sentence.slice(0, -end.length) : sentence;
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_WORDS) return sentence;
  return `${words.slice(0, MAX_WORDS).join(" ").replace(/[,;:]+$/, "")}${end || "."}`;
}

/** Upper bound for the fixed-point loop; real replies settle in 1 or 2 passes. */
const MAX_PASSES = 8;

/**
 * Removing one thing can expose another: "*1. x" loses the "*" and becomes
 * the list item "1. x"; "? 1. x" loses the empty sentence "?" and starts with
 * "1. ". So the cleanup runs until the text stops changing, which also makes
 * the function idempotent.
 */
export function toSpokenReply(text: string): string {
  let out = spokenPass(text);
  for (let k = 1; k < MAX_PASSES; k += 1) {
    const next = spokenPass(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function spokenPass(text: string): string {
  const lines = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](url) → label
    .split(/\r?\n/)
    // Clean each line before looking for its list marker, so "*1. x" or "1⃣. x" is seen as "1. x".
    .map((l) => l.replace(EMOJI, "").replace(MARKUP, "").replace(LIST_ITEM, "").trim())
    .filter(Boolean);
  const flat = lines
    .join(", ")
    .replace(EMOJI, "")
    .replace(MARKUP, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?…;:])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .trim();
  return splitSentences(flat)
    .slice(0, MAX_SENTENCES)
    .map((s) => clampWords(s.replace(/^[,;:\s]+/, "")))
    .join(" ");
}

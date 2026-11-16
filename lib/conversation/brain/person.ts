import { countryForTimeZone, normalizePhone } from "../fields";
import { looksLikeName } from "../names";
import { lexiconWords, phrasesOf } from "./lexicon";
import { phraseAt, tokenize, words, type Tok } from "./normalize";
import { numbersAt } from "./numbers";

/**
 * Name and phone reading (front-desk-brain 6.1–6.5; design.md "Name and phone"). Pure.
 */

export const MAX_NAME_WORDS = 5;

export interface NameOptions {
  /** The next field the booking needs is the name: an utterance of 1–4 words with no cue may be one (6.2). */
  expectName: boolean;
  ownerName: string;
  shopName: string;
  /** Words that are never a name without a cue: service and Category words of the shop. */
  isShopWord?: (w: string) => boolean;
  /** Token indices another reader placed. */
  skip?: (i: number) => boolean;
}

export interface NameReading {
  name: string;
  placed: ReadonlySet<number>;
}

/** After a cue, a name never starts with one of these ("soy de Madrid", "I'm calling", "it's for tomorrow"). */
const NOT_A_NAME_START = new Set(
  [
    "de", "del", "la", "el", "los", "las", "un", "una", "yo", "nueva", "nuevo", "cliente", "clienta", "muy", "su", "tu",
    "a", "an", "the", "for", "not", "just", "here", "so", "very", "looking", "going", "calling", "wondering",
    "interested", "free", "available", "ok", "okay", "fine", "sorry", "about", "at", "on", "in", "to",
  ],
);

/** The words of the shop's name and owner name, which are never the Caller's name without a cue (6.3). */
function addressWords(opts: NameOptions): Set<string> {
  return new Set([...words(opts.ownerName), ...words(opts.shopName)]);
}

function cleanRaw(toks: readonly Tok[]): string {
  return toks
    .map((t) => t.raw)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The Caller's name, or null. */
export function readName(text: string | readonly Tok[], opts: NameOptions): NameReading | null {
  const toks = typeof text === "string" ? tokenize(text) : text;
  const skip = opts.skip ?? (() => false);
  const lex = lexiconWords();
  const cues = [...phrasesOf("es", "nameCues"), ...phrasesOf("en", "nameCues")];
  const stops = [
    ...phrasesOf("es", "phoneCues"),
    ...phrasesOf("en", "phoneCues"),
    ...cues,
    ...phrasesOf("es", "booking"),
    ...phrasesOf("en", "booking"),
    ...phrasesOf("es", "wanting"),
    ...phrasesOf("en", "wanting"),
  ];

  // 6.1: after a cue, up to 5 words, stopping at punctuation, a digit or the next cue.
  for (let i = toks.length - 1; i >= 0; i--) {
    for (const cue of cues) {
      if (!phraseAt(toks, i, cue)) continue;
      const startAt = i + cue.length;
      const first = toks[startAt];
      if (!first || skip(startAt) || NOT_A_NAME_START.has(first.w) || /\d/.test(first.w)) continue;
      const picked: Tok[] = [];
      const placed = new Set<number>();
      for (let k = startAt; k < toks.length && picked.length < MAX_NAME_WORDS; k++) {
        const t = toks[k];
        if (k > startAt && t.brk) break;
        if (/\d/.test(t.w) || skip(k)) break;
        if (stops.some((s) => phraseAt(toks, k, s))) break;
        if ((t.w === "y" || t.w === "and") && k + 1 < toks.length && (lex.has(toks[k + 1].w) || /\d/.test(toks[k + 1].w))) break;
        if (t.w === "y" || t.w === "and") break;
        picked.push(t);
        placed.add(k);
      }
      // Trailing everyday words ("soy Ana, gracias" is cut at the comma; "soy Ana pues" drops "pues").
      while (picked.length > 0 && lex.has(picked[picked.length - 1].w) && picked.length > 1) {
        picked.pop();
      }
      if (picked.length === 0) continue;
      const name = cleanRaw(picked);
      if (!looksLikeName(name)) continue;
      for (let k = i; k < startAt; k++) placed.add(k);
      return { name, placed: new Set([...placed].filter((k) => k < startAt + picked.length)) };
    }
  }

  // 6.2: no cue, while the name is the next field.
  if (!opts.expectName) return null;
  const greet = new Set([...phrasesOf("es", "greeting"), ...phrasesOf("en", "greeting")].filter((p) => p.length === 1).map((p) => p[0]));
  const filler = new Set([...phrasesOf("es", "filler"), ...phrasesOf("en", "filler"), ...phrasesOf("es", "thanks"), ...phrasesOf("en", "thanks")].filter((p) => p.length === 1).map((p) => p[0]));
  const idx: number[] = [];
  toks.forEach((t, k) => {
    if (!skip(k)) idx.push(k);
  });
  while (idx.length > 0 && (greet.has(toks[idx[0]].w) || filler.has(toks[idx[0]].w))) idx.shift();
  while (idx.length > 0 && filler.has(toks[idx[idx.length - 1]].w)) idx.pop();
  if (idx.length === 0 || idx.length > 4) return null;
  // Contiguous only: a name is said in one piece.
  if (idx[idx.length - 1] - idx[0] !== idx.length - 1) return null;
  const said = idx.map((k) => toks[k]);
  const addr = addressWords(opts);
  if (said.some((t) => lex.has(t.w) || (opts.isShopWord?.(t.w) ?? false) || /\d/.test(t.w))) return null;
  // A number word ("cinco", "seis uno dos") is a time or a phone, never a name.
  if (said.some((_, k) => numbersAt(toks, idx[k]).length > 0)) return null;
  if (said.every((t) => addr.has(t.w))) return null;
  const name = cleanRaw(said);
  if (!looksLikeName(name)) return null;
  return { name, placed: new Set(idx) };
}

// ---------------------------------------------------------------------------
// Phone

export interface PhoneReading {
  /** E.164 through `normalizePhone`, or null. */
  phone: string | null;
  /** Digits were heard but `normalizePhone` refused them (6.5). */
  rejected: boolean;
  placed: ReadonlySet<number>;
}

/** The fewest digits a run needs to be read as a phone attempt. */
const MIN_PHONE_DIGITS = 6;
const MAX_PHONE_DIGITS = 15;

/**
 * The digit strings a run of number tokens can mean, best first: digits as written, number
 * words in groups of 1–3 digits ("treinta y cuatro" → 34, "seiscientos doce" → 612, "cero" → 0).
 * Longer number phrases come first; the caller picks the first string `normalizePhone` accepts,
 * so "doscientos cinco" is 205 where that makes a valid number and 2005 where only that does.
 */
function digitStrings(toks: readonly Tok[], from: number, to: number): string[] {
  const memo = new Map<number, string[]>();
  const LIMIT = 64;
  const go = (i: number): string[] => {
    if (i === to) return [""];
    const cached = memo.get(i);
    if (cached) return cached;
    const out: string[] = [];
    const t = toks[i];
    if (/^\d+$/.test(t.w)) {
      for (const rest of go(i + 1)) if (out.length < LIMIT) out.push(t.w + rest);
    } else {
      for (const h of numbersAt(toks, i, { noBreak: true })) {
        if (i + h.len > to || h.value > 999) continue;
        for (const rest of go(i + h.len)) {
          if (out.length >= LIMIT) break;
          const s = String(h.value) + rest;
          if (s.length <= MAX_PHONE_DIGITS + 2) out.push(s);
        }
      }
    }
    memo.set(i, out);
    return out;
  };
  return go(from);
}

function isNumberTok(toks: readonly Tok[], i: number): boolean {
  const t = toks[i];
  if (!t) return false;
  if (/^\d+$/.test(t.w)) return true;
  return numbersAt(toks, i).some((h) => h.value <= 999);
}

/** The Caller's phone, from digits or number words, through `normalizePhone` (6.4, 6.5). */
export function readPhone(text: string, timeZone: string, opts: { skip?: (i: number) => boolean } = {}): PhoneReading {
  const toks = tokenize(text);
  const skip = opts.skip ?? (() => false);
  const country = countryForTimeZone(timeZone);
  // Runs of number tokens; "y" / "and" may sit inside a number ("treinta y cuatro").
  const runs: { from: number; to: number; plus: boolean }[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (skip(i) || !isNumberTok(toks, i)) continue;
    let j = i;
    while (j < toks.length && !skip(j) && (isNumberTok(toks, j) || ((toks[j].w === "y" || toks[j].w === "and") && isNumberTok(toks, j + 1))))
      j++;
    const before = toks[i - 1]?.w;
    const plusWord = before === "mas" || before === "plus";
    runs.push({ from: plusWord ? i - 1 : i, to: j, plus: plusWord });
    i = j;
  }
  // A "+" written before the digits ("+34 612…").
  const rawPlus = /\+\s*\d/.test(text);

  let best: { phone: string | null; digits: number; placed: Set<number> } | null = null;
  for (const run of runs) {
    const start = run.plus ? run.from + 1 : run.from;
    const strings = digitStrings(toks, start, run.to);
    const longest = strings.reduce((m, s) => Math.max(m, s.length), 0);
    if (longest < MIN_PHONE_DIGITS) continue;
    const placed = new Set<number>();
    for (let k = run.from; k < run.to; k++) placed.add(k);
    let phone: string | null = null;
    for (const s of strings) {
      const candidate = (run.plus || rawPlus ? "+" : "") + s;
      phone = normalizePhone(candidate, country);
      if (phone) break;
    }
    if (!best || (phone && !best.phone) || (!!phone === !!best.phone && longest > best.digits)) {
      best = { phone, digits: longest, placed };
    }
  }
  if (!best) return { phone: null, rejected: false, placed: new Set() };
  return { phone: best.phone, rejected: best.phone === null, placed: best.placed };
}

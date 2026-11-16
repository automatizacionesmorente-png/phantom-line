/**
 * The Code_Brain's text primitives (front-desk-brain 3.1, 4.1, 4.2). Pure, no I/O.
 *
 * Every reader works on the same tokens: lower case, no accents, letters and digits only,
 * exactly as `normalizeText` writes them, with two additions the readers need:
 * - a clock time written with a separator ("17:30", "17.30", "4:00") is kept as one token
 *   "17h30", so the separator is not lost; "17h" and "5pm" already are one token; a D/M date
 *   ("20/11") is one token "20d11";
 * - each token remembers whether punctuation came right before it (`brk`) and its surface
 *   text as said (`raw`), so a negation never crosses a comma and a name keeps its capitals.
 */

export interface Tok {
  /** Normalized: lower case, no accents, [a-z0-9] only. */
  w: string;
  /** The word as the Caller (or Chrome) wrote it, punctuation stripped. */
  raw: string;
  /** Punctuation (, . ; : ! ? ¿ ¡ — …) or the start of the text came right before this token. */
  brk: boolean;
}

const ACCENTS = /[\u0300-\u036f]/g;
/** H:MM or H.MM with 1–2 hour digits, not part of a longer digit run ("612.345.678" stays digits). */
const CLOCK = /(?<![\d.:])(\d{1,2})[:.](\d{2})(?![\d]|[.:]\d)/g;
/** D/M or D/M/Y with 1–2 day and month digits: one token "20d11", so the date is not read as two numbers. */
const SLASH_DATE = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(?:\d{4}|\d{2}))?(?![\d]|\/\d)/g;
const BREAK = /[,.;:!?¿¡—–…()"]/;

/** Lower case and no accents, everything else kept. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(ACCENTS, "").toLowerCase();
}

/** The tokens of an utterance. Never throws. */
export function tokenize(text: string): Tok[] {
  const glued = text.replace(SLASH_DATE, "$1d$2").replace(CLOCK, "$1h$2");
  const out: Tok[] = [];
  let brk = true;
  // Split on whitespace and punctuation, remembering where punctuation was.
  const parts = glued.split(/(\s+|[,.;:!?¿¡—–…()"/\\+*_#=<>[\]{}|~^`'’-])/u);
  for (const part of parts) {
    if (part === undefined || part === "") continue;
    if (/^\s+$/.test(part)) continue;
    if (BREAK.test(part) && part.length === 1) {
      brk = true;
      continue;
    }
    const w = fold(part).replace(/[^a-z0-9]+/g, " ").trim();
    if (w === "") continue;
    for (const piece of w.split(" ")) {
      out.push({ w: piece, raw: part.replace(/[^\p{L}\p{N}]+/gu, "") || piece, brk });
      brk = false;
    }
  }
  return out;
}

/** The normalized words of a phrase (an alias, a lexicon entry). */
export function words(phrase: string): string[] {
  return tokenize(phrase).map((t) => t.w);
}

/** A normalized phrase as one string ("corte de hombre"). */
export function phraseKey(phrase: string): string {
  return words(phrase).join(" ");
}

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/**
 * The forms a word may take once a plural is folded (4.1), on words of 4 letters or more:
 * the word itself, without a final `s`, and without a final `es` after a consonant. Both
 * sides of a comparison are folded, and two words are the same when their forms meet, so
 * "mechas" = "mecha", "fades" = "fade" and "colores" = "color".
 */
export function pluralForms(w: string): string[] {
  if (w.length < 4 || !w.endsWith("s") || /\d/.test(w)) return [w];
  const forms = [w, w.slice(0, -1)];
  if (w.endsWith("es") && w.length >= 5 && !VOWELS.has(w[w.length - 3])) forms.push(w.slice(0, -2));
  return forms;
}

/** Whether two normalized words are equal once plurals are folded. */
export function samePlural(a: string, b: string): boolean {
  if (a === b) return true;
  const fa = pluralForms(a);
  const fb = pluralForms(b);
  return fa.some((x) => fb.includes(x));
}

/**
 * Damerau–Levenshtein distance (optimal string alignment: insertion, deletion, substitution,
 * and a swap of two adjacent letters), stopping early once it passes `max`.
 */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  let prev2 = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = new Array<number>(m + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

/**
 * How many typos an alias word may carry (4.2): none up to 4 letters, one from 5 to 8,
 * two from 9 on. Words with a digit never take a typo.
 */
export function typoAllowance(aliasWord: string): number {
  if (/\d/.test(aliasWord)) return 0;
  if (aliasWord.length <= 4) return 0;
  return aliasWord.length <= 8 ? 1 : 2;
}

/**
 * How a said word matches an alias word: `exact` (plurals folded), `typo` (within the
 * allowance, and the said word is not itself a protected word: another alias word or a
 * lexicon word), or null.
 */
export function wordMatch(
  said: string,
  aliasWord: string,
  isProtected: (w: string) => boolean,
): "exact" | "typo" | null {
  if (samePlural(said, aliasWord)) return "exact";
  const allow = typoAllowance(aliasWord);
  if (allow === 0 || said.length <= 4 || /\d/.test(said)) return null;
  if (isProtected(said)) return null;
  const forms = pluralForms(said);
  return forms.some((f) => editDistance(f, aliasWord, allow) <= allow) ? "typo" : null;
}

// ---------------------------------------------------------------------------
// Spans: where a phrase's words occur in the utterance.

export interface PhraseEntry<T> {
  /** Normalized words of the phrase. */
  words: readonly string[];
  /** Total letters, for the longest-match tie break. */
  letters: number;
  value: T;
  /** Each word's plural forms and typo allowance, computed once. */
  forms?: readonly (readonly string[])[];
  allow?: readonly number[];
}

export interface Span<T> {
  start: number;
  /** Exclusive. */
  end: number;
  entry: PhraseEntry<T>;
  typos: number;
  /** Words matched only through plural folding or a typo, not as written. */
  inexact: number;
}

export function entry<T>(phrase: string, value: T): PhraseEntry<T> | null {
  const ws = words(phrase);
  if (ws.length === 0) return null;
  return { words: ws, letters: ws.join("").length, value, forms: ws.map(pluralForms), allow: ws.map(typoAllowance) };
}

/** The unfiltered spans of one utterance per entry list, so the readers share one pass (2.6). */
const SPAN_CACHE = new WeakMap<readonly Tok[], Map<unknown, Span<unknown>[]>>();

/** Every place an entry's words match consecutive tokens, exactly or within the typo rule. */
export function findSpans<T>(
  toks: readonly Tok[],
  entries: readonly PhraseEntry<T>[],
  isProtected: (w: string) => boolean,
  opts: { fuzzy?: boolean; skip?: (i: number) => boolean } = {},
): Span<T>[] {
  const fuzzy = opts.fuzzy ?? true;
  let all: Span<T>[] | undefined;
  if (fuzzy) {
    let perToks = SPAN_CACHE.get(toks);
    if (!perToks) {
      perToks = new Map();
      SPAN_CACHE.set(toks, perToks);
    }
    all = perToks.get(entries) as Span<T>[] | undefined;
    if (!all) {
      all = computeSpans(toks, entries, isProtected, true);
      perToks.set(entries, all as Span<unknown>[]);
    }
  } else all = computeSpans(toks, entries, isProtected, false);
  const skip = opts.skip;
  if (!skip) return all;
  return all.filter((s) => {
    for (let k = s.start; k < s.end; k++) if (skip(k)) return false;
    return true;
  });
}

function computeSpans<T>(
  toks: readonly Tok[],
  entries: readonly PhraseEntry<T>[],
  isProtected: (w: string) => boolean,
  fuzzy: boolean,
): Span<T>[] {
  const said = toks.map((t) => t.w);
  const saidForms = said.map(pluralForms);
  // A said word may take a typo only if it is long enough, has no digit and is not protected.
  const typoable = said.map((w) => fuzzy && w.length > 4 && !/\d/.test(w) && !isProtected(w));
  const out: Span<T>[] = [];
  for (const e of entries) {
    const forms = e.forms ?? e.words.map(pluralForms);
    const allow = e.allow ?? e.words.map(typoAllowance);
    const n = e.words.length;
    for (let i = 0; i + n <= said.length; i++) {
      let typos = 0;
      let inexact = 0;
      let ok = true;
      for (let k = 0; k < n; k++) {
        const s = said[i + k];
        const a = e.words[k];
        if (s === a) continue;
        const sf = saidForms[i + k];
        const af = forms[k];
        let exact = false;
        for (const x of sf) if (af.includes(x)) exact = true;
        if (exact) {
          inexact++;
          continue;
        }
        const max = allow[k];
        if (max === 0 || !typoable[i + k] || Math.abs(s.length - a.length) > max + 2) {
          ok = false;
          break;
        }
        let near = false;
        for (const f of sf) if (editDistance(f, a, max) <= max) near = true;
        if (!near) {
          ok = false;
          break;
        }
        typos++;
        inexact++;
      }
      if (ok) out.push({ start: i, end: i + n, entry: e, typos, inexact });
    }
  }
  return out;
}

/**
 * Longest span first (in words, then the one matched as written over one matched through a
 * plural or a typo, then letters, then earlier), dropping any span that overlaps one already
 * kept (4.3). The result is in utterance order.
 */
export function longestSpans<T>(spans: readonly Span<T>[]): Span<T>[] {
  const sorted = [...spans].sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) ||
      a.inexact - b.inexact ||
      b.entry.letters - a.entry.letters ||
      a.typos - b.typos ||
      a.start - b.start,
  );
  const used: boolean[] = [];
  const kept: Span<T>[] = [];
  for (const s of sorted) {
    let free = true;
    for (let i = s.start; i < s.end; i++) if (used[i]) free = false;
    if (!free) continue;
    for (let i = s.start; i < s.end; i++) used[i] = true;
    kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Whether a phrase (normalized words) occurs at token i, exactly (plurals folded). */
export function phraseAt(toks: readonly Tok[], i: number, phrase: readonly string[]): boolean {
  if (i < 0 || i + phrase.length > toks.length) return false;
  for (let k = 0; k < phrase.length; k++) if (toks[i + k].w !== phrase[k]) return false;
  return true;
}

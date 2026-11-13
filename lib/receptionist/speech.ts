/**
 * Requirement 4.11: what the receptionist says is one or two short spoken
 * sentences, each at most 25 words, with no lists, emoji or markdown.
 * Every reply, templated or from the model, goes through `toSpokenReply`.
 */

import type { Lang } from "@/lib/sectors";
import {
  DIGIT_WORDS,
  MAX_SPOKEN_NUMBER,
  PERIODS,
  clockWords,
  inPeriod,
  periodOf,
  speakDigits,
  speakNumber,
  speakOrdinal,
  speakPhone,
  speakPrice,
  speakTime,
  type TimeContext,
} from "./spoken";

/** The model's own replies keep 2 sentences (core-call-loop 4.11, natural-voice 11.3). */
export const MAX_SENTENCES = 2;
/** Code-owned templates may use 3 (natural-voice 9.7). */
export const MAX_TEMPLATE_SENTENCES = 3;
export const MAX_WORDS = 25;

export interface SpokenOptions {
  /** How many sentences to keep. Default `MAX_SENTENCES`; templates pass `MAX_TEMPLATE_SENTENCES`. */
  maxSentences?: number;
}

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
export function toSpokenReply(text: string, lang?: Lang, opts: SpokenOptions = {}): string {
  // With no language the behaviour is exactly what it was, so property S4 is unchanged.
  // With a language, leftover digits become words (natural-voice 11.4, property N9).
  const maxSentences = opts.maxSentences ?? MAX_SENTENCES;
  let out = spokenPass(text, maxSentences, lang);
  for (let k = 1; k < MAX_PASSES; k += 1) {
    const next = spokenPass(out, maxSentences, lang);
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * A code-owned line as the caller hears and reads it: up to 3 short sentences (Requirement 9.7).
 * `handleTurn` and the voice cache plan both use this, so a planned line is the exact text a
 * Call will ask the cache for.
 */
export function spokenTemplate(text: string, lang: Lang): string {
  return toSpokenReply(text, lang, { maxSentences: MAX_TEMPLATE_SENTENCES });
}

function spokenPass(text: string, maxSentences: number, lang?: Lang): string {
  const lines = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](url) → label
    .split(/\r?\n/)
    // Clean each line before looking for its list marker, so "*1. x" or "1⃣. x" is seen as "1. x".
    .map((l) => l.replace(EMOJI, "").replace(MARKUP, "").replace(LIST_ITEM, "").trim())
    .filter(Boolean);
  const cleaned = tidy(lines.join(", ").replace(EMOJI, "").replace(MARKUP, ""));
  const flat = lang ? tidy(digitsToWords(cleaned, lang)) : cleaned;
  return splitSentences(flat)
    .slice(0, maxSentences)
    .map((s) => clampWords(s.replace(/^[,;:\s]+/, "")))
    .join(" ");
}

function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?…;:])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .trim();
}

// ---------------------------------------------------------------------------
// The safety net (natural-voice 11.4): digits the model still wrote become the
// Spoken_Form, in the order of design.md. Each step only sees what the steps
// before it left; the last one turns every remaining digit run into words, so
// the result never has a digit and a second pass has nothing left to change.

const NOT_AFTER_WORD = String.raw`(?<![\p{L}\p{N}])`;
/** "a.m." takes its last dot only when it has the first one, so "at 12 am." keeps its sentence end. */
const AMPM = String.raw`[ap]\.\s?m\.|[ap]\s?m`;
const PERIOD_PHRASES = String.raw`de\s+la\s+mañana|del\s+mediodía|de\s+la\s+tarde|de\s+la\s+noche|de\s+la\s+madrugada|in\s+the\s+morning|in\s+the\s+afternoon|in\s+the\s+evening|at\s+night`;
const NOT_PRICE = String.raw`(?!\s*(?:€|euros?(?![\p{L}])|eur(?![\p{L}])))`;

/**
 * 1. A clock time: "a las 17:15h", "17:15", "a las 10.30", "a las 17", "5:30 pm",
 * "las 4 de la tarde". A bare hour ("17") counts only after "a las" / "a la" /
 * "at" or with "h", "am" / "pm" or a period of the day; a dotted time ("10.30")
 * only after one of those or with "h", so "15.50" stays a number.
 */
const TIME = new RegExp(
  NOT_AFTER_WORD +
    String.raw`(?:(?<prep>a\s+las|a\s+la|at|las|la|a)\s+)?` +
    String.raw`(?<!\d)(?<h>\d{1,2})(?:(?<sep>[:.])(?<m>\d{2}))?(?!\d)(?![.,:]\d)(?!(?:st|nd|rd|th)(?![\p{L}]))` +
    NOT_PRICE +
    String.raw`(?<suffix>\s?(?:horas|hrs|h)(?![\p{L}\p{N}]))?` +
    String.raw`(?:\s*(?<ampm>${AMPM})(?![\p{L}])|\s+(?<period>${PERIOD_PHRASES})(?![\p{L}]))?`,
  "giu",
);

/** The ranges a stated period of the day allows, by its words, in both languages. */
const PERIOD_RANGES: readonly { words: string; from: number; to: number }[] = [
  ...PERIODS.es,
  ...PERIODS.en,
  { words: "de la madrugada", from: 0, to: 6 * 60 },
];

/** 2. Prices: "15 €", "15,50 €", "1.500 €", "€15", "€ 15.50", "15 euros". */
const AMOUNT = String.raw`(?<int>\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](?<dec>\d{1,2}))?(?!\d)`;
const PRICE_AFTER = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,])${AMOUNT}\s*(?:€|euros?(?![\p{L}])|eur(?![\p{L}]))`,
  "giu",
);
const PRICE_BEFORE = new RegExp(String.raw`€\s*${AMOUNT}`, "gu");

/** 3. A run of 6 or more digits, spaces, dots or hyphens allowed between them (a phone). */
const DIGIT_RUN = /\+?(?<!\d)\d(?:[ .-]?\d){5,}(?!\d)/g;

/** 4. English ordinals ("13th"), and Spanish ones ("1º", "2.ª"). */
const EN_ORDINAL = new RegExp(String.raw`${NOT_AFTER_WORD}(?<n>\d{1,6})(?:st|nd|rd|th)(?![\p{L}])`, "giu");
const ES_ORDINAL = new RegExp(String.raw`${NOT_AFTER_WORD}(?<n>\d{1,2})\.?(?<g>[ºª°])`, "gu");
const ES_ORDINAL_WORDS = ["", "primer", "segund", "tercer", "cuart", "quint", "sext", "séptim", "octav", "noven", "décim"];

/** 5. Any other number: "3", "1.500", "2,5", "007". */
const NUMBER = /\d+(?:[.,]\d+)*/g;

type Groups = Record<string, string | undefined>;

/**
 * `text.replace` with the replacement padded by a space where it would touch a
 * letter or a digit, and capitalised when it starts a sentence or replaces a
 * capitalised word ("A las 17:00" → "A las cinco de la tarde").
 */
function replaceSpoken(text: string, re: RegExp, fn: (match: string, g: Groups) => string | null): string {
  return text.replace(re, (...args: unknown[]) => {
    const match = args[0] as string;
    const hasGroups = typeof args[args.length - 1] === "object" && args[args.length - 1] !== null;
    const groups = (hasGroups ? args[args.length - 1] : {}) as Groups;
    const whole = (hasGroups ? args[args.length - 2] : args[args.length - 1]) as string;
    const offset = (hasGroups ? args[args.length - 3] : args[args.length - 2]) as number;
    const words = fn(match, groups);
    if (words === null) return match;
    const before = whole.slice(0, offset);
    const after = whole.slice(offset + match.length);
    const startsSentence = /^\s*$/.test(before) || /[.!?…]\s*$/.test(before);
    const capital = startsSentence || /^\p{Lu}/u.test(match);
    let out = capital ? words.charAt(0).toUpperCase() + words.slice(1) : words;
    if (/[\p{L}\p{N}]$/u.test(before)) out = ` ${out}`;
    if (/^[\p{L}\p{N}]/u.test(after)) out = `${out} `;
    // "At 9 a.m." ends a sentence with the dot of "a.m.": keep that end.
    if (match.endsWith(".") && /^(?:\s*$|\s+\p{Lu})/u.test(after)) out = `${out}.`;
    return out;
  });
}

function resolveTime(g: Groups): { minute: number; known: boolean } | null {
  const h = Number(g.h);
  const m = g.m === undefined ? 0 : Number(g.m);
  if (h > 23 || m > 59) return null;
  if (g.ampm) {
    if (h < 1 || h > 12) return { minute: h * 60 + m, known: true };
    const pm = /^p/i.test(g.ampm);
    return { minute: ((h % 12) + (pm ? 12 : 0)) * 60 + m, known: true };
  }
  if (g.period) {
    const words = g.period.toLowerCase().replace(/\s+/g, " ");
    const range = PERIOD_RANGES.find((p) => p.words === words);
    const candidates = [(h % 12) * 60 + m, ((h % 12) + 12) * 60 + m];
    const inRange = range ? candidates.find((c) => inPeriod(c, range)) : undefined;
    return { minute: inRange ?? h * 60 + m, known: true };
  }
  // "a las 4" or "4:00" could be morning or afternoon: say the clock words and no period
  // rather than guess one. "04:00", "10:00", "17", "12" and "0" are read as written.
  const ambiguous = h >= 1 && h <= 11 && (g.m === undefined || g.h!.length === 1);
  return { minute: h * 60 + m, known: !ambiguous };
}

function spokenTime(g: Groups, lang: Lang): { words: string; period: string | null } | null {
  const prep = g.prep?.toLowerCase().replace(/\s+/g, " ");
  const strongPrep = prep === "a las" || prep === "a la" || prep === "at";
  const suffixH = g.suffix !== undefined && g.suffix.trim().toLowerCase() === "h";
  const marked = Boolean(g.ampm || g.period || g.suffix);
  if (g.m === undefined && !(strongPrep || g.ampm || g.period || suffixH)) return null;
  if (g.sep === "." && !(strongPrep || marked)) return null;
  const resolved = resolveTime(g);
  if (!resolved) return null;
  const t = { hour: Math.floor(resolved.minute / 60), minute: resolved.minute % 60 };
  // A one-minute session around the time drops the period of the day (it is never
  // midnight or noon here, because those are always `known`).
  const ctx: TimeContext | undefined = resolved.known
    ? undefined
    : { sessions: [{ open: resolved.minute, close: resolved.minute + 1 }] };
  const words =
    prep === undefined || prep === "las" || prep === "la" ? clockWords(t, lang, ctx) : speakTime(t, lang, ctx);
  // Noon and midnight always keep their words (Requirement 6.5); any other period may be shared.
  const period = periodOf(t, lang);
  const shareable = resolved.minute % 720 !== 0 && words.endsWith(` ${period}`);
  return { words, period: shareable ? period : null };
}

/** What may stand between two times of one list: ", ", " o ", ", or ", " y ", " to " and the like. */
const TIME_LIST_GAP = /^\s*,?\s*(?:(?:o|y|u|or|and|to|hasta|until)\s+)?$/i;

/**
 * Step 1 of the safety net. Each time is said with its period of the day, but
 * when several times in a row share one ("a las 17:00, a las 17:15 o a las
 * 17:30") the period is said once, after the last: "a las cinco, a las cinco y
 * cuarto o a las cinco y media de la tarde". Every time is still unambiguous,
 * and the sentence stays inside the 25-word limit.
 */
function timesToWords(text: string, lang: Lang): string {
  const found = [...text.matchAll(TIME)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    spoken: spokenTime((m.groups ?? {}) as Groups, lang),
  }));
  const words = found.map((f, i) => {
    if (!f.spoken) return null;
    const { period } = f.spoken;
    const next = found[i + 1];
    const shared = period !== null && next?.spoken?.period === period && TIME_LIST_GAP.test(text.slice(f.end, next.start));
    return shared ? f.spoken.words.slice(0, -(period.length + 1)) : f.spoken.words;
  });
  let k = 0;
  return replaceSpoken(text, TIME, () => words[k++] ?? null);
}

function spokenPrice(g: Groups, lang: Lang): string | null {
  const euros = Number(g.int!.replace(/[.,]/g, ""));
  if (euros > MAX_SPOKEN_NUMBER) return null;
  const cents = g.dec === undefined ? 0 : Number(g.dec.padEnd(2, "0"));
  return speakPrice(euros * 100 + cents, lang);
}

function digitWords(digits: string, lang: Lang): string {
  return digits
    .split("")
    .map((d) => DIGIT_WORDS[lang][Number(d)])
    .join(" ");
}

/** A whole number in words; a run with a leading zero or past 999 999 is read digit by digit. */
function wholeNumber(digits: string, lang: Lang): string {
  if ((digits.length > 1 && digits.startsWith("0")) || Number(digits) > MAX_SPOKEN_NUMBER) {
    return speakDigits(digits, lang);
  }
  return speakNumber(Number(digits), lang);
}

/** "1.500" → mil quinientos, "2,5" → dos coma cinco / two point five, "1.2.3" → each part. */
function spokenNumber(token: string, lang: Lang): string {
  const parts = token.split(/[.,]/);
  const seps = token.replace(/\d/g, "");
  if (parts.length === 1) return wholeNumber(token, lang);
  const sameSep = new Set(seps).size === 1;
  if (sameSep && parts[0].length <= 3 && parts.slice(1).every((p) => p.length === 3)) {
    return wholeNumber(parts.join(""), lang);
  }
  if (parts.length === 2) {
    const [int, frac] = parts;
    const fraction =
      lang === "es" && frac.length <= 2 && !frac.startsWith("0") ? speakNumber(Number(frac), "es") : digitWords(frac, lang);
    return `${wholeNumber(int, lang)} ${lang === "es" ? "coma" : "point"} ${fraction}`;
  }
  return parts.map((p) => wholeNumber(p, lang)).join(" ");
}

/**
 * Leftover digits as words, in the reply's language: times, then prices, then
 * long digit runs (phones), then ordinals, then any other number. Exported for
 * the unit tests; `toSpokenReply(text, lang)` is what callers use.
 */
export function digitsToWords(text: string, lang: Lang): string {
  if (!/\d/.test(text)) return text;
  let out = timesToWords(text, lang);
  out = replaceSpoken(out, PRICE_AFTER, (_, g) => spokenPrice(g, lang));
  out = replaceSpoken(out, PRICE_BEFORE, (_, g) => spokenPrice(g, lang));
  out = replaceSpoken(out, DIGIT_RUN, (match) =>
    match.startsWith("+") ? speakPhone(match, lang) : speakDigits(match, lang),
  );
  if (lang === "en") {
    out = replaceSpoken(out, EN_ORDINAL, (_, g) => {
      const n = Number(g.n);
      return n === 0 ? "zeroth" : speakOrdinal(n);
    });
  } else {
    out = replaceSpoken(out, ES_ORDINAL, (_, g) => {
      const n = Number(g.n);
      if (n < 1 || n > 10) return null;
      return `${ES_ORDINAL_WORDS[n]}${g.g === "ª" ? "a" : "o"}`;
    });
  }
  return replaceSpoken(out, NUMBER, (match) => spokenNumber(match, lang));
}

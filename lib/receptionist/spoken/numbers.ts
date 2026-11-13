import type { Lang } from "@/lib/sectors";

/**
 * Numbers, prices and phone numbers in words, as people say them. Pure: no
 * I/O, no digits in any output. The inverse functions live in `parse.ts`.
 */

export const MAX_SPOKEN_NUMBER = 999_999;

const ES_UNITS = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete",
  "veintiocho", "veintinueve",
] as const;
const ES_TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"] as const;
const ES_HUNDREDS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos",
  "ochocientos", "novecientos",
] as const;

const EN_UNITS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
] as const;
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;

export const DIGIT_WORDS: Record<Lang, readonly string[]> = {
  es: ES_UNITS.slice(0, 10),
  en: EN_UNITS.slice(0, 10),
};

export interface SpeakNumberOptions {
  /**
   * Spanish only: the form used before a masculine noun ("un euro",
   * "veintiún euros", "ciento un euros") instead of "uno", "veintiuno".
   */
  apocope?: boolean;
}

function assertSpeakable(n: number): void {
  if (!Number.isInteger(n) || n < 0 || n > MAX_SPOKEN_NUMBER) {
    throw new RangeError(`speakNumber covers whole numbers from 0 to ${MAX_SPOKEN_NUMBER}`);
  }
}

/** 1–99 in Spanish. With `apocope`, a final "uno" becomes "un" and "veintiuno" "veintiún". */
function es99(n: number, apocope: boolean): string {
  if (n < 30) {
    if (apocope && n === 1) return "un";
    if (apocope && n === 21) return "veintiún";
    return ES_UNITS[n];
  }
  const unit = n % 10;
  const tens = ES_TENS[Math.floor(n / 10)];
  if (unit === 0) return tens;
  return `${tens} y ${apocope && unit === 1 ? "un" : ES_UNITS[unit]}`;
}

/** 1–999 in Spanish: "cien" alone, "ciento" before a remainder. */
function es999(n: number, apocope: boolean): string {
  if (n === 100) return "cien";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(ES_HUNDREDS[hundreds]);
  if (rest > 0) parts.push(es99(rest, apocope));
  return parts.join(" ");
}

function en99(n: number): string {
  if (n < 20) return EN_UNITS[n];
  const unit = n % 10;
  const tens = EN_TENS[Math.floor(n / 10)];
  return unit === 0 ? tens : `${tens}-${EN_UNITS[unit]}`;
}

/** 1–999 in en-US, with no "and": "one hundred five". */
function en999(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${EN_UNITS[hundreds]} hundred`);
  if (rest > 0) parts.push(en99(rest));
  return parts.join(" ");
}

/**
 * A whole number from 0 to 999 999 in words: "veintiuno", "ciento uno",
 * "veintiún mil", "one hundred five", "twenty-one thousand". Throws a
 * RangeError outside that range.
 */
export function speakNumber(n: number, lang: Lang, opts: SpeakNumberOptions = {}): string {
  assertSpeakable(n);
  if (n === 0) return lang === "es" ? "cero" : "zero";
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (lang === "es") {
    // "mil" is masculine-neutral: the multiplier always takes the short form ("veintiún mil").
    if (thousands === 1) parts.push("mil");
    else if (thousands > 1) parts.push(`${es999(thousands, true)} mil`);
    if (rest > 0) parts.push(es999(rest, opts.apocope === true));
  } else {
    if (thousands > 0) parts.push(`${en999(thousands)} thousand`);
    if (rest > 0) parts.push(en999(rest));
  }
  return parts.join(" ");
}

const EN_ORDINAL_LAST: Record<string, string> = {
  one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth",
};

/** An English ordinal in words: 1 → "first", 13 → "thirteenth", 21 → "twenty-first", 30 → "thirtieth". */
export function speakOrdinal(n: number): string {
  if (n < 1) throw new RangeError("speakOrdinal covers whole numbers from 1");
  const words = speakNumber(n, "en");
  const m = /^(.*?)([a-z]+)$/.exec(words);
  if (!m) return `${words}th`;
  const [, head, last] = m;
  if (EN_ORDINAL_LAST[last]) return head + EN_ORDINAL_LAST[last];
  if (last.endsWith("y")) return `${head}${last.slice(0, -1)}ieth`;
  return `${head}${last}th`;
}

/**
 * A price in euro cents, in words: 1500 → "quince euros", 100 → "un euro",
 * 2100 → "veintiún euros", 1550 → "quince euros con cincuenta"; English
 * "fifteen euros", "fifteen euros fifty". Under one euro: "cincuenta
 * céntimos" / "fifty cents".
 */
export function speakPrice(cents: number, lang: Lang): string {
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_SPOKEN_NUMBER * 100 + 99) {
    throw new RangeError("speakPrice takes whole euro cents");
  }
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  if (lang === "es") {
    if (euros === 0 && rest > 0) {
      return `${speakNumber(rest, "es", { apocope: true })} ${rest === 1 ? "céntimo" : "céntimos"}`;
    }
    const whole = `${speakNumber(euros, "es", { apocope: true })} ${euros === 1 ? "euro" : "euros"}`;
    return rest === 0 ? whole : `${whole} con ${speakNumber(rest, "es")}`;
  }
  if (euros === 0 && rest > 0) return `${speakNumber(rest, "en")} ${rest === 1 ? "cent" : "cents"}`;
  const whole = `${speakNumber(euros, "en")} ${euros === 1 ? "euro" : "euros"}`;
  return rest === 0 ? whole : `${whole} ${speakNumber(rest, "en")}`;
}

/**
 * How a run of n digits is split for reading: groups of 3, with a final group
 * of 4 instead of leaving one digit alone (7 → 3+4, 10 → 3+3+4, 8 → 3+3+2).
 */
export function digitGroups(n: number): number[] {
  const groups: number[] = [];
  let left = n;
  while (left > 0) {
    if (left === 4) {
      groups.push(4);
      break;
    }
    const g = Math.min(3, left);
    groups.push(g);
    left -= g;
  }
  return groups;
}

/**
 * Digits read one by one: commas inside a group, semicolons between groups.
 * "612345678" → "seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho".
 * Any character that is not a digit is ignored.
 */
export function speakDigits(digits: string, lang: Lang, groups: readonly number[] = digitGroups(countDigits(digits))): string {
  const ds = digits.replace(/\D/g, "").split("").map(Number);
  const out: string[] = [];
  let k = 0;
  for (const size of groups) {
    const group = ds.slice(k, k + size);
    if (group.length === 0) break;
    out.push(group.map((d) => DIGIT_WORDS[lang][d]).join(", "));
    k += size;
  }
  if (k < ds.length) out.push(ds.slice(k).map((d) => DIGIT_WORDS[lang][d]).join(", "));
  return out.join("; ");
}

function countDigits(s: string): number {
  return s.replace(/\D/g, "").length;
}

/**
 * The length of the ITU country code at the start of an E.164 number's
 * digits: 1 and 7 have one digit, the zones below have two, the rest three.
 */
export function countryCodeLength(digits: string): number {
  if (digits.startsWith("1") || digits.startsWith("7")) return 1;
  const two = Number(digits.slice(0, 2));
  const TWO_DIGIT = new Set([
    20, 27, 30, 31, 32, 33, 34, 36, 39, 40, 41, 43, 44, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56, 57, 58,
    60, 61, 62, 63, 64, 65, 66, 81, 82, 84, 86, 90, 91, 92, 93, 94, 95, 98,
  ]);
  return TWO_DIGIT.has(two) ? 2 : 3;
}

/**
 * A phone number read back so the caller can check it by ear. A Spanish
 * number (+34 and 9 digits) is its national digits in 3 groups of 3:
 * "seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho". Any other number
 * says its country code first ("más cuarenta y cuatro" / "plus forty-four"),
 * then its national digits in groups (see `digitGroups`). A string with no
 * "+" is read as national digits.
 */
export function speakPhone(phone: string, lang: Lang): string {
  const digits = phone.replace(/\D/g, "");
  if (!phone.trim().startsWith("+")) return speakDigits(digits, lang);
  if (digits.startsWith("34") && digits.length === 11) return speakDigits(digits.slice(2), lang, [3, 3, 3]);
  const ccLen = countryCodeLength(digits);
  const cc = Number(digits.slice(0, ccLen));
  const national = digits.slice(ccLen);
  const prefix = `${lang === "es" ? "más" : "plus"} ${speakNumber(cc, lang)}`;
  return national ? `${prefix}; ${speakDigits(national, lang)}` : prefix;
}

import { Temporal } from "temporal-polyfill";
import type { Lang } from "@/lib/sectors";
import { DIGIT_WORDS, speakNumber, speakOrdinal } from "./numbers";
import { PERIODS, inPeriod, isOpenAt, type TimeContext } from "./time";
import { MONTH_WORDS, RELATIVE_DAY_WORDS, WEEKDAY_WORDS } from "./day";

/**
 * The inverses of the spoken forms. They exist for the property tests (round
 * trips) and for the safety net's own tests; no caller input is parsed with
 * them. Every parser returns null for words it does not recognise.
 */

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function range(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n += step) out.push(n);
  return out;
}

/** Word → value for the atoms of each language, built from the speaker's own words. */
const ATOMS: Record<Lang, ReadonlyMap<string, number>> = {
  es: new Map<string, number>([
    ...range(0, 29).map((n) => [speakNumber(n, "es"), n] as [string, number]),
    ...range(30, 90, 10).map((n) => [speakNumber(n, "es"), n] as [string, number]),
    ...range(200, 900, 100).map((n) => [speakNumber(n, "es"), n] as [string, number]),
    ["un", 1],
    ["veintiún", 21],
    ["cien", 100],
    ["ciento", 100],
  ]),
  en: new Map<string, number>([
    ...range(0, 19).map((n) => [speakNumber(n, "en"), n] as [string, number]),
    ...range(20, 90, 10).map((n) => [speakNumber(n, "en"), n] as [string, number]),
  ]),
};

/** Number words back to the number: "veintiún mil ciento uno" → 21101, "twenty-one" → 21. */
export function parseNumber(words: string, lang: Lang): number | null {
  const tokens = norm(words)
    .split(lang === "en" ? /[\s-]+/ : /\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;
  let total = 0;
  let current = 0;
  for (const tok of tokens) {
    if ((lang === "es" && tok === "y") || (lang === "en" && tok === "and")) continue;
    if (tok === (lang === "es" ? "mil" : "thousand")) {
      if (lang === "en" && current === 0) return null;
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
      continue;
    }
    if (lang === "en" && tok === "hundred") {
      if (current === 0) return null;
      current *= 100;
      continue;
    }
    const v = ATOMS[lang].get(tok);
    if (v === undefined) return null;
    current += v;
  }
  return total + current;
}

/** Price words back to euro cents: "quince euros con cincuenta" → 1550, "fifty cents" → 50. */
export function parsePrice(words: string, lang: Lang): number | null {
  const s = norm(words);
  const whole =
    lang === "es" ? /^(.+?) euros?(?: con (.+))?$/.exec(s) : /^(.+?) euros?(?: (.+))?$/.exec(s);
  if (whole) {
    const euros = parseNumber(whole[1], lang);
    const cents = whole[2] === undefined ? 0 : parseNumber(whole[2], lang);
    if (euros === null || cents === null || cents > 99) return null;
    return euros * 100 + cents;
  }
  const small = (lang === "es" ? /^(.+?) céntimos?$/ : /^(.+?) cents?$/).exec(s);
  if (small) {
    const cents = parseNumber(small[1], lang);
    return cents === null || cents > 99 ? null : cents;
  }
  return null;
}

/**
 * A phone read back, to E.164: "seis, uno, dos; …" → "+34612…" (a reading
 * with no country code is a Spanish number), "más cuarenta y cuatro; …" → "+44…".
 */
export function parsePhone(words: string, lang: Lang): string | null {
  const groups = norm(words)
    .split(";")
    .map((g) => g.trim())
    .filter(Boolean);
  if (groups.length === 0) return null;
  let cc = "34";
  const prefix = lang === "es" ? "más " : "plus ";
  if (groups[0].startsWith(prefix)) {
    const n = parseNumber(groups[0].slice(prefix.length), lang);
    if (n === null || n < 1) return null;
    cc = String(n);
    groups.shift();
  }
  let digits = "";
  for (const g of groups) {
    for (const w of g.split(",").map((x) => x.trim())) {
      const d = DIGIT_WORDS[lang].indexOf(w);
      if (d < 0) return null;
      digits += String(d);
    }
  }
  return `+${cc}${digits}`;
}

/** "a las cinco y cuarto" → 17:15 with Lola's sessions; "at nine at night" → 21:00. */
export function parseSpokenTime(words: string, lang: Lang, ctx?: TimeContext): Temporal.PlainTime | null {
  let s = norm(words);
  const prep = lang === "es" ? "a " : "at ";
  if (s.startsWith(prep)) s = s.slice(prep.length);

  if (lang === "en" && s === "noon") return Temporal.PlainTime.from({ hour: 12, minute: 0 });
  if (lang === "en" && s === "midnight") return Temporal.PlainTime.from({ hour: 0, minute: 0 });

  let period: { from: number; to: number } | undefined;
  for (const p of PERIODS[lang]) {
    if (s.endsWith(` ${p.words}`)) {
      period = p;
      s = s.slice(0, -(p.words.length + 1));
      break;
    }
  }

  const half = lang === "es" ? parseEsClock(s) : parseEnClock(s);
  if (half === null) return null;
  const candidates = [half, half + 720].filter((m) =>
    period ? inPeriod(m, period) : ctx !== undefined && isOpenAt(m, ctx),
  );
  if (candidates.length !== 1) return null;
  const m = candidates[0];
  return Temporal.PlainTime.from({ hour: Math.floor(m / 60), minute: m % 60 });
}

/** Spanish clock words to minutes in a 12-hour half day (0–719). */
function parseEsClock(s: string): number | null {
  const m = /^(la|las) (\S+)(?: (y|menos) (\S+))?$/.exec(s);
  if (!m) return null;
  const [, article, hourWord, op, minWord] = m;
  // The hour is feminine ("la una"), a form parseNumber does not take; "uno" is not an hour word.
  if (hourWord === "uno" || hourWord === "un") return null;
  const h12 = hourWord === "una" ? 1 : parseNumber(hourWord, "es");
  if (h12 === null || h12 < 1 || h12 > 12) return null;
  if ((article === "la") !== (h12 === 1)) return null;
  let delta = 0;
  if (op) {
    const n = minWord === "cuarto" ? 15 : minWord === "media" && op === "y" ? 30 : parseNumber(minWord, "es");
    if (n === null || n < 1 || n > (op === "y" ? 30 : 29)) return null;
    delta = op === "y" ? n : -n;
  }
  return ((h12 % 12) * 60 + delta + 720) % 720;
}

/** English clock words to minutes in a 12-hour half day (0–719). */
function parseEnClock(s: string): number | null {
  const hourOf = (w: string): number | null => {
    const h = parseNumber(w, "en");
    return h !== null && h >= 1 && h <= 12 ? (h % 12) * 60 : null;
  };
  const only = /^(\S+)$/.exec(s);
  if (only) return hourOf(only[1]);
  const m = /^(quarter|half|.+?)(?: (minutes?))? (past|to) (\S+)$/.exec(s);
  if (!m) return null;
  const [, amount, unit, dir, hourWord] = m;
  const base = hourOf(hourWord);
  if (base === null) return null;
  let n: number | null;
  if (amount === "quarter") n = unit ? null : 15;
  else if (amount === "half") n = unit || dir === "to" ? null : 30;
  else n = parseNumber(amount, "en");
  if (n === null || n < 1 || n > 30) return null;
  return (base + (dir === "past" ? n : -n) + 720) % 720;
}

/**
 * Day words back to a date, against the same today: relative words (including
 * "pasado mañana" / "the day after tomorrow", which callers say even though the
 * receptionist does not), "este X" / "this X" (this week), "el X que viene" /
 * "next X" (next week), a bare "el X" (the next X, 1 to 7 days ahead), and
 * "el X N [de M]" (the nearest such date). A weekday that does not match the
 * date gives null.
 */
export function parseSpokenDay(
  words: string,
  today: Temporal.PlainDate,
  lang: Lang,
): Temporal.PlainDate | null {
  const s = norm(words);
  const weekdays = WEEKDAY_WORDS[lang].map((w) => w.toLowerCase());
  const months = MONTH_WORDS[lang].map((w) => w.toLowerCase());
  const weekdayOf = (w: string): number => weekdays.indexOf(w) + 1;

  // Relative words, longest first ("pasado mañana" before "mañana").
  const rel = Object.entries(RELATIVE_DAY_WORDS[lang])
    .map(([d, w]) => [Number(d), w] as const)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [d, w] of rel) {
    if (s === w || s.startsWith(lang === "es" ? `${w} ` : `${w}, `)) {
      const date = today.add({ days: d });
      const rest = s.slice(w.length).replace(/^,? /, "");
      if (rest === "") return date;
      return d >= 0 && weekdayOf(rest) === date.dayOfWeek ? date : null;
    }
  }

  const thisWeek = (lang === "es" ? /^este (\S+)$/ : /^this (\S+)$/).exec(s);
  if (thisWeek) {
    const wd = weekdayOf(thisWeek[1]);
    return wd > 0 ? today.add({ days: wd - today.dayOfWeek }) : null;
  }
  const nextWeek = (lang === "es" ? /^el (\S+) que viene$/ : /^next (\S+)$/).exec(s);
  if (nextWeek) {
    const wd = weekdayOf(nextWeek[1]);
    return wd > 0 ? today.add({ days: wd - today.dayOfWeek + 7 }) : null;
  }
  // "el martes": the next Tuesday after today (on a Tuesday, the one a week ahead).
  const bare = lang === "es" ? /^el (\S+)$/.exec(s) : null;
  if (bare) {
    const wd = weekdayOf(bare[1]);
    return wd > 0 ? today.add({ days: (wd - today.dayOfWeek + 7) % 7 || 7 }) : null;
  }

  const abs =
    // The Spanish day of the month may be several words ("treinta y uno").
    lang === "es" ? /^el (\S+) (.+?)(?: de (\S+))?$/.exec(s) : /^(\S+) the (\S+)(?: of (\S+))?$/.exec(s);
  if (!abs) return null;
  const [, wdWord, dayWord, monthWord] = abs;
  const wd = weekdayOf(wdWord);
  const day = lang === "es" ? parseNumber(dayWord, "es") : ordinalValue(dayWord);
  if (wd === 0 || day === null) return null;
  let candidates: Temporal.PlainDate[];
  if (monthWord === undefined) {
    candidates = [tryDate(today, today.year, today.month, day)].filter(isDate);
  } else {
    const month = months.indexOf(monthWord) + 1;
    if (month === 0) return null;
    candidates = [today.year - 1, today.year, today.year + 1].map((y) => tryDate(today, y, month, day)).filter(isDate);
  }
  const best = candidates.sort(
    (a, b) => Math.abs(today.until(a).days) - Math.abs(today.until(b).days),
  )[0];
  return best && best.dayOfWeek === wd ? best : null;
}

const ORDINALS = new Map(range(1, 31).map((n) => [speakOrdinal(n), n]));
function ordinalValue(w: string): number | null {
  return ORDINALS.get(w) ?? null;
}

function tryDate(today: Temporal.PlainDate, year: number, month: number, day: number): Temporal.PlainDate | null {
  try {
    return today.with({ year, month, day }, { overflow: "reject" });
  } catch {
    return null;
  }
}
function isDate(d: Temporal.PlainDate | null): d is Temporal.PlainDate {
  return d !== null;
}

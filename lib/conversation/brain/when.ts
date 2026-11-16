import { Temporal } from "temporal-polyfill";
import type { Lang } from "@/lib/sectors";
import { MONTH_WORDS, WEEKDAY_WORDS, type MinuteRange } from "@/lib/receptionist/spoken";
import { phrasesOf } from "./lexicon";
import { fold, phraseAt, tokenize, type Tok } from "./normalize";
import { numberAt, ordinalAt } from "./numbers";

/**
 * Day and time reading (front-desk-brain 5.1–5.7; design.md "Day and time"). Pure.
 *
 * The utterance is scanned left to right; every day form and every time form found is a hit,
 * and the last hit of each kind wins, so a correction in the same breath counts ("a las cinco,
 * no, a las seis"). Both languages' forms are read whatever the Call's language, because a
 * Caller may say "a las 5pm". A time that could be morning or afternoon is resolved against
 * the sessions of the day it belongs to (5.3). Dates come from `today`, the shop's local date
 * (`todayIn(now, shop.timeZone)`), never the server's.
 */

export type PartOfDay = "morning" | "afternoon";

export interface WhenReading {
  day: Temporal.PlainDate | null;
  time: Temporal.PlainTime | null;
  partOfDay: PartOfDay | null;
  /** How many day and time forms were heard (a correction makes 2). */
  dayHits: number;
  timeHits: number;
  /** Token indices placed by this reader. */
  placed: ReadonlySet<number>;
}

export interface WhenOptions {
  /** The day a time without a day belongs to, for 5.3 (the Call's requested or offered day). */
  defaultDay?: Temporal.PlainDate | null;
  /** Token indices another reader placed; no day or time is read there. */
  skip?: (i: number) => boolean;
}

type Range = { from: number; to: number };
const inRange = (m: number, r: Range) => (r.from < r.to ? m >= r.from && m < r.to : m >= r.from || m < r.to);

/**
 * Periods of the day after a time. `strict` is the Receptionist's own range (`PERIODS` in
 * spoken/time.ts), so every line it says reads back the same; `loose` is the everyday range
 * ("la una de la tarde" is 13:00 although the Receptionist says "del mediodía").
 */
const TIME_PERIODS: { words: string[]; strict: Range; loose: Range }[] = [
  { words: ["de", "la", "manana"], strict: { from: 360, to: 720 }, loose: { from: 0, to: 720 } },
  { words: ["por", "la", "manana"], strict: { from: 360, to: 720 }, loose: { from: 0, to: 720 } },
  { words: ["del", "mediodia"], strict: { from: 720, to: 840 }, loose: { from: 690, to: 900 } },
  { words: ["de", "la", "tarde"], strict: { from: 840, to: 1260 }, loose: { from: 720, to: 1320 } },
  { words: ["por", "la", "tarde"], strict: { from: 840, to: 1260 }, loose: { from: 720, to: 1320 } },
  { words: ["de", "la", "noche"], strict: { from: 1260, to: 360 }, loose: { from: 1200, to: 420 } },
  { words: ["por", "la", "noche"], strict: { from: 1260, to: 360 }, loose: { from: 1200, to: 420 } },
  { words: ["in", "the", "morning"], strict: { from: 300, to: 720 }, loose: { from: 0, to: 720 } },
  { words: ["in", "the", "afternoon"], strict: { from: 720, to: 1080 }, loose: { from: 720, to: 1140 } },
  { words: ["in", "the", "evening"], strict: { from: 1080, to: 1260 }, loose: { from: 960, to: 1380 } },
  { words: ["at", "night"], strict: { from: 1260, to: 300 }, loose: { from: 1140, to: 360 } },
  { words: ["am"], strict: { from: 0, to: 720 }, loose: { from: 0, to: 720 } },
  { words: ["pm"], strict: { from: 720, to: 1440 }, loose: { from: 720, to: 1440 } },
  { words: ["a", "m"], strict: { from: 0, to: 720 }, loose: { from: 0, to: 720 } },
  { words: ["p", "m"], strict: { from: 720, to: 1440 }, loose: { from: 720, to: 1440 } },
];

/** Words before a bare hour that make it a time: "a las 5", "sobre las cinco", "at 5", "around five". */
const ES_CUES = [["a", "eso", "de"], ["como", "a"], ["a"], ["sobre"], ["hacia"], ["para"], ["tipo"], ["desde"], ["de"]];
/** "for" is not a cue: "a haircut for one", "for two" are people (B9 found it). */
const EN_CUES = [["at"], ["around"], ["about"], ["by"]];

/** A number before one of these is not a time or a day (5.7). */
const UNIT_WORDS = new Set(
  [
    "euro", "euros", "centimo", "centimos", "minuto", "minutos", "min", "hora", "horas", "servicio", "servicios",
    "persona", "personas", "ano", "anos", "dia", "dias", "semana", "semanas", "mes", "meses", "vez", "veces",
    "cents", "cent", "minute", "minutes", "hour", "hours", "service", "services", "people", "person", "persons",
    "year", "years", "days", "weeks", "months", "times", "pounds", "dollars",
  ].map((w) => fold(w)),
);

const WEEKDAYS = new Map<string, number>();
for (const lang of ["es", "en"] as const) WEEKDAY_WORDS[lang].forEach((w, k) => WEEKDAYS.set(fold(w), k + 1));
const MONTHS = new Map<string, number>();
for (const lang of ["es", "en"] as const) MONTH_WORDS[lang].forEach((w, k) => MONTHS.set(fold(w), k + 1));
MONTHS.set("setiembre", 9);

type TimeRaw =
  | { kind: "fixed"; minute: number }
  | { kind: "half"; base: number; hour: number; period: { strict: Range; loose: Range } | null };

interface Hit<T> {
  start: number;
  end: number;
  value: T;
}

const w = (toks: readonly Tok[], i: number) => toks[i]?.w ?? "";

function periodAt(toks: readonly Tok[], i: number): { p: (typeof TIME_PERIODS)[number]; end: number } | null {
  for (const p of TIME_PERIODS) if (phraseAt(toks, i, p.words)) return { p, end: i + p.words.length };
  return null;
}

/** Whether the digits around token i form a run of 6 or more digits (a phone, 5.7). */
function inDigitRun(toks: readonly Tok[], i: number): boolean {
  let a = i;
  let b = i;
  while (a - 1 >= 0 && /^\d+$/.test(toks[a - 1].w)) a--;
  while (b + 1 < toks.length && /^\d+$/.test(toks[b + 1].w)) b++;
  let digits = 0;
  for (let k = a; k <= b; k++) digits += /^\d+$/.test(toks[k].w) ? toks[k].w.length : 0;
  return digits >= 6;
}

function unitAfter(toks: readonly Tok[], end: number): boolean {
  return UNIT_WORDS.has(w(toks, end));
}

/** Minutes after a Spanish hour: "y cuarto", "y media", "y veinte", "menos cuarto", "en punto". */
function esMinutesAt(toks: readonly Tok[], i: number): { delta: number; end: number } | null {
  if (w(toks, i) === "en" && w(toks, i + 1) === "punto") return { delta: 0, end: i + 2 };
  const op = w(toks, i);
  if (op !== "y" && op !== "menos") return null;
  if (toks[i + 1]?.brk) return null;
  if (w(toks, i + 1) === "cuarto") return { delta: op === "y" ? 15 : -15, end: i + 2 };
  if (w(toks, i + 1) === "media" && op === "y") return { delta: 30, end: i + 2 };
  const n = numberAt(toks, i + 1, 59);
  if (n && n.lang === "es" && n.value >= 1 && n.value <= (op === "y" ? 30 : 29) && !unitAfter(toks, i + 1 + n.len))
    return { delta: op === "y" ? n.value : -n.value, end: i + 1 + n.len };
  return null;
}

function hourWord(toks: readonly Tok[], i: number, lang: Lang): number | null {
  const t = w(toks, i);
  if (lang === "es" && t === "una") return 1;
  const n = numberAt(toks, i, 12);
  if (!n || n.len !== 1 || n.lang !== lang || n.value < 1 || n.value > 12) return null;
  if (lang === "es" && (t === "uno" || t === "un")) return null;
  return n.value;
}

type PeriodRanges = { strict: Range; loose: Range } | null;

function half(hour: number, delta: number, period: PeriodRanges): TimeRaw {
  return { kind: "half", base: ((hour % 12) * 60 + delta + 720) % 720, hour, period };
}

function withPeriod(toks: readonly Tok[], end: number, make: (p: PeriodRanges) => TimeRaw): { raw: TimeRaw; end: number } {
  const p = periodAt(toks, end);
  if (p) return { raw: make({ strict: p.p.strict, loose: p.p.loose }), end: p.end };
  // "o'clock" after an English hour.
  if (w(toks, end) === "o" && w(toks, end + 1) === "clock") return withPeriod(toks, end + 2, make);
  return { raw: make(null), end };
}

/** A time at token i. `cued`: a time cue came right before, so a bare hour counts. */
function timeAt(toks: readonly Tok[], i: number, cued: boolean): { raw: TimeRaw; end: number } | null {
  const t = w(toks, i);
  if (t === "") return null;

  // Noon and midnight.
  if (t === "noon" || t === "mediodia") return { raw: { kind: "fixed", minute: 720 }, end: i + 1 };
  if (t === "midnight" || t === "medianoche") return { raw: { kind: "fixed", minute: 0 }, end: i + 1 };
  // "a las 5", "at a quarter past five": the article belongs to the cue.
  if (cued && (t === "la" || t === "las") && /^\d/.test(w(toks, i + 1))) return timeAt(toks, i + 1, true);
  if (cued && t === "a" && w(toks, i + 1) === "quarter") return timeAt(toks, i + 1, true);
  if (cued && t === "al" && w(toks, i + 1) === "mediodia") return { raw: { kind: "fixed", minute: 720 }, end: i + 2 };

  // Digits: "17h30", "4h00", "17h", "5pm", "5", "17".
  let m = /^(\d{1,2})h(\d{2})?$/.exec(t);
  const ampm = /^(\d{1,2})(am|pm)$/.exec(t);
  if (m || ampm || /^\d{1,2}$/.test(t)) {
    let hour: number;
    let minute = 0;
    let explicit = false;
    let end = i + 1;
    let forced: { strict: Range; loose: Range } | null = null;
    if (m) {
      hour = Number(m[1]);
      minute = m[2] ? Number(m[2]) : 0;
      explicit = true;
    } else if (ampm) {
      hour = Number(ampm[1]);
      explicit = true;
      const p = TIME_PERIODS.find((x) => x.words.length === 1 && x.words[0] === ampm[2])!;
      forced = { strict: p.strict, loose: p.loose };
    } else {
      hour = Number(t);
      m = null;
    }
    if (hour > 23 || minute > 59) return null;
    if (inDigitRun(toks, i) && !explicit) return null;
    // "a las 5 y media" with a digit hour.
    if (!m && !ampm) {
      const mins = esMinutesAt(toks, end);
      if (mins) {
        minute = mins.delta;
        end = mins.end;
        explicit = true;
      }
    }
    const next = periodAt(toks, end);
    if (!cued && !explicit && !next) return null;
    if (unitAfter(toks, end)) return null;
    if (hour === 0 || hour >= 13) {
      const fixed = (hour * 60 + minute + 1440) % 1440;
      const out = withPeriod(toks, end, () => ({ kind: "fixed", minute: fixed }));
      return out;
    }
    if (forced) return { raw: half(hour, minute, forced), end };
    return withPeriod(toks, end, (p) => half(hour, minute, p));
  }

  // Spanish words: "la una", "las cinco y cuarto", "las once menos cuarto", with a cue only.
  if (cued && (t === "la" || t === "las")) {
    const h = hourWord(toks, i + 1, "es");
    if (h !== null && (t === "la") === (h === 1)) {
      let end = i + 2;
      let delta = 0;
      const mins = esMinutesAt(toks, end);
      if (mins) {
        delta = mins.delta;
        end = mins.end;
      }
      if (unitAfter(toks, end)) return null;
      return withPeriod(toks, end, (p) => half(h, delta, p));
    }
    return null;
  }

  // English words: "quarter past five", "half past five", "twenty to six", "five thirty", "five".
  if (t === "quarter" || t === "half") {
    const dir = w(toks, i + 1);
    if (dir !== "past" && dir !== "to") return null;
    if (t === "half" && dir === "to") return null;
    const h = hourWord(toks, i + 2, "en");
    if (h === null) return null;
    const n = t === "quarter" ? 15 : 30;
    return withPeriod(toks, i + 3, (p) => half(h, dir === "past" ? n : -n, p));
  }
  const n = numberAt(toks, i, 59);
  if (n && n.lang === "en") {
    let j = i + n.len;
    if (w(toks, j) === "minute" || w(toks, j) === "minutes") j++;
    const dir = w(toks, j);
    if ((dir === "past" || dir === "to") && n.value >= 1 && n.value <= 30) {
      const h = hourWord(toks, j + 1, "en");
      if (h !== null) return withPeriod(toks, j + 2, (p) => half(h, dir === "past" ? n.value : -n.value, p));
    }
    const h = hourWord(toks, i, "en");
    if (h !== null && cued) {
      const after = numberAt(toks, i + 1, 59);
      if (after && after.lang === "en" && after.value >= 1 && !unitAfter(toks, i + 1 + after.len))
        return withPeriod(toks, i + 1 + after.len, (p) => half(h, after.value, p));
      if (unitAfter(toks, i + 1)) return null;
      return withPeriod(toks, i + 1, (p) => half(h, 0, p));
    }
  }
  return null;
}

function cueAt(toks: readonly Tok[], i: number): number | null {
  for (const c of [...ES_CUES, ...EN_CUES]) if (phraseAt(toks, i, c)) return i + c.length;
  return null;
}

// ---------------------------------------------------------------------------
// Days

function nextWithDay(today: Temporal.PlainDate, day: number, month: number | null): Temporal.PlainDate | null {
  const make = (y: number, mo: number) => {
    try {
      return Temporal.PlainDate.from({ year: y, month: mo, day }, { overflow: "reject" });
    } catch {
      return null;
    }
  };
  if (month !== null) {
    const d = make(today.year, month);
    if (d && Temporal.PlainDate.compare(d, today) >= 0) return d;
    return make(today.year + 1, month) ?? d;
  }
  let y = today.year;
  let mo = today.month;
  for (let k = 0; k < 3; k++) {
    const d = make(y, mo);
    if (d && Temporal.PlainDate.compare(d, today) >= 0) return d;
    mo++;
    if (mo > 12) {
      mo = 1;
      y++;
    }
  }
  return null;
}

/** A day of the month at token i: digits, Spanish number words or an English ordinal (1–31). */
function dayNumberAt(toks: readonly Tok[], i: number): { value: number; len: number } | null {
  const t = w(toks, i);
  if (/^\d{1,2}$/.test(t)) {
    const v = Number(t);
    if (v >= 1 && v <= 31 && !inDigitRun(toks, i) && !unitAfter(toks, i + 1)) return { value: v, len: 1 };
    return null;
  }
  const ord = ordinalAt(toks, i);
  if (ord && ord.value >= 1 && ord.value <= 31) return ord;
  if (t === "un" || t === "una") return null;
  const n = numberAt(toks, i, 31);
  if (n && n.lang === "es" && n.value >= 1 && !unitAfter(toks, i + n.len)) return { value: n.value, len: n.len };
  return null;
}

/** "de noviembre", "of November" after a day number. */
function monthAfter(toks: readonly Tok[], i: number): { month: number; end: number } | null {
  if ((w(toks, i) === "de" || w(toks, i) === "of") && MONTHS.has(w(toks, i + 1))) return { month: MONTHS.get(w(toks, i + 1))!, end: i + 2 };
  return null;
}

function dayAt(toks: readonly Tok[], i: number, today: Temporal.PlainDate): Hit<Temporal.PlainDate> | null {
  const t = w(toks, i);
  const add = (d: number, end: number): Hit<Temporal.PlainDate> => ({ start: i, end, value: today.add({ days: d }) });

  if (t === "pasado" && w(toks, i + 1) === "manana") return add(2, i + 2);
  if (phraseAt(toks, i, ["the", "day", "after", "tomorrow"])) return add(2, i + 4);
  if (phraseAt(toks, i, ["day", "after", "tomorrow"])) return add(2, i + 3);
  if (t === "hoy" || t === "today" || t === "tonight") return add(0, i + 1);
  if (t === "esta" && ["manana", "tarde", "noche"].includes(w(toks, i + 1))) return add(0, i + 2);
  if (t === "this" && ["morning", "afternoon", "evening"].includes(w(toks, i + 1))) return add(0, i + 2);
  if (t === "tomorrow" || (t === "manana" && !["la", "esta", "de"].includes(w(toks, i - 1)))) {
    let end = i + 1;
    if (w(toks, end) === "el") end++;
    if (WEEKDAYS.has(w(toks, end))) end++;
    else end = i + 1;
    return add(1, end);
  }

  // Weekdays: "el martes", "este martes", "el martes que viene", "next Tuesday", "el martes veinte".
  let j = i;
  let mode: "bare" | "this" | "next" = "bare";
  if (t === "este" || t === "this") {
    mode = "this";
    j++;
  } else if (t === "next" || t === "proximo") {
    mode = "next";
    j++;
  } else if (t === "el" && w(toks, i + 1) === "proximo") {
    mode = "next";
    j += 2;
  } else if (t === "el" || t === "on") j++;
  const wd = WEEKDAYS.get(w(toks, j));
  if (wd !== undefined) {
    let end = j + 1;
    if (mode === "bare" && w(toks, end) === "que" && w(toks, end + 1) === "viene") {
      mode = "next";
      end += 2;
    }
    // A day number after the weekday: "el martes veinte (de diciembre)", "Tuesday the twentieth (of December)".
    let k = end;
    if (w(toks, k) === "the") k++;
    const dn = dayNumberAt(toks, k);
    if (dn && !periodAt(toks, k + dn.len) && !esMinutesAt(toks, k + dn.len)) {
      const mo = monthAfter(toks, k + dn.len);
      const date = nextWithDay(today, dn.value, mo?.month ?? null);
      if (date) return { start: i, end: mo ? mo.end : k + dn.len, value: date };
    }
    const dow = today.dayOfWeek;
    let d: number;
    if (mode === "this") d = wd - dow < 0 ? wd - dow + 7 : wd - dow;
    else if (mode === "next") d = wd - dow + 7;
    else d = (wd - dow + 7) % 7 || 7;
    return add(d, end);
  }

  // Day of the month: "el 20", "el veinte", "el día 20", "20 de noviembre", "the 20th", "November 20", "20/11".
  const slash = /^(\d{1,2})d(\d{1,2})$/.exec(t);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    if (month >= 1 && month <= 12) {
      const date = nextWithDay(today, day, month);
      if (date) return { start: i, end: i + 1, value: date };
    }
    return null;
  }
  if (MONTHS.has(t)) {
    let k = i + 1;
    if (w(toks, k) === "the") k++;
    const dn = dayNumberAt(toks, k);
    if (dn) {
      const date = nextWithDay(today, dn.value, MONTHS.get(t)!);
      if (date) return { start: i, end: k + dn.len, value: date };
    }
    return null;
  }
  let k = i;
  let cued = false;
  if (t === "el" || t === "the" || t === "dia") {
    k++;
    cued = true;
    if (w(toks, k) === "dia") k++;
  }
  const dn = dayNumberAt(toks, k);
  if (dn) {
    const mo = monthAfter(toks, k + dn.len);
    const isOrdinal = ordinalAt(toks, k) !== null && !/^\d+$/.test(w(toks, k));
    if (!cued && !mo && !isOrdinal) return null;
    const date = nextWithDay(today, dn.value, mo?.month ?? null);
    if (date) return { start: i, end: mo ? mo.end : k + dn.len, value: date };
  }
  return null;
}

// ---------------------------------------------------------------------------

function resolve(raw: TimeRaw, sessions: readonly MinuteRange[]): number | null {
  if (raw.kind === "fixed") return raw.minute;
  const cands = [raw.base, raw.base + 720];
  if (raw.period) {
    const strict = cands.filter((m) => inRange(m, raw.period!.strict));
    if (strict.length === 1) return strict[0];
    const loose = cands.filter((m) => inRange(m, raw.period!.loose));
    return loose.length === 1 ? loose[0] : null;
  }
  const open = cands.filter((m) => sessions.some((s) => m >= s.open && m < s.close));
  if (open.length === 1) return open[0];
  // 5.3: both or neither inside; hours 1–7 and 12 are afternoon, 8–11 morning.
  return raw.hour >= 8 && raw.hour <= 11 ? raw.base : raw.base + 720;
}

/** The day, time and part of the day said in an utterance. */
export function readWhen(
  text: string | readonly Tok[],
  today: Temporal.PlainDate,
  _lang: Lang,
  sessionsOf: (date: Temporal.PlainDate) => readonly MinuteRange[],
  opts: WhenOptions = {},
): WhenReading {
  const toks = typeof text === "string" ? tokenize(text) : text;
  const skip = opts.skip ?? (() => false);
  const placed = new Set<number>();
  const days: Hit<Temporal.PlainDate>[] = [];
  const times: Hit<TimeRaw>[] = [];
  const timeTokens = new Set<number>();

  for (let i = 0; i < toks.length; ) {
    if (skip(i)) {
      i++;
      continue;
    }
    const d = dayAt(toks, i, today);
    if (d) {
      days.push(d);
      i = d.end;
      continue;
    }
    const cueEnd = cueAt(toks, i);
    const cued = cueEnd !== null ? timeAt(toks, cueEnd, true) : null;
    if (cued && cueEnd !== null) {
      times.push({ start: i, end: cued.end, value: cued.raw });
      i = cued.end;
      continue;
    }
    const bare = timeAt(toks, i, false);
    if (bare) {
      times.push({ start: i, end: bare.end, value: bare.raw });
      i = bare.end;
      continue;
    }
    i++;
  }
  for (const h of days) for (let k = h.start; k < h.end; k++) placed.add(k);
  for (const h of times)
    for (let k = h.start; k < h.end; k++) {
      placed.add(k);
      timeTokens.add(k);
    }

  // Part of the day without a time (5.4), never inside a time's own period words.
  let partOfDay: PartOfDay | null = null;
  let partAt = -1;
  for (const lang of ["es", "en"] as const) {
    for (const [kind, list] of [["morning", "morning"], ["afternoon", "afternoon"]] as const) {
      for (const p of phrasesOf(lang, list)) {
        for (let i = 0; i + p.length <= toks.length; i++) {
          if (!phraseAt(toks, i, p)) continue;
          let free = true;
          for (let k = i; k < i + p.length; k++) if (timeTokens.has(k) || skip(k)) free = false;
          if (!free || w(toks, i - 1) === "good" || w(toks, i - 1) === "buenas") continue;
          for (let k = i; k < i + p.length; k++) placed.add(k);
          if (i >= partAt) {
            partAt = i;
            partOfDay = kind;
          }
        }
      }
    }
  }

  const day = days.length > 0 ? days[days.length - 1].value : null;
  let time: Temporal.PlainTime | null = null;
  if (times.length > 0) {
    const ref = day ?? opts.defaultDay ?? null;
    const sessions = ref ? sessionsOf(ref) : weekSessions(today, sessionsOf);
    const minute = resolve(times[times.length - 1].value, sessions);
    if (minute !== null) time = Temporal.PlainTime.from({ hour: Math.floor(minute / 60), minute: minute % 60 });
  }
  return { day, time, partOfDay, dayHits: days.length, timeHits: times.length, placed };
}

/** The sessions of the next 7 days together: a time with no day is read against the shop's week. */
function weekSessions(today: Temporal.PlainDate, sessionsOf: (d: Temporal.PlainDate) => readonly MinuteRange[]): MinuteRange[] {
  const out: MinuteRange[] = [];
  for (let k = 0; k < 7; k++) out.push(...sessionsOf(today.add({ days: k })));
  return out;
}

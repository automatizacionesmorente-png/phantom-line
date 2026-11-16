import type { Lang } from "@/lib/sectors";
import { speakNumber, speakOrdinal } from "@/lib/receptionist/spoken";
import { words, type Tok } from "./normalize";

/**
 * Number words as tokens, built from the Receptionist's own `speakNumber` and `speakOrdinal`
 * (so the brain reads every number the Receptionist can say), normalized like every token:
 * "veintidós" → "veintidos", "twenty-one" → "twenty one". Pure.
 */

export interface NumberHit {
  value: number;
  /** Tokens used. */
  len: number;
  lang: Lang;
}

const MAX_WORDS = 5;

function build(): Map<string, { value: number; lang: Lang }[]> {
  const map = new Map<string, { value: number; lang: Lang }[]>();
  const add = (phrase: string, value: number, lang: Lang) => {
    const key = words(phrase).join(" ");
    if (key === "") return;
    const list = map.get(key) ?? [];
    if (!list.some((x) => x.value === value && x.lang === lang)) list.push({ value, lang });
    map.set(key, list);
  };
  for (let n = 0; n <= 999; n++) {
    add(speakNumber(n, "es"), n, "es");
    add(speakNumber(n, "es", { apocope: true }), n, "es");
    add(speakNumber(n, "en"), n, "en");
  }
  add("una", 1, "es");
  add("oh", 0, "en");
  return map;
}

let NUMBERS: Map<string, { value: number; lang: Lang }[]> | null = null;
function numbers(): Map<string, { value: number; lang: Lang }[]> {
  if (!NUMBERS) NUMBERS = build();
  return NUMBERS;
}

/**
 * Every number word phrase that starts at token i (1–5 tokens), longest first. A digit token
 * is not a number word; the readers take digits themselves.
 */
export function numbersAt(toks: readonly Tok[], i: number, opts: { noBreak?: boolean } = {}): NumberHit[] {
  const out: NumberHit[] = [];
  const map = numbers();
  for (let len = Math.min(MAX_WORDS, toks.length - i); len >= 1; len--) {
    if (opts.noBreak) {
      let crosses = false;
      for (let k = i + 1; k < i + len; k++) if (toks[k].brk) crosses = true;
      if (crosses) continue;
    }
    const key = toks
      .slice(i, i + len)
      .map((t) => t.w)
      .join(" ");
    const hits = map.get(key);
    if (hits) for (const h of hits) out.push({ value: h.value, len, lang: h.lang });
  }
  return out;
}

/** The longest number word phrase at token i, or null. */
export function numberAt(toks: readonly Tok[], i: number, max = 999): NumberHit | null {
  return numbersAt(toks, i, { noBreak: true }).find((h) => h.value <= max) ?? null;
}

let ORDINALS: Map<string, number> | null = null;
/** English ordinals 1–31 ("twentieth", "twenty first") and "primero" for the 1st. */
export function ordinalAt(toks: readonly Tok[], i: number): { value: number; len: number } | null {
  if (!ORDINALS) {
    ORDINALS = new Map<string, number>();
    for (let n = 1; n <= 31; n++) ORDINALS.set(words(speakOrdinal(n)).join(" "), n);
    ORDINALS.set("primero", 1);
  }
  for (let len = Math.min(3, toks.length - i); len >= 1; len--) {
    const key = toks
      .slice(i, i + len)
      .map((t) => t.w)
      .join(" ");
    const v = ORDINALS.get(key);
    if (v !== undefined) return { value: v, len };
  }
  const t = toks[i];
  const m = t ? /^(\d{1,2})(st|nd|rd|th)$/.exec(t.w) : null;
  if (m) return { value: Number(m[1]), len: 1 };
  return null;
}

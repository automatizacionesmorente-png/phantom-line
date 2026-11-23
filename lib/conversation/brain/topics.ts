import type { Temporal } from "temporal-polyfill";
import type { Lang, SectorPack } from "@/lib/sectors";
import { comboId } from "@/lib/booking";
import type { ShopProfile } from "../shopProfile";
import { toShopRules } from "../shopProfile";
import { phrasesOf, type LexiconList } from "./lexicon";
import { entry, findSpans, longestSpans, phraseAt, tokenize, words, type PhraseEntry, type Tok } from "./normalize";
import { matchServices, protectedWord, serviceIndex, type ServiceMatch } from "./services";

/**
 * Profile_Topics (front-desk-brain 9.1, 9.7; design.md "The Reading"). Pure. The FAQ words
 * come from the Shop_Profile; the built-in topics' cue words from the lexicon.
 */

export type ServiceTarget =
  | { kind: "service"; id: string }
  | { kind: "choice"; candidates: string[] }
  | { kind: "category"; categoryId: string };

export type TopicHit =
  | { kind: "hours"; day: Temporal.PlainDate | null; now: boolean }
  | { kind: "address" }
  | { kind: "services" }
  | { kind: "price" | "duration"; target: ServiceTarget }
  | { kind: "faq"; id: string };

export interface TopicReading {
  topic: TopicHit | null;
  /** An urgent term or sensitive word outside every matched FAQ alias and Not_Urgent_Phrase (9.7). */
  sensitive: { term: string; lang: Lang } | null;
  /** Token indices the FAQ alias or the topic cue took. */
  placed: ReadonlySet<number>;
  /** Token indices of the matched FAQ alias only: no other reader reads there. */
  faqPlaced: ReadonlySet<number>;
}

export interface TopicOptions {
  lang: Lang;
  pack: SectorPack;
  /** The day the utterance named, for "¿abrís el sábado?". */
  day?: Temporal.PlainDate | null;
  /** The Call's services, so "¿y cuánto cuesta?" names the service already chosen. */
  current?: readonly string[];
  /** The service reading of the same utterance, when the caller already has one. */
  services?: ServiceMatch;
}

const FAQ_INDEX = new WeakMap<ShopProfile, Record<Lang, PhraseEntry<string>[]>>();

function faqIndex(shop: ShopProfile): Record<Lang, PhraseEntry<string>[]> {
  const cached = FAQ_INDEX.get(shop);
  if (cached) return cached;
  const index: Record<Lang, PhraseEntry<string>[]> = { es: [], en: [] };
  for (const f of shop.faq ?? [])
    for (const lang of ["es", "en"] as const)
      for (const a of f.aliases[lang]) {
        const e = entry(a, f.id);
        if (e) index[lang].push(e);
      }
  FAQ_INDEX.set(shop, index);
  return index;
}

/** The longest cue of a lexicon list at any free token: its start and end, or null. */
function cueSpan(toks: readonly Tok[], lang: Lang, list: LexiconList, skip: (i: number) => boolean): { start: number; end: number } | null {
  for (const p of phrasesOf(lang, list))
    for (let i = 0; i + p.length <= toks.length; i++) {
      if (!phraseAt(toks, i, p)) continue;
      let free = true;
      for (let k = i; k < i + p.length; k++) if (skip(k)) free = false;
      if (free) return { start: i, end: i + p.length };
    }
  return null;
}

const URGENT = new WeakMap<SectorPack, { term: string[]; raw: string; lang: Lang }[]>();
function urgentTerms(pack: SectorPack): { term: string[]; raw: string; lang: Lang }[] {
  const cached = URGENT.get(pack);
  if (cached) return cached;
  const out: { term: string[]; raw: string; lang: Lang }[] = [];
  for (const lang of ["es", "en"] as const)
    for (const raw of pack.vocabulary[lang].urgent) {
      const w = words(raw);
      if (w.length > 0) out.push({ term: w, raw, lang });
    }
  const sorted = out.sort((a, b) => b.term.length - a.term.length);
  URGENT.set(pack, sorted);
  return sorted;
}

/** What the Caller asked about, if the profile answers it. */
export function matchTopic(text: string | readonly Tok[], shop: ShopProfile, opts: TopicOptions): TopicReading {
  const toks = typeof text === "string" ? tokenize(text) : text;
  const placed = new Set<number>();
  const faqPlaced = new Set<number>();
  const isProtected = protectedWord(shop);

  // FAQ_Entries, in the Call's language (an alias such as "red" means another thing in English).
  // An FAQ alias inside a longer service alias is the service's: "kids" in "kids' cut" (4.3).
  const serviceSpans = longestSpans(findSpans(toks, serviceIndex(shop).entries, isProtected));
  const notInService = (f: { start: number; end: number }) =>
    !serviceSpans.some((s) => s.start < f.end && f.start < s.end && s.end - s.start > f.end - f.start);
  let faqSpans = longestSpans(findSpans(toks, faqIndex(shop)[opts.lang], isProtected)).filter(notInService);
  // A caller who asked "¿habláis inglés?" may go on in Spanish ("¿pagar con tarjeta?"), and the
  // other way round. With nothing in the Call's language, the other language's aliases count too,
  // but only those of two or more words: a single word may mean something else ("red" is the
  // Spanish wifi alias and an English colour).
  if (faqSpans.length === 0) {
    const other: Lang = opts.lang === "es" ? "en" : "es";
    faqSpans = longestSpans(findSpans(toks, faqIndex(shop)[other], isProtected)).filter((f) => notInService(f) && f.end - f.start >= 2);
  }
  for (const s of faqSpans) for (let k = s.start; k < s.end; k++) faqPlaced.add(k);

  // 9.7: an urgent term counts only outside a matched FAQ alias and outside the pack's Not_Urgent_Phrases.
  const masked = new Set(faqPlaced);
  for (const lang of ["es", "en"] as const)
    for (const p of (opts.pack.vocabulary[lang].notUrgent ?? []).map(words))
      for (let i = 0; i + p.length <= toks.length; i++) if (phraseAt(toks, i, p)) for (let k = i; k < i + p.length; k++) masked.add(k);
  let sensitive: TopicReading["sensitive"] = null;
  for (const u of urgentTerms(opts.pack)) {
    for (let i = 0; i + u.term.length <= toks.length && !sensitive; i++) {
      if (!phraseAt(toks, i, u.term)) continue;
      let free = true;
      for (let k = i; k < i + u.term.length; k++) if (masked.has(k)) free = false;
      if (free) {
        sensitive = { term: u.raw, lang: u.lang };
        for (let k = i; k < i + u.term.length; k++) placed.add(k);
      }
    }
    if (sensitive) break;
  }

  if (faqSpans.length > 0) {
    for (const k of faqPlaced) placed.add(k);
    return { topic: { kind: "faq", id: faqSpans[0].entry.value }, sensitive, placed, faqPlaced };
  }

  const skip = (i: number) => faqPlaced.has(i);
  const langs: Lang[] = opts.lang === "es" ? ["es", "en"] : ["en", "es"];
  const find = (list: LexiconList) => {
    for (const l of langs) {
      const s = cueSpan(toks, l, list, skip);
      if (s) return s;
    }
    return null;
  };
  const mark = (s: { start: number; end: number }) => {
    for (let k = s.start; k < s.end; k++) placed.add(k);
  };

  // Duration before price: "how much time" is a duration, "how much" a price.
  const duration = find("duration");
  const price = duration ? null : find("price");
  if (duration || price) {
    const span = (duration ?? price)!;
    const svc = opts.services ?? matchServices(toks, shop, { current: opts.current, skip });
    const target = targetOf(svc, shop, opts.current ?? []);
    if (target) {
      mark(span);
      return { topic: { kind: duration ? "duration" : "price", target }, sensitive, placed, faqPlaced };
    }
    if (price) {
      mark(span);
      return { topic: { kind: "services" }, sensitive, placed, faqPlaced };
    }
  }

  const hours = find("hours");
  if (hours) {
    mark(hours);
    const now = find("now");
    if (now) mark(now);
    return { topic: { kind: "hours", day: opts.day ?? null, now: now !== null && !opts.day }, sensitive, placed, faqPlaced };
  }
  const address = find("address");
  if (address) {
    mark(address);
    return { topic: { kind: "address" }, sensitive, placed, faqPlaced };
  }
  const services = find("services");
  if (services) {
    mark(services);
    return { topic: { kind: "services" }, sensitive, placed, faqPlaced };
  }
  return { topic: null, sensitive, placed, faqPlaced };
}

/** The service a price or duration question is about: what was said, else what the Call has. */
function targetOf(svc: ServiceMatch, shop: ShopProfile, current: readonly string[]): ServiceTarget | null {
  const services = toShopRules(shop).services;
  const r = svc.request;
  if (r.kind === "set") {
    const ids = r.ids;
    const id = ids.length === 1 ? ids[0] : comboId(ids, services);
    return id ? { kind: "service", id } : null;
  }
  if (r.kind === "choice") return { kind: "choice", candidates: r.candidates };
  if (r.kind === "category") return { kind: "category", categoryId: r.categoryId };
  if (current.length > 0) {
    const id = current.length === 1 ? current[0] : comboId(current, services);
    return id ? { kind: "service", id } : null;
  }
  return null;
}

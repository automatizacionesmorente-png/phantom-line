import type { ShopProfile, ShopService } from "../shopProfile";
import { lexiconWords, phrasesOf } from "./lexicon";
import {
  entry,
  findSpans,
  longestSpans,
  phraseAt,
  tokenize,
  type PhraseEntry,
  type Span,
  type Tok,
} from "./normalize";

/**
 * Service matching (front-desk-brain 4.1–4.7, 4.10; design.md "Service matching"). Pure.
 * The shop's words come only from its profile: service ids, names, aliases and Categories.
 */

export const MAX_SERVICES = 3;

export type ServiceRequest =
  | { kind: "none" }
  | { kind: "set"; ids: string[]; mode: "replace" | "add" }
  | { kind: "choice"; candidates: string[]; with: string[] }
  | { kind: "category"; categoryId: string; with: string[] }
  | { kind: "unknown"; said: string };

export interface ServiceChoiceState {
  candidates: string[];
  with: string[];
}

export interface ServiceMatch {
  request: ServiceRequest;
  /**
   * The Call's services after this utterance, in said order, at most 3; null when the
   * utterance does not change them. Add_On bases are already added (4.10).
   */
  next: string[] | null;
  /** Services of the Call the Caller removed ("sin el corte"), Add_Ons included. */
  removed: string[];
  /** Add_Ons removed only because their base was removed: the reply names them (4.10). */
  removedAddOns: string[];
  /** A fourth service was dropped (8. Result). */
  tooMany: boolean;
  /** The open Service_Choice was answered by a candidate's distinguishing word (4.5). */
  choiceAnswered: boolean;
  /** Token indices the matcher placed (spans, negations, additions, joiners). */
  placed: ReadonlySet<number>;
}

export interface MatchOptions {
  /** The Call's services from earlier Turns (parts of `fields.serviceId`). */
  current?: readonly string[];
  /** An open Service_Choice. */
  choice?: ServiceChoiceState | null;
  /** Token indices another reader already placed (an FAQ alias): no service is read there. */
  skip?: (i: number) => boolean;
}

type Owner = { kind: "services"; ids: string[] } | { kind: "category"; id: string };

interface ServiceIndex {
  entries: PhraseEntry<Owner>[];
  /** Every word of every service and Category entry: a said word equal to one never takes a typo. */
  aliasWords: ReadonlySet<string>;
  byId: ReadonlyMap<string, ShopService>;
  /** Per service, its own entries (owned by it alone), for answering a Service_Choice. */
  ownWords: ReadonlyMap<string, ReadonlySet<string>>;
}

const INDEX = new WeakMap<ShopProfile, ServiceIndex>();

/** The words the matcher reads for a service: its id with hyphens as spaces, both names, its aliases. */
export function serviceWords(s: ShopService): string[] {
  return [s.id.replace(/-/g, " "), s.name.es, s.name.en, ...(s.aliases ?? [])];
}

export function serviceIndex(shop: ShopProfile): ServiceIndex {
  const cached = INDEX.get(shop);
  if (cached) return cached;
  const byPhrase = new Map<string, { phrase: string; ids: string[] }>();
  for (const s of shop.services) {
    for (const p of serviceWords(s)) {
      const e = entry(p, null);
      if (!e) continue;
      const key = e.words.join(" ");
      const row = byPhrase.get(key) ?? { phrase: p, ids: [] };
      if (!row.ids.includes(s.id)) row.ids.push(s.id);
      byPhrase.set(key, row);
    }
  }
  const entries: PhraseEntry<Owner>[] = [];
  for (const { phrase, ids } of byPhrase.values()) {
    const e = entry<Owner>(phrase, { kind: "services", ids });
    if (e) entries.push(e);
  }
  for (const c of shop.categories ?? []) {
    for (const p of [c.name.es, c.name.en, ...(c.aliases ?? [])]) {
      const e = entry<Owner>(p, { kind: "category", id: c.id });
      if (e && !byPhrase.has(e.words.join(" "))) entries.push(e);
    }
  }
  const aliasWords = new Set<string>();
  for (const e of entries) for (const w of e.words) aliasWords.add(w);

  // A candidate's distinguishing words: words of its own entries that no other service uses.
  const usedBy = new Map<string, Set<string>>();
  for (const e of entries) {
    if (e.value.kind !== "services") continue;
    for (const w of e.words) {
      const set = usedBy.get(w) ?? new Set<string>();
      for (const id of e.value.ids) set.add(id);
      usedBy.set(w, set);
    }
  }
  const glue = new Set([...phrasesOf("es", "glue"), ...phrasesOf("en", "glue")].map((p) => p.join(" ")));
  const ownWords = new Map<string, Set<string>>();
  for (const [w, ids] of usedBy) {
    if (ids.size !== 1 || glue.has(w) || w.length < 3) continue;
    const id = [...ids][0];
    const set = ownWords.get(id) ?? new Set<string>();
    set.add(w);
    ownWords.set(id, set);
  }
  const index: ServiceIndex = {
    entries,
    aliasWords,
    byId: new Map(shop.services.map((s) => [s.id, s])),
    ownWords,
  };
  INDEX.set(shop, index);
  return index;
}

/** A said word that is exactly an alias word or a lexicon word never takes a typo (4.2). */
export function protectedWord(shop: ShopProfile): (w: string) => boolean {
  const { aliasWords } = serviceIndex(shop);
  const lex = lexiconWords();
  return (w) => aliasWords.has(w) || lex.has(w);
}

function anyPhraseEndingAt(toks: readonly Tok[], end: number, phrases: readonly (readonly string[])[]): number | null {
  for (const p of phrases) if (phraseAt(toks, end - p.length, p)) return end - p.length;
  return null;
}

/** Words that may sit between a negation and the service: "no quiero barba", "sin el corte". */
const NEGATION_GAP = new Set(["el", "la", "los", "las", "un", "una", "quiero", "queria", "the", "a", "an", "any", "want", "need"]);

let NEGATIONS: readonly (readonly string[])[] | null = null;
let ADDITIONS: readonly (readonly string[])[] | null = null;
let JOINERS: ReadonlySet<string> | null = null;

/** The negation that governs a span starting at `start`, if any (4.6). No negation crosses punctuation. */
function negatedAt(toks: readonly Tok[], start: number): { from: number } | null {
  NEGATIONS ??= [...phrasesOf("es", "negation"), ...phrasesOf("en", "negation")];
  const phrases = NEGATIONS;
  let j = start;
  for (let gap = 0; gap <= 2; gap++) {
    const from = anyPhraseEndingAt(toks, j, phrases);
    if (from !== null) {
      // "No, quiero un corte": an answer, not a negation. No negation crosses punctuation.
      for (let k = from + 1; k <= start; k++) if (toks[k]?.brk) return null;
      return { from };
    }
    if (j - 1 < 0 || !NEGATION_GAP.has(toks[j - 1].w)) return null;
    j--;
  }
  return null;
}

function goesWith(a: ShopService | undefined, b: ShopService | undefined): boolean {
  if (!a || !b) return false;
  return (a.goesWith ?? []).includes(b.id) || (b.goesWith ?? []).includes(a.id);
}

/** Unique ids, first occurrence kept. */
function unique(ids: readonly string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) === i);
}

/** Every Add_On whose bases are all missing gets its first base, right before it (4.10). */
export function withAddOnBases(ids: readonly string[], shop: ShopProfile, also: readonly string[] = []): string[] {
  const { byId } = serviceIndex(shop);
  const out: string[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    const bases = s?.addOnTo ?? [];
    if (bases.length > 0 && !bases.some((b) => ids.includes(b) || also.includes(b) || out.includes(b))) out.push(bases[0]);
    out.push(id);
  }
  return unique(out);
}

/** The services the Caller asked for in one utterance, and the Call's services after it. */
export function matchServices(text: string | readonly Tok[], shop: ShopProfile, opts: MatchOptions = {}): ServiceMatch {
  const toks = typeof text === "string" ? tokenize(text) : text;
  const index = serviceIndex(shop);
  const current = opts.current ?? [];
  const isProtected = protectedWord(shop);
  const placed = new Set<number>();

  const spans = longestSpans(findSpans(toks, index.entries, isProtected, { skip: opts.skip }));

  const negated: Span<Owner>[] = [];
  const kept: Span<Owner>[] = [];
  for (const s of spans) {
    const neg = negatedAt(toks, s.start);
    for (let i = s.start; i < s.end; i++) placed.add(i);
    if (neg) {
      for (let i = neg.from; i < s.start; i++) placed.add(i);
      negated.push(s);
    } else kept.push(s);
  }

  // 4.5: an open Service_Choice is answered by a candidate's own words first.
  let choiceAnswered = false;
  let fromChoice: string[] | null = null;
  if (opts.choice && opts.choice.candidates.length > 0) {
    const definiteHit = kept
      .flatMap((s) => (s.entry.value.kind === "services" && s.entry.value.ids.length === 1 ? s.entry.value.ids : []))
      .filter((id) => opts.choice!.candidates.includes(id));
    let hits = unique(definiteHit);
    if (hits.length !== 1) {
      const wordHits = opts.choice.candidates.filter((c) =>
        toks.some((t, i) => !(opts.skip?.(i) ?? false) && (index.ownWords.get(c)?.has(t.w) ?? false)),
      );
      if (wordHits.length === 1) {
        hits = wordHits;
        toks.forEach((t, i) => {
          if (index.ownWords.get(wordHits[0])?.has(t.w)) placed.add(i);
        });
      }
    }
    if (hits.length === 1) {
      choiceAnswered = true;
      fromChoice = unique([...opts.choice.with, hits[0]]);
    }
  }

  // Definite services, ties and Category hits, in said order.
  const definite: string[] = [];
  for (const s of kept) if (s.entry.value.kind === "services" && s.entry.value.ids.length === 1) definite.push(s.entry.value.ids[0]);

  const ordered: string[] = [];
  let choice: { candidates: string[] } | null = null;
  let category: string | null = null;
  for (const s of kept) {
    const v = s.entry.value;
    if (v.kind === "category") {
      if (category === null) category = v.id;
      continue;
    }
    if (v.ids.length === 1) {
      ordered.push(v.ids[0]);
      continue;
    }
    const cands = v.ids;
    // (a) a candidate matched elsewhere in the same utterance absorbs the tie.
    if (cands.some((c) => definite.includes(c))) continue;
    // (b) exactly one candidate goes with another service of the utterance.
    const byGoesWith = cands.filter((c) => definite.some((d) => goesWith(index.byId.get(c), index.byId.get(d))));
    if (byGoesWith.length === 1) {
      ordered.push(byGoesWith[0]);
      continue;
    }
    // (c) exactly one candidate is, or goes with, a service the Call already has.
    const byCall = cands.filter(
      (c) => current.includes(c) || current.some((d) => goesWith(index.byId.get(c), index.byId.get(d))),
    );
    if (byCall.length === 1) {
      ordered.push(byCall[0]);
      continue;
    }
    if (!choice) choice = { candidates: [...cands] };
  }

  // Additions: a word before the first kept span makes the mode `add` (4.7).
  const first = kept[0]?.start ?? -1;
  let mode: "replace" | "add" = "replace";
  if (first >= 0) {
    ADDITIONS ??= [...phrasesOf("es", "addition"), ...phrasesOf("en", "addition")];
    const adds = ADDITIONS;
    for (let i = 0; i < first; i++) {
      for (const p of adds) {
        if (phraseAt(toks, i, p) && i + p.length <= first) {
          mode = "add";
          for (let k = i; k < i + p.length; k++) placed.add(k);
        }
      }
    }
  }
  JOINERS ??= new Set([...phrasesOf("es", "joiner"), ...phrasesOf("en", "joiner")].map((p) => p.join(" ")));
  const joiners = JOINERS;
  for (let i = 1; i < toks.length - 1; i++) if (placed.has(i - 1) && placed.has(i + 1) && joiners.has(toks[i].w)) placed.add(i);

  // Removals: negated services the Call has, and the Add_Ons left without a base (4.10, 7.8).
  const negatedIds = unique(
    negated.flatMap((s) => (s.entry.value.kind === "services" ? s.entry.value.ids : [])).filter((id) => current.includes(id)),
  );
  const removedAddOns: string[] = [];
  if (negatedIds.length > 0) {
    for (const id of current) {
      const bases = index.byId.get(id)?.addOnTo ?? [];
      if (negatedIds.includes(id) || bases.length === 0) continue;
      if (!bases.some((b) => current.includes(b) && !negatedIds.includes(b))) removedAddOns.push(id);
    }
  }
  const removed = unique([...negatedIds, ...removedAddOns]);
  const remaining = current.filter((id) => !removed.includes(id));
  // A negated service that is not in the Call is never requested, even through a tie.
  const negatedAny = new Set(negated.flatMap((s) => (s.entry.value.kind === "services" ? s.entry.value.ids : [])));

  let said = unique(fromChoice ?? ordered).filter((id) => !negatedAny.has(id) || (fromChoice?.includes(id) ?? false));
  let request: ServiceRequest;
  let next: string[] | null = null;
  let tooMany = false;

  if (said.length > 0) {
    said = withAddOnBases(said, shop, mode === "add" ? remaining : []);
    const base = mode === "add" ? remaining : [];
    let all = unique([...base, ...said]);
    if (all.length > MAX_SERVICES) {
      tooMany = true;
      all = all.slice(0, MAX_SERVICES);
      // An Add_On kept without its base would be booked alone: drop it too.
      all = all.filter((id) => {
        const bases = index.byId.get(id)?.addOnTo ?? [];
        return bases.length === 0 || bases.some((b) => all.includes(b));
      });
    }
    request = { kind: "set", ids: said, mode };
    next = all;
  } else if (choice) {
    request = { kind: "choice", candidates: choice.candidates, with: unique(mode === "add" ? remaining : []) };
    if (removed.length > 0) next = remaining;
  } else if (category) {
    request = { kind: "category", categoryId: category, with: unique(mode === "add" ? remaining : []) };
    if (removed.length > 0) next = remaining;
  } else {
    request = { kind: "none" };
    if (removed.length > 0) next = remaining;
  }

  return { request, next, removed, removedAddOns, tooMany, choiceAnswered, placed };
}

/** The Call's services as a list: the parts of a stored service id or Combo_Id. */
export function servicesOfCall(serviceId: string | undefined): string[] {
  return serviceId ? serviceId.split("+").filter(Boolean) : [];
}

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Temporal } from "temporal-polyfill";
import type { Line, Urgency } from "@/lib/conversation/types";
import { findTerm, normalizeForMatch } from "@/lib/messages/terms";
import { callerLinesOf, decideUrgency, type UrgencyInput } from "@/lib/messages/urgency";
import { LANGS, allSectorPacks, type SectorPack } from "@/lib/sectors";
import {
  ALL_PHRASES,
  ALL_TERMS,
  DST_NOW_DATES,
  NUM_RUNS,
  URGENCY_PACKS,
  arbCallerLines,
  arbCleanLines,
  arbPackTerm,
  arbTermVariant,
  arbUrgencyContext,
  oracleTokens,
} from "./arbitraries";

const RANK: Record<Urgency, number> = { low: 0, normal: 1, urgent: 2 };

// ---------------------------------------------------------------------------
// The oracle: Requirement 5.3–5.7 as a table, with its own matching and its own clock.

/** Whole-word, in-sequence match on token arrays (no substring search, no lib/messages code). */
const containsSeq = (hay: readonly string[], needle: readonly string[]) =>
  needle.length > 0 && hay.some((_, i) => needle.every((w, j) => hay[i + j] === w));
const anyTerm = (lines: readonly string[], terms: readonly string[]) =>
  lines.some((l) => terms.some((t) => containsSeq(oracleTokens(l), oracleTokens(t))));

// The Not_Urgent_Phrases rule (front-desk-brain 16.5), written the oracle's own way: no
// `maskPhrases`, no cutting the line into pieces. A token is covered when it sits inside any
// occurrence of any phrase; an urgent-term occurrence counts only if none of its tokens is covered.

/** The start of every occurrence of `needle` in `hay`. */
const startsOf = (hay: readonly string[], needle: readonly string[]) =>
  needle.length === 0 ? [] : hay.flatMap((_, i) => (needle.every((w, j) => hay[i + j] === w) ? [i] : []));
/** For every token, whether a phrase occurrence covers it. */
function coverOf(tokens: readonly string[], phrases: readonly string[]): boolean[] {
  const cov = tokens.map(() => false);
  for (const p of phrases) {
    const n = oracleTokens(p);
    for (const i of startsOf(tokens, n)) for (let j = 0; j < n.length; j++) cov[i + j] = true;
  }
  return cov;
}
const phrasesOf = (v: SectorPack["vocabulary"]) => LANGS.flatMap((l) => v[l].notUrgent ?? []);
const urgentOf = (v: SectorPack["vocabulary"]) => [...new Set(LANGS.flatMap((l) => v[l].urgent.map((t) => oracleTokens(t).join(" "))))];

/** Every urgent-term occurrence in the lines, split by whether a phrase covers part of it. */
function urgentOccurrences(lines: readonly string[], v: SectorPack["vocabulary"]) {
  let uncovered = 0;
  let covered = 0;
  for (const line of lines) {
    const toks = oracleTokens(line);
    const cov = coverOf(toks, phrasesOf(v));
    for (const term of urgentOf(v)) {
      const n = term.split(" ");
      for (const i of startsOf(toks, n)) {
        if (n.some((_, j) => cov[i + j])) covered++;
        else uncovered++;
      }
    }
  }
  return { uncovered, covered };
}

/** The two branches every property must reach: phrases hide every urgent term, or another one is left. */
type MaskBranch = "masked only" | "masked plus another urgent term" | null;
function maskBranch(lines: readonly string[], v: SectorPack["vocabulary"], ownUrgent = 0): MaskBranch {
  const o = urgentOccurrences(lines, v);
  if (o.covered === 0) return null;
  return o.uncovered - ownUrgent > 0 ? "masked plus another urgent term" : "masked only";
}
const reached = () => new Map<Exclude<MaskBranch, null>, number>([["masked only", 0], ["masked plus another urgent term", 0]]);
function count(seen: ReturnType<typeof reached>, b: MaskBranch) {
  if (b) seen.set(b, seen.get(b)! + 1);
}
function expectReached(seen: ReturnType<typeof reached>) {
  for (const [b, n] of seen) expect(n, b).toBeGreaterThan(0);
}

/** The shop-local date with Intl, not Temporal: "2026-03-29". */
const localDay = (epochMs: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(epochMs));
const plainDay = (d: Temporal.PlainDate) =>
  `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

interface Facts {
  urgentTerm: boolean;
  today: boolean;
  handled: boolean;
  modelFailed: boolean;
}
type Row = { [K in keyof Facts]?: boolean } & { rule: Urgency };

/** First matching row wins. A missing key means "any". */
const TABLE: readonly Row[] = [
  { urgentTerm: true, rule: "urgent" }, // 5.3
  { today: true, handled: false, rule: "urgent" }, // 5.4
  { today: true, handled: true, rule: "normal" }, // 5.5
  { modelFailed: true, rule: "normal" }, // 5.6
  { rule: "low" }, // 5.7
];

function oracleRule(input: UrgencyInput): Urgency {
  const v = input.vocabulary;
  const today = localDay(input.now.epochMilliseconds, input.timeZone);
  const facts: Facts = {
    urgentTerm: urgentOccurrences(input.callerLines, v).uncovered > 0,
    today:
      LANGS.some((l) => anyTerm(input.callerLines, v[l].today)) ||
      (input.requestedDate !== null && plainDay(input.requestedDate) === today) ||
      (input.bookingStart !== null && localDay(input.bookingStart.epochMilliseconds, input.timeZone) === today),
    handled: ["booked", "rescheduled", "cancelled"].includes(input.outcome),
    modelFailed: input.modelFailed,
  };
  const row = TABLE.find((r) => (Object.keys(facts) as (keyof Facts)[]).every((k) => r[k] === undefined || r[k] === facts[k]));
  return row!.rule;
}

const arbInput: fc.Arbitrary<UrgencyInput> = fc
  .record({ ctx: arbUrgencyContext, callerLines: arbCallerLines })
  .map(({ ctx, callerLines }) => ({ ...ctx, callerLines }));

/** Insert `word` as a separate word at position `pos` of line `lineIdx` (a new line if there is none). */
function insertWord(lines: readonly string[], lineIdx: number, pos: number, word: string): string[] {
  if (lines.length === 0) return [word];
  const out = [...lines];
  const k = lineIdx % out.length;
  const words = out[k] === "" ? [] : out[k].split(" ");
  words.splice(pos % (words.length + 1), 0, word);
  out[k] = words.join(" ");
  return out;
}

/**
 * Insert `parts` (in order, as separate words) at a word position, the way `insertWord` does,
 * when that keeps every token already in the line covered or not exactly as before (no phrase
 * broken, none made from old words) and leaves the `keep` parts outside every phrase. Otherwise
 * the parts go into a new line of their own, and failing that one new line each. For lines with
 * no Not_Urgent_Phrase every token stays uncovered, so this is exactly `insertWord`.
 */
function placeOutside(
  lines: readonly string[],
  lineIdx: number,
  pos: number,
  parts: readonly { text: string; keep: boolean }[],
  phrases: readonly string[],
): string[] {
  const tryAt = (base: readonly string[], k: number): string[] | null => {
    const words = base[k] === "" ? [] : base[k].split(" ");
    const at = pos % (words.length + 1);
    const before = coverOf(oracleTokens(base[k]), phrases);
    const next = [...words.slice(0, at), ...parts.map((p) => p.text), ...words.slice(at)].join(" ");
    const cov = coverOf(oracleTokens(next), phrases);
    let off = words.slice(0, at).flatMap(oracleTokens).length;
    const start = off;
    for (const p of parts) {
      const n = oracleTokens(p.text).length;
      if (p.keep && cov.slice(off, off + n).some(Boolean)) return null;
      off += n;
    }
    const outside = [...cov.slice(0, start), ...cov.slice(off)];
    if (outside.length !== before.length || outside.some((c, j) => c !== before[j])) return null;
    const out = [...base];
    out[k] = next;
    return out;
  };
  const base = lines.length > 0 ? lines : [""];
  return (
    tryAt(base, lineIdx % base.length) ??
    tryAt([...lines, ""], lines.length) ??
    [...lines, ...parts.map((p) => p.text)]
  );
}

describe("urgency properties (owner-machine)", () => {
  it("the generators run over every pack, and the clock hits both 2026 Madrid DST weekends", () => {
    expect(URGENCY_PACKS.map((p) => p.id).sort()).toEqual(allSectorPacks().map((p) => p.id).sort());
    const sample = fc.sample(arbInput, NUM_RUNS);
    const days = new Set(sample.map((c) => localDay(c.now.epochMilliseconds, "Europe/Madrid")));
    expect(DST_NOW_DATES.some((d) => d.startsWith("2026-03") && days.has(d))).toBe(true);
    expect(DST_NOW_DATES.some((d) => d.startsWith("2026-10") && days.has(d))).toBe(true);
    // Every rule of the table is reached.
    const rules = new Set<string>(sample.map((c) => decideUrgency(c).basis.rule));
    for (const r of ["urgent_term", "today_open", "today_handled", "model_failed", "none"]) expect(rules.has(r), r).toBe(true);
    // Not_Urgent_Phrases exist, and no phrase fits inside one urgent term, so a term placed in a
    // line of its own is never masked (the last fallback of `placeOutside`).
    expect(ALL_PHRASES.length).toBeGreaterThan(0);
    for (const t of ALL_TERMS) for (const p of ALL_PHRASES) expect(startsOf(oracleTokens(t), oracleTokens(p)), `${t} / ${p}`).toEqual([]);
  });

  it("M1: the Final_Urgency is never below the rule or the suggestion, and the rule equals the table oracle (15.1, 5.3–5.8)", () => {
    const seen = reached();
    fc.assert(
      fc.property(arbInput, (input) => {
        count(seen, maskBranch(input.callerLines, input.vocabulary));
        const d = decideUrgency(input);
        const final: Urgency = d.final; // a FinalUrgency is an Urgency
        expect(d.rule).toBe(oracleRule(input));
        expect(RANK[final]).toBeGreaterThanOrEqual(RANK[d.rule]);
        if (input.suggested !== null) expect(RANK[final]).toBeGreaterThanOrEqual(RANK[input.suggested]);
        // 5.8 exactly: the higher of the two, or the rule alone with no suggestion.
        const expected = input.suggested !== null && RANK[input.suggested] > RANK[d.rule] ? input.suggested : d.rule;
        expect(d.final).toBe(expected);
        expect(d.suggested).toBe(input.suggested);
      }),
      { numRuns: NUM_RUNS },
    );
    // Not_Urgent_Phrases (front-desk-brain 16.5): both branches were exercised against the oracle.
    expectReached(seen);
  });

  it("M2: an urgent term inserted in any case, accent, spacing and punctuation variant always gives urgent with basis urgent_term (15.2, 5.3, 5.9)", () => {
    const seen = reached();
    const arb = fc
      .record({
        ctx: arbUrgencyContext,
        lines: arbCallerLines,
        pick: arbPackTerm("urgent"),
        lineIdx: fc.nat(),
        pos: fc.nat(),
        // A Not_Urgent_Phrase of the same pack right next to the term, before or after it, now and then.
        phrase: fc.option(fc.record({ k: fc.nat(), first: fc.boolean() }), { freq: 2 }),
      })
      .chain((g) => {
        const phrases = phrasesOf(g.pick.pack.vocabulary);
        const phrase = g.phrase && phrases.length > 0 ? phrases[g.phrase.k % phrases.length] : null;
        return fc
          .tuple(arbTermVariant(g.pick.term), phrase === null ? fc.constant(null) : arbTermVariant(phrase))
          .map(([variant, phraseVariant]) => ({ ...g, variant, phraseVariant }));
      });
    fc.assert(
      fc.property(arb, ({ ctx, lines, pick, lineIdx, pos, variant, phrase, phraseVariant }) => {
        const vocabulary = pick.pack.vocabulary;
        const term = { text: variant, keep: true };
        const parts =
          phraseVariant === null
            ? [term]
            : phrase!.first
              ? [{ text: phraseVariant, keep: false }, term]
              : [term, { text: phraseVariant, keep: false }];
        // The term stays outside every phrase: inside one it would rightly not count (16.5).
        const callerLines = placeOutside(lines, lineIdx, pos, parts, phrasesOf(vocabulary));
        count(seen, maskBranch(callerLines, vocabulary, 1));
        const d = decideUrgency({ ...ctx, vocabulary, callerLines });
        expect(d.final).toBe("urgent");
        expect(d.rule).toBe("urgent");
        expect(d.basis.rule).toBe("urgent_term");
      }),
      { numRuns: NUM_RUNS },
    );
    // "masked only" here: the inserted term is the one urgent term outside a phrase.
    expectReached(seen);
  });

  it("M3(a): terms moved from the Caller's lines to the Receptionist's give the rule as if they were absent (5.10)", () => {
    const seen = reached();
    const arb = fc
      .record({
        ctx: arbUrgencyContext,
        clean: arbCleanLines,
        picks: fc.array(fc.record({ pick: arbPackTerm("both"), lineIdx: fc.nat(), pos: fc.nat() }), {
          minLength: 1,
          maxLength: 5,
        }),
        // Not_Urgent_Phrases on the Caller's side, next to the terms (front-desk-brain 16.5).
        phrases: fc.array(fc.record({ k: fc.nat(), lineIdx: fc.nat(), pos: fc.nat() }), { maxLength: 3 }),
      })
      .chain((g) => {
        const own = phrasesOf(g.picks[0].pick.pack.vocabulary);
        const chosen = own.length === 0 ? [] : g.phrases.map((p) => ({ ...p, phrase: own[p.k % own.length] }));
        return fc
          .record({
            variants: fc.tuple(...g.picks.map((p) => arbTermVariant(p.pick.term))),
            phraseVariants: fc.tuple(...chosen.map((p) => arbTermVariant(p.phrase))),
          })
          .map(({ variants, phraseVariants }) => ({ ...g, chosen, variants, phraseVariants }));
      });
    fc.assert(
      fc.property(arb, ({ ctx, clean, picks, chosen, variants, phraseVariants }) => {
        const vocabulary = picks[0].pick.pack.vocabulary;
        const phrases = phrasesOf(vocabulary);
        // Make sure there is a line for every term to sit in, on either side.
        let callerClean = clean.length > 0 ? clean : [""];
        chosen.forEach((p, k) => {
          callerClean = placeOutside(callerClean, p.lineIdx, p.pos, [{ text: phraseVariants[k], keep: false }], phrases);
        });
        let withTerms = callerClean;
        const receptionist = callerClean.map(() => "");
        picks.forEach((p, k) => {
          // A term inside a phrase would rightly not count (16.5), so it is kept outside.
          withTerms = placeOutside(withTerms, p.lineIdx, p.pos, [{ text: variants[k], keep: true }], phrases);
          const r = p.lineIdx % receptionist.length;
          receptionist[r] = insertWord([receptionist[r]], 0, p.pos, variants[k])[0];
        });
        const callerSide: Line[] = withTerms.map((caller) => ({ caller, receptionist: "" }));
        const moved: Line[] = callerClean.map((caller, k) => ({ caller, receptionist: receptionist[k] }));
        const absent: Line[] = callerClean.map((caller) => ({ caller, receptionist: "" }));

        const of = (t: Line[]) => decideUrgency({ ...ctx, vocabulary, callerLines: callerLinesOf(t) });
        const a = of(absent);
        const m = of(moved);
        expect(m.rule).toBe(a.rule);
        expect(m.basis).toEqual(a.basis);
        // The same terms on the Caller's side do count: a term rule fires.
        const c = of(callerSide);
        expect(["urgent_term", "today_open", "today_handled"]).toContain(c.basis.rule);
        // The phrases mask only their own words: the urgent rule fires exactly when the oracle
        // finds an urgent term outside every phrase. (Not "whenever an urgent term was picked": a
        // later pick may land inside an earlier multi-word one, "me hoy quema", seed 798051912.)
        const uncovered = urgentOccurrences(withTerms, vocabulary).uncovered > 0;
        expect(c.basis.rule === "urgent_term").toBe(uncovered);
        expect(a.basis.rule).not.toBe("urgent_term");
        const branch = maskBranch(withTerms, vocabulary);
        count(seen, branch);
        if (branch === "masked only") expect(c.basis.rule).not.toBe("urgent_term");
      }),
      { numRuns: NUM_RUNS },
    );
    expectReached(seen);
  });

  it("M3(b): a term glued to letters on either side does not match (5.9)", () => {
    const letters = fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzñáéíóú"), minLength: 1, maxLength: 3 });
    const arb = fc.record({
      pick: arbPackTerm("both"),
      side: fc.constantFrom("before", "after", "both"),
      pre: letters,
      post: letters,
      clean: arbCleanLines,
      lineIdx: fc.nat(),
      pos: fc.nat(),
    });
    fc.assert(
      fc.property(arb, ({ pick, side, pre, post, clean, lineIdx, pos }) => {
        const glued = `${side === "after" ? "" : pre}${pick.term}${side === "before" ? "" : post}`;
        const lines = insertWord(clean, lineIdx, pos, glued);
        expect(findTerm(lines, [pick.term])).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
    // The named near-misses.
    expect(findTerm(["hoyo"], ["hoy"])).toBeNull();
    expect(findTerm(["xurgente"], ["urgente"])).toBeNull();
  });

  it("M3(c): normalizeForMatch is idempotent (5.9)", () => {
    const arb = fc.oneof(
      fc.string({ unit: "binary", maxLength: 40 }),
      fc.string({ unit: "grapheme", maxLength: 40 }),
      fc.constantFrom(...ALL_TERMS).chain(arbTermVariant),
      arbCallerLines.map((ls) => ls.join("\n")),
    );
    fc.assert(
      fc.property(arb, (s) => {
        const once = normalizeForMatch(s);
        expect(normalizeForMatch(once)).toBe(once);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

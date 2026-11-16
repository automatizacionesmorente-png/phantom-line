import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Temporal } from "temporal-polyfill";
import type { Line, Urgency } from "@/lib/conversation/types";
import { findTerm, normalizeForMatch } from "@/lib/messages/terms";
import { callerLinesOf, decideUrgency, type UrgencyInput } from "@/lib/messages/urgency";
import { LANGS, allSectorPacks } from "@/lib/sectors";
import {
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
    urgentTerm: LANGS.some((l) => anyTerm(input.callerLines, v[l].urgent)),
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
  });

  it("M1: the Final_Urgency is never below the rule or the suggestion, and the rule equals the table oracle (15.1, 5.3–5.8)", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
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
  });

  it("M2: an urgent term inserted in any case, accent, spacing and punctuation variant always gives urgent with basis urgent_term (15.2, 5.3, 5.9)", () => {
    const arb = fc
      .record({
        ctx: arbUrgencyContext,
        lines: arbCallerLines,
        pick: arbPackTerm("urgent"),
        lineIdx: fc.nat(),
        pos: fc.nat(),
      })
      .chain((g) => arbTermVariant(g.pick.term).map((variant) => ({ ...g, variant })));
    fc.assert(
      fc.property(arb, ({ ctx, lines, pick, lineIdx, pos, variant }) => {
        const callerLines = insertWord(lines, lineIdx, pos, variant);
        const d = decideUrgency({ ...ctx, vocabulary: pick.pack.vocabulary, callerLines });
        expect(d.final).toBe("urgent");
        expect(d.rule).toBe("urgent");
        expect(d.basis.rule).toBe("urgent_term");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("M3(a): terms moved from the Caller's lines to the Receptionist's give the rule as if they were absent (5.10)", () => {
    const arb = fc
      .record({
        ctx: arbUrgencyContext,
        clean: arbCleanLines,
        picks: fc.array(fc.record({ pick: arbPackTerm("both"), lineIdx: fc.nat(), pos: fc.nat() }), {
          minLength: 1,
          maxLength: 5,
        }),
      })
      .chain((g) =>
        fc
          .tuple(...g.picks.map((p) => arbTermVariant(p.pick.term)))
          .map((variants) => ({ ...g, variants })),
      );
    fc.assert(
      fc.property(arb, ({ ctx, clean, picks, variants }) => {
        const vocabulary = picks[0].pick.pack.vocabulary;
        // Make sure there is a line for every term to sit in, on either side.
        const callerClean = clean.length > 0 ? clean : [""];
        let withTerms = callerClean;
        const receptionist = callerClean.map(() => "");
        picks.forEach((p, k) => {
          withTerms = insertWord(withTerms, p.lineIdx, p.pos, variants[k]);
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
        expect(["urgent_term", "today_open", "today_handled"]).toContain(of(callerSide).basis.rule);
      }),
      { numRuns: NUM_RUNS },
    );
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

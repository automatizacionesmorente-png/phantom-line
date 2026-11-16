import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import type { Outcome, Urgency } from "@/lib/conversation/types";
import type { UrgencyInput } from "@/lib/messages/urgency";
import { LANGS, allSectorPacks, type Lang, type SectorPack } from "@/lib/sectors";
import { TIME_ZONES, arbNow, wallInstant } from "../booking/arbitraries";

/** Runs per property (design: 200; Requirement 15.6: at least 100). */
export const NUM_RUNS = 200;

/** Every pack in the registry: the urgency properties run over all of them. */
export const URGENCY_PACKS: readonly SectorPack[] = allSectorPacks();

export const OUTCOMES: readonly Outcome[] = [
  "booked",
  "rescheduled",
  "cancelled",
  "answered",
  "message",
  "fallback",
  "abandoned",
];
export const arbOutcome: fc.Arbitrary<Outcome> = fc.constantFrom(...OUTCOMES);
export const arbSuggested: fc.Arbitrary<Urgency | null> = fc.constantFrom<Urgency | null>("low", "normal", "urgent", null);

/** Independent of lib/messages/terms: NFD, strip marks, lower case, split on anything that is not a letter or digit. */
export const oracleTokens = (s: string): string[] =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");

/** Every term of every pack, both lists, both languages. */
export const ALL_TERMS: readonly string[] = [
  ...new Set(URGENCY_PACKS.flatMap((p) => LANGS.flatMap((l) => [...p.vocabulary[l].urgent, ...p.vocabulary[l].today]))),
];
const TERM_TOKENS: ReadonlySet<string> = new Set(ALL_TERMS.flatMap(oracleTokens));

/** Words that look close to a term but are not one as a whole word. */
export const NEAR_MISSES = [
  "hoyo",
  "hoyos",
  "alergólogo",
  "painting",
  "urgencias",
  "emergencias",
  "dolores",
  "reactivo",
  "burned",
  "todays",
  "tonights",
  "picante",
  "quemado",
] as const;

const PLAIN = [
  "quería",
  "una",
  "cita",
  "para",
  "el",
  "martes",
  "corte",
  "tinte",
  "llamo",
  "Ana",
  "Luis",
  "gracias",
  "hola",
  "sí",
  "no",
  "vale",
  "mañana",
  "tarde",
  "esta",
  "lo",
  "antes",
  "posible",
  "me",
  "pica",
  "ahora",
  "mismo",
  "hello",
  "I",
  "want",
  "a",
  "haircut",
  "on",
  "Friday",
  "please",
  "this",
  "morning",
  "right",
  "now",
  "as",
  "soon",
  "5",
  "10:30",
  "600 000 000",
  "¿",
  "?",
  "…",
] as const;

/** Plain words and near-misses that share no token with any term, so no term can ever match in them. */
export const CLEAN_WORDS: readonly string[] = [...PLAIN, ...NEAR_MISSES].filter((w) =>
  oracleTokens(w).every((t) => !TERM_TOKENS.has(t)),
);

const ACCENTED: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú", n: "ñ", A: "Á", E: "É" };
const PUNCT = ["", "", ",", ".", "!", "¡", "¿", "?", "«", "»", "(", ")", "\"", ":", "…"] as const;

/** A term in random case per letter, accents added or removed, spaces doubled, and punctuation around it. */
export function arbTermVariant(term: string): fc.Arbitrary<string> {
  const chars = [...term];
  const n = chars.length;
  return fc
    .record({
      upper: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
      accent: fc.array(fc.constantFrom("keep", "strip", "add"), { minLength: n, maxLength: n }),
      spaces: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: n, maxLength: n }),
      before: fc.constantFrom(...PUNCT),
      after: fc.constantFrom(...PUNCT),
    })
    .map(({ upper, accent, spaces, before, after }) => {
      const body = chars
        .map((c, k) => {
          if (c === " ") return " ".repeat(spaces[k]);
          const bare = c.normalize("NFD").replace(/\p{M}/gu, "");
          const shaped = accent[k] === "strip" ? bare : accent[k] === "add" ? (ACCENTED[bare] ?? c) : c;
          return upper[k] ? shaped.toUpperCase() : shaped.toLowerCase();
        })
        .join("");
      return `${before}${body}${after}`;
    });
}

/** One word for a Caller line: mostly plain, some near-misses, some term variants. */
const arbWord: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...PLAIN) },
  { weight: 2, arbitrary: fc.constantFrom(...NEAR_MISSES) },
  { weight: 1, arbitrary: fc.constantFrom(...ALL_TERMS).chain(arbTermVariant) },
);
const lineOf = (word: fc.Arbitrary<string>) => fc.array(word, { maxLength: 10 }).map((ws) => ws.join(" "));

/** 0–20 Caller lines of random words, near-misses included, with terms of every pack now and then. */
export const arbCallerLines: fc.Arbitrary<string[]> = fc.array(lineOf(arbWord), { maxLength: 20 });

/** 0–20 Caller lines in which no term of any pack can match. */
export const arbCleanLines: fc.Arbitrary<string[]> = fc.array(lineOf(fc.constantFrom(...CLEAN_WORDS)), { maxLength: 20 });

/** The 2026 Madrid DST days and the days before them. */
export const DST_NOW_DATES = ["2026-03-28", "2026-03-29", "2026-10-24", "2026-10-25"] as const;

/** `arbNow`, plus any minute of the 2026 Madrid DST weekends (Requirement 15.6). */
export const arbUrgencyNow: fc.Arbitrary<Temporal.Instant> = fc.oneof(
  { weight: 2, arbitrary: arbNow },
  {
    weight: 1,
    arbitrary: fc
      .record({ d: fc.constantFrom(...DST_NOW_DATES), m: fc.integer({ min: 0, max: 1439 }) })
      .map(({ d, m }) => wallInstant(Temporal.PlainDate.from(d), m, "Europe/Madrid")),
  },
);

export const arbTimeZone: fc.Arbitrary<string> = fc.oneof(
  { weight: 2, arbitrary: fc.constant("Europe/Madrid") },
  { weight: 1, arbitrary: fc.constantFrom(...TIME_ZONES) },
);

/** Everything `decideUrgency` reads, except the Caller lines. */
export type UrgencyContext = Omit<UrgencyInput, "callerLines">;

/**
 * A pack, time zone and `now`, with a requested day and a Booking start that land on
 * the shop's today often (including late at night on the DST days), or are absent.
 */
export const arbUrgencyContext: fc.Arbitrary<UrgencyContext> = fc
  .record({ pack: fc.constantFrom(...URGENCY_PACKS), timeZone: arbTimeZone, now: arbUrgencyNow })
  .chain(({ pack, timeZone, now }) => {
    const today = now.toZonedDateTimeISO(timeZone).toPlainDate();
    const requestedDate = fc.oneof(
      fc.constant(null),
      fc.integer({ min: -2, max: 3 }).map((d) => today.add({ days: d })),
    );
    const bookingStart = fc.oneof(
      fc.constant(null),
      fc.integer({ min: -3 * 1440, max: 3 * 1440 }).map((m) => now.add({ minutes: m })),
      fc
        .record({ d: fc.integer({ min: -1, max: 1 }), m: fc.integer({ min: 0, max: 1439 }) })
        .map(({ d, m }) => wallInstant(today.add({ days: d }), m, timeZone)),
    );
    return fc.record({
      vocabulary: fc.constant(pack.vocabulary),
      timeZone: fc.constant(timeZone),
      now: fc.constant(now),
      requestedDate,
      bookingStart,
      outcome: arbOutcome,
      modelFailed: fc.boolean(),
      suggested: arbSuggested,
    });
  });

/** A term of one list of one pack language, with its pack and language. */
export const arbPackTerm = (list: "urgent" | "today" | "both"): fc.Arbitrary<{ pack: SectorPack; lang: Lang; term: string }> =>
  fc
    .record({ pack: fc.constantFrom(...URGENCY_PACKS), lang: fc.constantFrom(...LANGS), k: fc.nat() })
    .map(({ pack, lang, k }) => {
      const terms =
        list === "both" ? [...pack.vocabulary[lang].urgent, ...pack.vocabulary[lang].today] : pack.vocabulary[lang][list];
      return { pack, lang, term: terms[k % terms.length] };
    });

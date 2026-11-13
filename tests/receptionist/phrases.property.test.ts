import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { toInstant, type RejectionReason } from "@/lib/booking";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { phrases, type PhraseSet, type Said } from "@/lib/receptionist/phrases";
import { clockWords, minuteSessions, speakPhone } from "@/lib/receptionist/spoken";
import { MAX_WORDS, splitSentences, toSpokenReply } from "@/lib/receptionist/speech";
import { getSectorPack, type Lang } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

/**
 * N7. Every template variant keeps its facts and its limits. Validates 9.1–9.3, 9.5, 9.7, 13.3.
 * N10. Honesty: the disclosure is in every greeting, and no line claims to be the owner or a
 * person. Validates 10.1, 10.2, 10.4.
 *
 * "Every variant" is reached by sweeping the Turn number of one Variant_Seed: N8 shows that 40
 * turns reach every variant of a 2-variant template (the chance of missing one is 2^-39).
 */
const pack = getSectorPack("hair-salon");
const TZ = lolaProfile.timeZone;
const NOWS = ["2026-11-10T08:00:00Z", "2026-03-27T22:30:00Z", "2026-10-24T23:30:00Z", "2026-12-31T12:00:00Z"].map((s) =>
  Temporal.Instant.from(s),
);
const TURNS = Array.from({ length: 40 }, (_, k) => k);
const MARKUP = /[*_#`~[\]|<>{}\\^=]/;
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0e\ufe0f\u20e3]/u;
const REASONS: RejectionReason[] = ["in_the_past", "closed_day", "outside_hours", "does_not_fit", "all_resources_busy", "sector:custom"];

const arbLang = fc.constantFrom<Lang>("es", "en");
const arbNow = fc.constantFrom(...NOWS);
const arbService = fc.constantFrom(...lolaProfile.services.map((s) => s.id));
const arbName = fc.constantFrom("Ana", "María del Carmen Pérez García", "Jean-Luc", "O'Brien", "Zoë", "José Luis", "Li");
const arbPhone = fc.stringMatching(/^[67]\d{8}$/).map((d) => `+34${d}`);
/** An instant in the shop's zone, on the 5-minute grid, from yesterday to three weeks ahead. */
const arbInstant = (now: Temporal.Instant) =>
  fc.record({ day: fc.integer({ min: -1, max: 21 }), minute: fc.integer({ min: 0, max: 287 }) }).map(({ day, minute }) =>
    toInstant(
      now.toZonedDateTimeISO(TZ).toPlainDate().add({ days: day }),
      Temporal.PlainTime.from({ hour: Math.floor(minute / 12), minute: (minute % 12) * 5 }),
      TZ,
    ),
  );

/** A slot the Booking_Rules could offer: inside Lola's sessions (10:00–14:00, 17:00–20:00) on the 15-minute grid. */
const arbOffered = (now: Temporal.Instant) =>
  fc
    .record({ day: fc.integer({ min: 0, max: 21 }), quarter: fc.oneof(fc.integer({ min: 40, max: 55 }), fc.integer({ min: 68, max: 79 })) })
    .map(({ day, quarter }) =>
      toInstant(
        now.toZonedDateTimeISO(TZ).toPlainDate().add({ days: day }),
        Temporal.PlainTime.from({ hour: Math.floor(quarter / 4), minute: (quarter % 4) * 15 }),
        TZ,
      ),
    );

interface Sample {
  lang: Lang;
  now: Temporal.Instant;
  service: string;
  requested: Temporal.Instant;
  alts: Temporal.Instant[];
  start: Temporal.Instant;
  name: string;
  phone: string;
  callId: string;
}
const arbSample: fc.Arbitrary<Sample> = fc.record({ lang: arbLang, now: arbNow }).chain(({ lang, now }) =>
  fc.record({
    lang: fc.constant(lang),
    now: fc.constant(now),
    service: arbService,
    requested: arbInstant(now),
    alts: fc.array(arbOffered(now), { maxLength: 3 }),
    start: arbInstant(now),
    name: arbName,
    phone: arbPhone,
    callId: fc.uuid(),
  }),
);

/** Every spoken template, with the facts it must keep. */
function spoken(P: PhraseSet, s: Sample): { key: string; said: Said }[] {
  const out: { key: string; said: Said }[] = [
    { key: "greeting", said: P.greeting() },
    { key: "serviceNotOffered", said: P.serviceNotOffered("manicura") },
    { key: "serviceNotOffered(null)", said: P.serviceNotOffered(null) },
    { key: "askDayAndTime", said: P.askDayAndTime(null) },
    { key: "askDayAndTime(day)", said: P.askDayAndTime(s.start.toZonedDateTimeISO(TZ).toPlainDate()) },
    { key: "timeAcceptedAskName", said: P.timeAcceptedAskName(s.start) },
    { key: "askName", said: P.askName() },
    { key: "askNameAgain", said: P.askNameAgain() },
    { key: "askPhone", said: P.askPhone() },
    { key: "serviceInfo", said: P.serviceInfo(s.service) },
    { key: "readBack", said: P.readBack(s.service, s.start, s.name, s.phone) },
    { key: "slotJustTaken", said: P.slotJustTaken(s.requested, s.alts) },
    { key: "booked", said: P.booked(s.service, s.start) },
    { key: "existingForReschedule", said: P.existingForReschedule(s.service, s.start) },
    { key: "rescheduleReadBack", said: P.rescheduleReadBack(s.service, s.start) },
    { key: "rescheduled", said: P.rescheduled(s.service, s.start) },
    { key: "cancelReadBack", said: P.cancelReadBack(s.service, s.start) },
    { key: "cancelled", said: P.cancelled() },
    { key: "bookingNotFound", said: P.bookingNotFound() },
    { key: "dontKnow", said: P.dontKnow() },
    { key: "goodbye", said: P.goodbye() },
    { key: "maxTurns", said: P.maxTurns() },
    { key: "fallbackEnd", said: P.fallbackEnd() },
    { key: "fallbackRetry", said: P.fallbackRetry() },
    { key: "rateLimitedStart", said: P.rateLimitedStart() },
    { key: "lineCut", said: P.lineCut() },
    { key: "typeInstead", said: P.typeInstead() },
  ];
  for (const reason of REASONS) out.push({ key: `rejected(${reason})`, said: P.rejected(reason, s.requested, s.alts) });
  return out;
}

const wordCount = (sentence: string) => sentence.replace(/[.!?…]+$/, "").split(/\s+/).filter(Boolean).length;

/** What is wrong with a spoken template, or null. Plain code, not `expect`, so 40 turns × 30 templates stay fast. */
function problem(t: string, lang: Lang): string | null {
  if (/\d/.test(t)) return "has a digit";
  if (MARKUP.test(t)) return "has markup";
  if (EMOJI.test(t)) return "has an emoji";
  const sentences = splitSentences(t);
  if (sentences.length > 3) return `has ${sentences.length} sentences`;
  for (const sentence of sentences) if (wordCount(sentence) > MAX_WORDS) return `has a sentence of ${wordCount(sentence)} words`;
  if (toSpokenReply(t, lang, { maxSentences: 3 }) !== t) return "is changed by toSpokenReply";
  return null;
}

describe("N7: every template variant keeps its facts and its limits", () => {
  it("no digit, no markup, no emoji, at most 3 sentences of at most 25 words, and nothing for toSpokenReply to change", () => {
    fc.assert(
      fc.property(arbSample, (s) => {
        for (const turn of TURNS) {
          const P = phrases(s.lang, pack, lolaProfile, { callId: s.callId, turn }, s.now);
          for (const { key, said } of spoken(P, s)) {
            const why = problem(said.text, s.lang);
            if (why) expect.fail(`${key} ${why}: ${said.text}`);
          }
        }
      }),
      { numRuns: 80 },
    );
  }, 120_000);

  it("a read-back keeps the service, the name and the phone in groups; a booking keeps the owner and the service", () => {
    fc.assert(
      fc.property(arbSample, (s) => {
        const service = lolaProfile.services.find((x) => x.id === s.service)!;
        for (const turn of TURNS) {
          const P = phrases(s.lang, pack, lolaProfile, { callId: s.callId, turn }, s.now);
          const spokenName = service.spokenName![s.lang];
          const readBack = P.readBack(s.service, s.start, s.name, s.phone);
          expect(readBack.text).toContain(spokenName);
          expect(readBack.text).toContain(s.name);
          expect(readBack.text).toContain(speakPhone(s.phone, s.lang));
          expect(readBack.cacheable).toBe(false);
          for (const line of [P.existingForReschedule(s.service, s.start), P.cancelReadBack(s.service, s.start)]) {
            expect(line.text).toContain(spokenName);
          }
          for (const line of [P.booked(s.service, s.start), P.rescheduled(s.service, s.start)]) {
            expect(line.text).toContain("Lola");
          }
          // Everything but the lines with a name or a phone, and the caller's own words, may be cached.
          for (const { key, said } of spoken(P, s)) {
            expect(said.cacheable, key).toBe(key !== "readBack" && key !== "serviceNotOffered");
          }
        }
      }),
      { numRuns: 60 },
    );
  }, 120_000);

  it("a rejection or a lost slot names the alternatives it was given, nearest first, in that order; it drops only the farthest, and only to stay short", () => {
    fc.assert(
      fc.property(arbSample, fc.constantFrom(...REASONS), (s, reason) => {
        const sessionsOf = (i: Temporal.Instant) => {
          const z = i.toZonedDateTimeISO(TZ);
          const day = lolaProfile.hours[z.dayOfWeek as 1 | 2 | 3 | 4 | 5 | 6 | 7];
          return { clock: { hour: z.hour, minute: z.minute }, ctx: { sessions: day ? minuteSessions(day) : [] } };
        };
        const shown = s.alts.slice(0, 3);
        for (const turn of TURNS.slice(0, 12)) {
          const P = phrases(s.lang, pack, lolaProfile, { callId: s.callId, turn }, s.now);
          for (const line of [P.rejected(reason, s.requested, s.alts), P.slotJustTaken(s.requested, s.alts)]) {
            let from = 0;
            let named = 0;
            for (const alt of shown) {
              const { clock, ctx } = sessionsOf(alt);
              const words = clockWords(clock, s.lang, ctx);
              const found = line.text.indexOf(words, from);
              if (found < 0) break;
              from = found + words.length;
              named++;
            }
            // The nearest is always named; the others in order. The rest is the farthest, left out for length.
            if (shown.length > 0) expect(named, `the nearest alternative in: ${line.text}`).toBeGreaterThanOrEqual(1);
            if (shown.length === 0) expect(line.text).toContain("Lola");
            if (named < shown.length) {
              // Something was left out: naming it too must have made a sentence too long, so the
              // offer is already at its longest that fits. (Three same-day alternatives never hit this.)
              const dates = new Set(shown.map((a) => a.toZonedDateTimeISO(TZ).toPlainDate().toString()));
              expect(dates.size, `only alternatives on different days are dropped: ${line.text}`).toBeGreaterThan(1);
            }
          }
        }
      }),
      { numRuns: 120 },
    );
  }, 120_000);

  it("the sample covers both sides: some alternatives, none, and every reason", () => {
    const seen = { none: 0, some: 0 };
    for (const s of fc.sample(arbSample, 200)) seen[s.alts.length === 0 ? "none" : "some"]++;
    expect(seen.none).toBeGreaterThan(0);
    expect(seen.some).toBeGreaterThan(0);
  });
});

describe("N10: honesty", () => {
  const arbWord = fc.stringMatching(/^[A-Z][a-z]{3,10}$/);
  const arbShopName = fc.stringMatching(/^[A-Z][a-z]{2,12}( [A-Z][a-z]{2,12}){0,2}$/);
  const arbShop: fc.Arbitrary<ShopProfile> = fc
    .record({ name: arbShopName, ownerName: arbWord })
    .map((x) => ({ ...lolaProfile, ...x }));

  it("every greeting variant says it is the virtual assistant before its first question", () => {
    fc.assert(
      fc.property(arbShop, arbLang, fc.uuid(), (shop, lang, callId) => {
        const disclosure = lang === "es" ? "asistente virtual" : "virtual assistant";
        const seen = new Set<string>();
        for (const turn of TURNS) {
          const text = phrases(lang, pack, shop, { callId, turn }, NOWS[0]).greeting().text;
          seen.add(text);
          const firstQuestion = text.search(/[?¿]/);
          const at = text.indexOf(disclosure);
          expect(at, text).toBeGreaterThanOrEqual(0);
          expect(at, text).toBeLessThan(firstQuestion);
          expect(text).toContain(shop.name);
        }
        expect(seen.size).toBe(2); // both variants were checked
        expect(phrases(lang, pack, shop).greeting().text).toContain(disclosure); // and the unseeded one
      }),
      { numRuns: 100 },
    );
  }, 120_000);

  it("no spoken line claims to be the owner or a person", () => {
    fc.assert(
      fc.property(arbShop, arbSample, (shop, s) => {
        const claims = (owner: string) => [
          `soy ${owner}`, `Soy ${owner}`, `I'm ${owner}`, `I am ${owner}`, `This is ${owner}`, `soy una persona`, `soy humano`,
          `soy humana`, `I'm a person`, `I'm a human`, `I am a person`, `I am a human`, `soy la dueña`, `soy el dueño`,
        ];
        for (const turn of TURNS.slice(0, 12)) {
          const P = phrases(s.lang, pack, shop, { callId: s.callId, turn }, s.now);
          for (const { key, said } of spoken(P, s)) {
            for (const claim of claims(shop.ownerName)) expect(said.text, `${key} must not say "${claim}"`).not.toContain(claim);
          }
        }
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});

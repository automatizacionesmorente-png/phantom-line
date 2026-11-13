import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { toInstant } from "@/lib/booking";
import { decideTurn } from "@/lib/conversation/decide";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { initialCallState } from "@/lib/conversation/types";
import { cachePlan, type PlanLine } from "@/lib/receptionist/cachePlan";
import { phrases, type Said } from "@/lib/receptionist/phrases";
import { spokenTemplate, toSpokenReply } from "@/lib/receptionist/speech";
import { speakPhone } from "@/lib/receptionist/spoken";
import { planEviction } from "@/lib/receptionist/voiceCacheBudget";
import { cacheKey } from "@/lib/receptionist/voiceCacheKey";
import { getSectorPack, type Lang } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";
import { modelTurn } from "../api/harness";

const pack = getSectorPack("hair-salon");
const TZ = lolaProfile.timeZone;

// ---------------------------------------------------------------------------
// N16. Cache keys and cacheability. Validates 2.4.

const arbText = fc.string({ minLength: 1, maxLength: 120, unit: "grapheme" });
const arbInputs = fc.tuple(
  fc.constantFrom("gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview", "x|y"),
  fc.constantFrom("es-es-commercial-3", "Kore", "Callirrhoe", "a|b"),
  fc.string({ maxLength: 200 }),
  fc.constantFrom("es-ES", "en-US"),
  arbText,
);
/** One input changed: a different value for a field, or one character of the text changed, added or removed. */
const arbChange = fc.record({
  field: fc.integer({ min: 0, max: 4 }),
  at: fc.nat(),
  ch: fc.string({ minLength: 1, maxLength: 1 }),
  op: fc.constantFrom("replace", "insert", "delete"),
});

function changed(value: string, c: { at: number; ch: string; op: string }): string {
  const i = value.length === 0 ? 0 : c.at % (value.length + (c.op === "insert" ? 1 : 0));
  if (c.op === "insert" || value.length === 0) return value.slice(0, i) + c.ch + value.slice(i);
  if (c.op === "delete") return value.slice(0, i) + value.slice(i + 1);
  const replaced = value.slice(0, i) + c.ch + value.slice(i + 1);
  return replaced === value ? value + c.ch : replaced;
}

/** Names that never occur in a template by chance. */
const arbName = fc.oneof(
  fc.constantFrom("Ximena", "Bartolomé", "Eustaquio", "Zuriñe", "María del Carmen Pérez García", "Jean-Luc", "O'Brien"),
  fc.stringMatching(/^Qz[a-z]{2,8}$/),
);
const arbPhone = fc.stringMatching(/^[67]\d{8}$/).map((d) => `+34${d}`);
const NOWS = ["2026-11-10T08:00:00Z", "2026-03-27T22:30:00Z", "2026-10-24T23:30:00Z"].map((s) => Temporal.Instant.from(s));
const arbStart = fc
  .record({ now: fc.constantFrom(...NOWS), day: fc.integer({ min: 0, max: 14 }), quarter: fc.integer({ min: 40, max: 79 }) })
  .map(({ now, day, quarter }) => ({
    now,
    start: toInstant(
      now.toZonedDateTimeISO(TZ).toPlainDate().add({ days: day }),
      Temporal.PlainTime.from({ hour: Math.floor(quarter / 4), minute: (quarter % 4) * 15 }),
      TZ,
    ),
  }));

describe("N16: cache keys and cacheability", () => {
  it("cacheKey is 32 hex characters, deterministic, and has no rate input", () => {
    expect(cacheKey.length).toBe(5);
    fc.assert(
      fc.property(arbInputs, (inputs) => {
        const k = cacheKey(...inputs);
        expect(k).toMatch(/^[0-9a-f]{32}$/);
        expect(cacheKey(...inputs)).toBe(k);
      }),
      { numRuns: 500 },
    );
  });

  it("changing any one input, even one character of the text, changes the key", () => {
    fc.assert(
      fc.property(arbInputs, arbChange, (inputs, c) => {
        const next = [...inputs] as typeof inputs;
        next[c.field] = changed(inputs[c.field], c);
        fc.pre(next[c.field] !== inputs[c.field]);
        expect(cacheKey(...next)).not.toBe(cacheKey(...inputs));
      }),
      { numRuns: 1000 },
    );
  });

  it("a line with a name or a phone is never cacheable, and no cacheable line holds the name or the phone's words", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Lang>("es", "en"),
        arbStart,
        fc.constantFrom(...lolaProfile.services.map((s) => s.id)),
        arbName,
        arbPhone,
        fc.uuid(),
        fc.integer({ min: 0, max: 40 }),
        (lang, { now, start }, service, name, phone, callId, turn) => {
          const P = phrases(lang, pack, lolaProfile, { callId, turn }, now);
          const readBack = P.readBack(service, start, name, phone);
          expect(readBack.cacheable).toBe(false);
          const phoneWords = speakPhone(phone, lang);
          const all: Said[] = [
            P.greeting(),
            P.askDayAndTime(null),
            P.timeAcceptedAskName(start),
            P.askName(),
            P.askNameAgain(),
            P.askPhone(),
            P.serviceInfo(service),
            P.booked(service, start),
            P.existingForReschedule(service, start),
            P.rescheduleReadBack(service, start),
            P.rescheduled(service, start),
            P.cancelReadBack(service, start),
            P.cancelled(),
            P.rejected("outside_hours", start, [start]),
            P.slotJustTaken(start, [start]),
            P.serviceNotOffered(name),
            P.serviceNotOffered(null),
            P.goodbye(),
            readBack,
          ];
          for (const s of all) {
            if (!s.cacheable) continue;
            const text = spokenTemplate(s.text, lang);
            expect(text).not.toContain(name);
            expect(text).not.toContain(phoneWords);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("the model's own text is never cacheable, whatever it says", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Lang>("es", "en"),
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.constantFrom("question", "outOfProfile", "other") as fc.Arbitrary<"question" | "outOfProfile" | "other">,
        fc.uuid(),
        (lang, reply, kind, callId) => {
          const turn = modelTurn({
            reply,
            language: lang,
            intent: kind === "question" ? "question" : kind === "other" ? "other" : "booking",
            outOfProfile: kind === "outOfProfile",
            service: null,
          });
          const d = decideTurn({
            state: initialCallState(lang),
            turn,
            shop: lolaProfile,
            pack,
            now: NOWS[0],
            existing: [],
            callerBookings: [],
            callId,
          });
          if (d.fromModel) expect(d.cacheable).toBe(false);
          // The model spoke in every one of these cases (no service, no flow the code owns).
          expect(d.fromModel).toBe(true);
          expect(toSpokenReply(d.reply, lang)).toBe(toSpokenReply(reply, lang));
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// N17. The cache plan and the budget. Validates 2.3, 2.4.

/** Lola, and Lola with other open days and hours: the plan must hold for any week the pack allows. */
const LOLA_DAY = [
  { open: "10:00", close: "14:00" },
  { open: "17:00", close: "20:00" },
];
const arbShop: fc.Arbitrary<ShopProfile> = fc.oneof(
  fc.constant(lolaProfile),
  fc
    .record({
      open: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }),
      day: fc.constantFrom(LOLA_DAY, [{ open: "09:00", close: "18:00" }], [{ open: "09:30", close: "13:30" }, { open: "16:00", close: "21:00" }]),
    })
    .map(({ open, day }) => ({ ...lolaProfile, hours: Object.fromEntries(open.map((d) => [d, day])) as ShopProfile["hours"] })),
);
const arbToday = fc.integer({ min: 0, max: 364 }).map((d) => Temporal.PlainDate.from("2026-01-01").add({ days: d }));

const rerender = (shop: ShopProfile, lang: Lang, l: PlanLine): Said => {
  const P = phrases(lang, pack, shop, l.inputs.seed, l.inputs.now);
  return (P[l.template] as (...a: readonly unknown[]) => Said)(...l.inputs.args);
};

describe("N17: the cache plan", () => {
  it("is deterministic, has no duplicate keys, keeps the tier order, and holds only cacheable lines that phrases() really says", () => {
    const profile = pack.voice.es;
    fc.assert(
      fc.property(arbShop, arbToday, fc.constantFrom<Lang>("es", "en"), (shop, today, lang) => {
        const plan = cachePlan(shop, pack, lang, today);
        expect(plan.length).toBeGreaterThan(0);
        const again = cachePlan(shop, pack, lang, today);
        expect(again.map((l) => [l.tier, l.text])).toEqual(plan.map((l) => [l.tier, l.text]));
        const keys = plan.map((l) => cacheKey("gemini-3.8-flash-tts", profile.voice, profile.style, profile.languageCode, l.text));
        expect(new Set(keys).size).toBe(keys.length);
        for (let i = 1; i < plan.length; i++) expect(plan[i].tier).toBeGreaterThanOrEqual(plan[i - 1].tier);
        for (const l of plan) {
          expect(l.lang).toBe(lang);
          const said = rerender(shop, lang, l);
          expect(said.cacheable).toBe(true);
          expect(spokenTemplate(said.text, lang)).toBe(l.text);
          expect(l.text).not.toMatch(/\d/);
        }
        // Tier 1 is always there: every Fixed_Phrase, starting with the greeting.
        expect(plan[0]).toMatchObject({ tier: 1, template: "greeting" });
      }),
      { numRuns: 30 },
    );
  });
});

const arbRows = fc.uniqueArray(
  fc.record({
    key: fc.stringMatching(/^[0-9a-f]{32}$/),
    sizeBytes: fc.integer({ min: 1, max: 400_000 }),
    pinned: fc.boolean(),
    lastUsedAtMs: fc.integer({ min: 0, max: 10_000 }),
  }),
  { selector: (r) => r.key, maxLength: 60 },
);

describe("N17: eviction", () => {
  it("fits the cap unless only pinned rows are left, never evicts a pinned row, evicts the least recently used, and no more than needed", () => {
    fc.assert(
      fc.property(arbRows, fc.integer({ min: 0, max: 5_000_000 }), (rows, cap) => {
        const evicted = new Set(planEviction(rows, cap));
        const kept = rows.filter((r) => !evicted.has(r.key));
        const total = kept.reduce((n, r) => n + r.sizeBytes, 0);
        const keptUnpinned = kept.filter((r) => !r.pinned);
        if (total > cap) expect(keptUnpinned).toEqual([]);
        for (const r of rows) if (r.pinned) expect(evicted.has(r.key)).toBe(false);
        const gone = rows.filter((r) => evicted.has(r.key));
        for (const g of gone) for (const k of keptUnpinned) expect(g.lastUsedAtMs).toBeLessThanOrEqual(k.lastUsedAtMs);
        // No more than needed: without the last row evicted, the total would still be over the cap.
        if (gone.length > 0) {
          const order = planEviction(rows, cap);
          const last = rows.find((r) => r.key === order[order.length - 1])!;
          expect(total + last.sizeBytes).toBeGreaterThan(cap);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

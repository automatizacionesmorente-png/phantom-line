import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { evaluateBooking, type Weekday } from "@/lib/booking";
import { toShopRules, type ShopProfile } from "@/lib/conversation/shopProfile";
import { parsePrice, speakDuration } from "@/lib/receptionist/spoken";
import { splitSentences } from "@/lib/receptionist/speech";
import { getSectorPack, type Lang } from "@/lib/sectors";
import { brainCall } from "./brainCall";
import { arbShop, arbUtterance, MARKERS } from "./brain/arbShops";

/**
 * B6. The Code_Brain never invents (front-desk-brain 9.2, 8.2). For random shops (catalogs drawn
 * from the Rich_Profile's services with random durations, prices and "from" flags; random hours;
 * random FAQ_Entries) and brain-only conversations of 1–10 utterances:
 *  - every price phrase in a reply is a profile price or a Service_Combo's sum, after "desde" /
 *    "from" exactly when some part with that total is priced "from";
 *  - every duration word ("minutos", "hora", "hours"…) sits inside the spoken form of a profile
 *    duration or a sum;
 *  - every instant in `lastOffer` and in a pending read-back is accepted by `evaluateBooking` with
 *    that Turn's context;
 *  - every sentence that holds an FAQ marker word (each generated answer carries words found
 *    nowhere else) is exactly an FAQ answer of that shop, so no answer is invented or borrowed.
 * FAQ answers are the shop's own text, so the price and duration checks skip their sentences.
 *
 * The shop and utterance generators moved unchanged to `./brain/arbShops.ts` in task 9, so B1, B2
 * and B11 draw from the same shops.
 */
const pack = getSectorPack("hair-salon");

const arbCase = arbShop.chain((shop) =>
  fc.record({
    shop: fc.constant(shop),
    now: fc.integer({ min: 0, max: 60 * 24 * 40 }).map((m) => Temporal.Instant.from("2026-03-20T07:00:00Z").add({ minutes: m * 5 })),
    lines: fc.array(arbUtterance(shop), { minLength: 1, maxLength: 10 }),
  }),
);

/** Every total of 1–3 different parts, with whether some part of a set with that total is "from" or not. */
function totals(shop: ShopProfile) {
  const prices = new Map<number, { from: boolean; plain: boolean }>();
  const minutes = new Set<number>();
  const s = shop.services;
  const add = (parts: typeof s) => {
    const cents = parts.reduce((n, p) => n + p.priceCents, 0);
    const from = parts.some((p) => p.priceFrom === true);
    const row = prices.get(cents) ?? { from: false, plain: false };
    prices.set(cents, { from: row.from || from, plain: row.plain || !from });
    minutes.add(parts.reduce((n, p) => n + p.durationMin, 0));
  };
  for (let a = 0; a < s.length; a++) {
    add([s[a]]);
    for (let b = a + 1; b < s.length; b++) {
      add([s[a], s[b]]);
      for (let c = b + 1; c < s.length; c++) add([s[a], s[b], s[c]]);
    }
  }
  return { prices, minutes };
}

const clean = (w: string) => w.toLowerCase().replace(/[.,;:!?¿¡«»"()]/g, "");

/** Each price phrase of a sentence: its value in cents and whether "desde" / "from" comes before it. */
function pricePhrases(sentence: string, lang: Lang): { cents: number | null; from: boolean; text: string }[] {
  const ws = sentence.split(/\s+/).map(clean).filter(Boolean);
  const out: { cents: number | null; from: boolean; text: string }[] = [];
  ws.forEach((w, i) => {
    if (w !== "euro" && w !== "euros") return;
    let best: { cents: number; start: number } | null = null;
    for (let start = Math.max(0, i - 8); start < i; start++) {
      if (["y", "and"].includes(ws[start])) continue;
      for (let end = Math.min(ws.length, i + 5); end > i; end--) {
        const cents = parsePrice(ws.slice(start, end).join(" "), lang);
        if (cents !== null) {
          best = { cents, start };
          break;
        }
      }
      if (best) break;
    }
    const before = best ? ws[best.start - 1] : undefined;
    out.push({ cents: best?.cents ?? null, from: before === "desde" || before === "from", text: ws.slice(Math.max(0, i - 8), i + 1).join(" ") });
  });
  return out;
}

const UNIT = { es: /\b(minutos?|horas?)\b/g, en: /\b(minutes?|hours?)\b/g } as const;

describe("B6: the Code_Brain never invents", () => {
  it("prices, durations, slots and answers in brain-only replies all come from the profile or the Booking_Rules", { timeout: 300_000 }, () => {
    const reached = { prices: 0, fromPrices: 0, durations: 0, offers: 0, readBacks: 0, faq: 0 };
    fc.assert(
      fc.property(arbCase, ({ shop, now, lines }) => {
        const { prices, minutes } = totals(shop);
        const faqAnswers = new Set((shop.faq ?? []).flatMap((f) => [f.answer.es, f.answer.en]));
        const durationPhrases = (lang: Lang) => [...minutes].map((m) => speakDuration(m, lang).toLowerCase());
        const rules = toShopRules(shop);

        for (const t of brainCall(lines, { shop, now })) {
          const d = t.decision;
          const lang = d.state.language;
          for (const sentence of splitSentences(d.reply)) {
            const s = sentence.trim();
            if (faqAnswers.has(s)) {
              reached.faq++;
              continue;
            }
            // No FAQ marker outside the shop's own answer sentences.
            for (const m of MARKERS) expect(s.toLowerCase(), `marker in "${s}"`).not.toContain(m);
            for (const p of pricePhrases(s, lang)) {
              expect(p.cents, `unparsed price in "${s}"`).not.toBeNull();
              const row = prices.get(p.cents!);
              expect(row, `price ${p.cents} in "${s}"`).toBeDefined();
              expect(p.from ? row!.from : row!.plain, `"desde" in "${s}"`).toBe(true);
              reached.prices++;
              if (p.from) reached.fromPrices++;
            }
            const lower = s.toLowerCase();
            const allowed = durationPhrases(lang);
            for (const unit of lower.matchAll(UNIT[lang])) {
              const at = unit.index!;
              // "¿a qué hora?" asks a time; it states no duration.
              if (/qu[eé] $/.test(lower.slice(0, at))) continue;
              // "Esa hora ya ha pasado": "hora" there is the time of day, not a length.
              if (/\b(esa|esta|la|misma) $/.test(lower.slice(0, at))) continue;
              const covered = allowed.some((phrase) => {
                for (let from = lower.indexOf(phrase); from >= 0; from = lower.indexOf(phrase, from + 1)) {
                  if (from <= at && at < from + phrase.length) return true;
                }
                return false;
              });
              expect(covered, `duration in "${s}"`).toBe(true);
              reached.durations++;
            }
          }

          // Every slot offered or read back is one the Booking_Rules accept with this Turn's bookings.
          const ctx = { now, shop: rules, pack: { slotStepMin: pack.slotStepMin, rules: pack.rules }, existing: t.existing };
          const serviceId = d.state.fields.serviceId;
          if (d.state.lastOffer && serviceId && !d.complete) {
            for (const iso of d.state.lastOffer) {
              expect(evaluateBooking({ serviceId, start: Temporal.Instant.from(iso) }, ctx).ok, `offer ${iso} for ${serviceId}`).toBe(true);
              reached.offers++;
            }
          }
          const pending = d.state.pending;
          if (d.state.stage === "awaiting_confirmation" && pending?.kind === "book") {
            expect(evaluateBooking({ serviceId: pending.serviceId, start: Temporal.Instant.from(pending.start) }, ctx).ok).toBe(true);
            reached.readBacks++;
          }
        }
      }),
      // 1000 runs, not 100: the read-back branch is rare, and with 100 one run in six never reached it.
      { numRuns: 1000 },
    );
    for (const [k, n] of Object.entries(reached)) expect(n, k).toBeGreaterThan(0);
  });

  it("the shop generator gives valid profiles with 'from' prices, several days and FAQ_Entries", () => {
    const sample = fc.sample(arbShop, { numRuns: 50, seed: 42 });
    expect(sample.some((s) => s.services.some((x) => x.priceFrom))).toBe(true);
    expect(sample.some((s) => (s.faq?.length ?? 0) > 0)).toBe(true);
    expect(sample.some((s) => Object.keys(s.hours).length >= 3)).toBe(true);
    for (const s of sample) for (const d of Object.keys(s.hours)) expect(Number(d) as Weekday).toBeGreaterThanOrEqual(1);
  });
});

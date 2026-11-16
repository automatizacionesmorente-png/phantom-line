import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { evaluateBooking, localDateOf } from "@/lib/booking";
import { toShopRules, type ShopProfile } from "@/lib/conversation/shopProfile";
import { SAMPLE_KEYS, type SampleKey } from "@/lib/owner/api";
import { DEMO_MIN_TAPE, demoSamples, samplesToRestore } from "@/lib/owner/demo";
import { getSectorPack } from "@/lib/sectors";
import { arbNow, DST_DATES } from "../booking/arbitraries";
import { lolaProfile } from "../fixtures/lola";
import { NUM_RUNS } from "../messages/arbitraries";

const pack = getSectorPack("hair-salon");
const TZ = lolaProfile.timeZone;
const PHONES = new Set(["+34000000001", "+34000000002", "+34000000003"]);
const EXAMPLE = { es: " (ejemplo)", en: " (example)" } as const;

/**
 * The Demo_Shop's V1_Profile, as it is and with English first (a future English demo). The
 * seed is now the Rich_Profile (front-desk-brain 16.2); its samples are checked in
 * tests/conversation/richProfile.test.ts.
 */
const arbShop: fc.Arbitrary<ShopProfile> = fc.constantFrom<ShopProfile>(lolaProfile, {
  ...lolaProfile,
  languages: ["en", "es"],
});

/** Any minute of the four days of both 2026 Madrid DST weekends. */
const arbDstNow: fc.Arbitrary<Temporal.Instant> = fc
  .record({ day: fc.constantFrom(...DST_DATES), minute: fc.integer({ min: 0, max: 24 * 60 - 1 }) })
  .map(({ day, minute }) =>
    Temporal.PlainDate.from(day).toZonedDateTime({ timeZone: TZ }).toInstant().add({ minutes: minute }),
  );

const arbCase = fc.record({
  // Extra weight below 3, so "every sample already on the Tape" (1 subset in 8) is reached.
  newCount: fc.oneof(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 10 })),
  active: fc.subarray([...SAMPLE_KEYS]),
  now: fc.oneof(arbNow, arbDstNow),
  shop: arbShop,
});

describe("M20. Samples restore the Tape and never repeat (16.4, 16.5)", () => {
  it("restores exactly the missing samples below 3, each urgent, bookable and marked", () => {
    const seen = { full: 0, restoring: 0, nothingMissing: 0, march: 0, october: 0 };

    fc.assert(
      fc.property(arbCase, ({ newCount, active, now, shop }) => {
        const keys = samplesToRestore({ newCount, activeSampleKeys: active });

        // No keys when the Tape has 3 or more; otherwise exactly the keys not active.
        if (newCount >= DEMO_MIN_TAPE) {
          seen.full++;
          expect(keys).toEqual([]);
        } else {
          seen.restoring++;
          if (keys.length === 0) seen.nothingMissing++;
          expect([...keys].sort()).toEqual(SAMPLE_KEYS.filter((k) => !active.includes(k)).sort());
          // After inserting, every sample is active exactly once.
          const after: SampleKey[] = [...active, ...keys];
          expect([...after].sort()).toEqual([...SAMPLE_KEYS].sort());
        }

        const local = localDateOf(now, TZ).toString();
        if (local === "2026-03-28" || local === "2026-03-29") seen.march++;
        if (local === "2026-10-24" || local === "2026-10-25") seen.october++;

        // The samples themselves, for every key (what a fresh, empty Tape would get).
        let n = 0;
        const all = demoSamples(SAMPLE_KEYS, { now, shop, pack, newId: () => `id-${n++}` });
        const restored = demoSamples(keys, { now, shop, pack, newId: () => `r-${n++}` });
        expect(restored.map((s) => s.key)).toEqual(SAMPLE_KEYS.filter((k) => keys.includes(k)));
        expect(all.map((s) => s.key)).toEqual([...SAMPLE_KEYS]);

        const lang = shop.languages[0];
        const today = localDateOf(now, shop.timeZone);
        for (const s of all) {
          expect(s.call.language).toBe(lang);
          expect(s.message.callerName?.endsWith(EXAMPLE[lang])).toBe(true);
          expect(PHONES.has(s.message.callerPhone ?? "")).toBe(true);
          expect(s.call.startedAt.toString()).toBe(now.toString());

          if (s.key === "urgent") {
            expect(s.message.urgency).toBe("urgent");
            expect(s.message.urgencyBasis.rule).toBe("urgent_term");
          }
          if (s.key === "booking") {
            const slot = s.agreedSlot;
            expect(slot).toBeDefined();
            if (!slot) return;
            // A day after today in the Shop's zone ...
            expect(Temporal.PlainDate.compare(localDateOf(slot.start, shop.timeZone), today)).toBe(1);
            // ... that the Booking_Rules accept against an empty agenda, on the slot it names.
            const e = evaluateBooking(
              { serviceId: slot.serviceId, start: slot.start },
              {
                now,
                shop: toShopRules(shop),
                pack: { slotStepMin: pack.slotStepMin, rules: pack.rules },
                existing: [],
              },
            );
            expect(e.ok).toBe(true);
            if (e.ok) expect(e.resourceId).toBe(slot.resourceId);
            expect(s.message.urgency).toBe("normal");
          }
          if (s.key === "question") expect(s.message.urgency).toBe("low");
        }
      }),
      { numRuns: NUM_RUNS },
    );

    // Every branch was reached, and both DST weekends were hit (15.6).
    expect(seen.full).toBeGreaterThan(0);
    expect(seen.restoring).toBeGreaterThan(0);
    expect(seen.nothingMissing).toBeGreaterThan(0);
    expect(seen.march).toBeGreaterThan(0);
    expect(seen.october).toBeGreaterThan(0);
  });
});

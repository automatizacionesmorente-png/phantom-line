import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import {
  checkTtsLimits,
  exhaustedNow,
  modelsToTry,
  nextQuotaReset,
  pickTtsModel,
  TTS_QUOTA_TIME_ZONE,
} from "@/lib/conversation/ttsLimits";

/**
 * N13. TTS limits. For all counts and configs, `checkTtsLimits` blocks exactly when a visitor,
 * hourly or daily count is over its cap, and model selection never returns a model marked
 * exhausted. Validates 5.5, 4.4.
 */

const cap = fc.integer({ min: 1, max: 1000 });
const count = fc.integer({ min: 0, max: 1200 });
const config = fc.record({ perVisitorPerMinute: cap, globalPerHour: cap, globalPerDay: cap });
const counts = fc.record({ visitor: count, hour: count, day: count });
const modelId = fc.stringMatching(/^[a-z0-9.-]{1,24}$/);
const models = fc.uniqueArray(modelId, { minLength: 0, maxLength: 6 });
/** Any instant in 2026, including both US daylight-saving days. */
const instant = fc
  .oneof(
    fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 0, 1) }),
    fc.integer({ min: Date.UTC(2026, 2, 8), max: Date.UTC(2026, 2, 9, 12) }),
    fc.integer({ min: Date.UTC(2026, 10, 1), max: Date.UTC(2026, 10, 2, 12) }),
  )
  .map((ms) => Temporal.Instant.fromEpochMilliseconds(ms));

describe("N13: TTS limits", () => {
  it("blocks exactly when a count is over its cap, naming the first cap that is over", () => {
    fc.assert(
      fc.property(counts, config, (c, cfg) => {
        const over = c.visitor > cfg.perVisitorPerMinute || c.hour > cfg.globalPerHour || c.day > cfg.globalPerDay;
        const d = checkTtsLimits(c, cfg);
        expect(d.blocked).toBe(over);
        if (d.blocked) {
          const expected = c.visitor > cfg.perVisitorPerMinute ? "visitor" : c.hour > cfg.globalPerHour ? "hour" : "day";
          expect(d.limit).toBe(expected);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("model selection never returns an exhausted model, and keeps the configured order", () => {
    fc.assert(
      fc.property(
        models.chain((ms) => fc.tuple(fc.constant(ms), fc.subarray(ms), fc.array(modelId, { maxLength: 3 }))),
        ([ms, marked, strangers]) => {
          const exhausted = new Set([...marked, ...strangers]);
          const order = modelsToTry(ms, exhausted);
          for (const m of order) expect(exhausted.has(m)).toBe(false);
          expect(order).toEqual(ms.filter((m) => !exhausted.has(m)));
          const pick = pickTtsModel(ms, exhausted);
          if (pick === null) expect(ms.every((m) => exhausted.has(m))).toBe(true);
          else {
            expect(exhausted.has(pick)).toBe(false);
            expect(pick).toBe(order[0]);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("a 429 mark lasts until the next midnight Pacific, and no longer", () => {
    fc.assert(
      fc.property(instant, modelId, fc.integer({ min: 0, max: 26 * 3_600_000 }), (now, model, later) => {
        const until = nextQuotaReset(now);
        const z = until.toZonedDateTimeISO(TTS_QUOTA_TIME_ZONE);
        // A local midnight, strictly after now, at most 25 hours away (the longest day of the year).
        expect([z.hour, z.minute, z.second, z.millisecond]).toEqual([0, 0, 0, 0]);
        expect(Temporal.Instant.compare(until, now)).toBe(1);
        expect(until.since(now).total("hours")).toBeLessThanOrEqual(25);
        // And it is the first midnight after now: the Pacific date is the next day.
        const today = now.toZonedDateTimeISO(TTS_QUOTA_TIME_ZONE).toPlainDate();
        expect(z.toPlainDate().equals(today.add({ days: 1 }))).toBe(true);

        const memory = new Map([[model, until.epochMilliseconds]]);
        const t = now.add({ milliseconds: later });
        const marked = exhaustedNow(memory, [], t).has(model);
        expect(marked).toBe(Temporal.Instant.compare(t, until) < 0);
        // Selection over the merged set never returns the marked model before the reset.
        if (marked) expect(pickTtsModel([model], exhaustedNow(memory, [], t))).toBeNull();
      }),
      { numRuns: 500 },
    );
  });
});

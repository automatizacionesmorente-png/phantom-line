import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkBooking, comboId, resolveService, type RuleContext, type SectorRule, type Service, type ShopRules } from "@/lib/booking";
import { NUM_RUNS, arbCase, arbExisting, arbNow, arbRequest, arbShop, arbValidRequest, comboIdsOf, ctxOf } from "./arbitraries";

// Temporal objects have no own enumerable fields, so compare their JSON (toJSON = ISO string).
const json = (v: unknown) => JSON.stringify(v);

/**
 * A sector rule that exists only in this test. The registry's packs have no rule that
 * looks at the service (`hairSalon.rules` is empty), so step 6 of the Booking_Rules would
 * never see a Service_Combo. This one rejects any service longer than `limit` minutes,
 * which a Service_Combo must hit exactly as one service of the summed duration does.
 */
const tooLong =
  (limit: number): SectorRule =>
  ({ service }) =>
    service.durationMin > limit ? { ok: false, reason: "too_long" } : { ok: true };

/** 1–3 different catalog indexes, in any order. */
const arbIdx = (n: number) =>
  fc.uniqueArray(fc.nat({ max: n - 1 }), { minLength: 1, maxLength: Math.min(3, n) });

const arbEquivalence = arbShop.chain((sc) =>
  arbNow.chain((now) =>
    fc
      .record({
        existing: arbExisting(sc, now),
        idx: arbIdx(sc.shop.services.length),
        start: fc.oneof(
          arbRequest(sc, now).map((r) => r.start),
          arbValidRequest(sc, now).map((r) => r.start),
        ),
        ruleLimit: fc.option(fc.integer({ min: 20, max: 300 }), { nil: undefined }),
      })
      .map((g) => ({ ...sc, now, ...g })),
  ),
);

type InvalidKind = "unknown" | "repeated" | "four" | "over480" | "order";
const KINDS: readonly InvalidKind[] = ["unknown", "repeated", "four", "over480", "order"];

/**
 * An invalid Combo_Id on a catalog of 4–6 services of 1–120 minutes (so any 4 parts sum
 * to at most 480, and "4 parts" is the only thing wrong with them). Each kind breaks one
 * rule of Requirement 7.3 and keeps the others.
 */
const arbInvalid = arbShop.chain((sc) =>
  arbNow.chain((now) =>
    fc
      .record({
        kind: fc.constantFrom(...KINDS),
        durations: fc.array(fc.integer({ min: 1, max: 120 }), { minLength: 4, maxLength: 6 }),
        pickSeed: fc.array(fc.nat(), { minLength: 4, maxLength: 4 }),
        size: fc.integer({ min: 2, max: 3 }),
        at: fc.nat(),
        extra: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 50 })),
        existing: arbExisting(sc, now),
        start: arbRequest(sc, now).map((r) => r.start),
      })
      .map((g) => {
        const n = g.durations.length;
        // `size` different indexes in catalog order, drawn from the seeds.
        const sortedPick = (size: number) => {
          const left = Array.from({ length: n }, (_, k) => k);
          const out: number[] = [];
          for (let k = 0; k < size; k++) out.push(left.splice(g.pickSeed[k] % left.length, 1)[0]);
          return out.sort((a, b) => a - b);
        };
        const durations = [...g.durations];
        let parts: string[];
        switch (g.kind) {
          case "unknown": {
            parts = sortedPick(g.size - 1).map((k) => `c${k}`);
            parts.splice(g.at % (parts.length + 1), 0, "not-offered");
            break;
          }
          case "repeated": {
            const pick = sortedPick(g.size - 1);
            const k = pick[g.at % pick.length];
            pick.splice(pick.indexOf(k), 0, k); // "a+a" or "a+a+b" / "a+b+b": still in order
            parts = pick.map((x) => `c${x}`);
            break;
          }
          case "four":
            parts = sortedPick(4).map((k) => `c${k}`);
            break;
          case "over480": {
            const pick = sortedPick(g.size);
            const others = pick.slice(0, -1).reduce((sum, k) => sum + durations[k], 0);
            durations[pick[pick.length - 1]] = 481 - others + g.extra; // 481 … 531 in total
            parts = pick.map((k) => `c${k}`);
            break;
          }
          case "order": {
            parts = sortedPick(g.size).reverse().map((k) => `c${k}`);
            break;
          }
        }
        const shop: ShopRules = { ...sc.shop, services: durations.map((durationMin, k) => ({ id: `c${k}`, durationMin })) };
        return { ...sc, shop, now, existing: g.existing, kind: g.kind, id: parts.join("+"), start: g.start };
      }),
  ),
);

// B5. A Service_Combo is one service of the summed duration. Validates 7.2, 7.3.
describe("B5: a Service_Combo is one service of the summed duration", () => {
  it("checkBooking on a Combo_Id deep-equals checkBooking on one service of the summed duration", { timeout: 300_000 }, () => {
    const seen = { two: 0, three: 0, accepted: 0, rejected: 0, sector: 0, alternatives: 0, over480: 0 };
    fc.assert(
      fc.property(arbEquivalence, (g) => {
        const ids = g.idx.map((k) => g.shop.services[k].id);
        const sum = g.idx.reduce((s, k) => s + g.shop.services[k].durationMin, 0);
        const pack: RuleContext["pack"] = {
          slotStepMin: g.pack.slotStepMin,
          rules: g.ruleLimit === undefined ? g.pack.rules : [...g.pack.rules, tooLong(g.ruleLimit)],
        };
        const id = comboId(ids, g.shop.services);
        if (ids.length > 1 && sum > 480) {
          // Over the limit: no Combo_Id at all, and the catalog-order id is unknown_service.
          seen.over480++;
          expect(id).toBeNull();
          const canonical = [...g.idx].sort((a, b) => a - b).map((k) => g.shop.services[k].id).join("+");
          expect(checkBooking({ serviceId: canonical, start: g.start }, ctxOf({ ...g, pack }))).toEqual({
            ok: false,
            reason: "unknown_service",
            alternatives: [],
          });
          return;
        }
        expect(id).not.toBeNull();
        // Any order of the same ids gives the same, catalog-order Combo_Id.
        expect(id).toBe([...g.idx].sort((a, b) => a - b).map((k) => g.shop.services[k].id).join("+"));
        if (ids.length === 2) seen.two++;
        if (ids.length === 3) seen.three++;

        let x = "x";
        while (g.shop.services.some((s) => s.id === x)) x += "x";
        const services: Service[] = [...g.shop.services, { id: x, durationMin: sum }];
        const withX: ShopRules = { ...g.shop, services };

        const combo = checkBooking({ serviceId: id!, start: g.start }, ctxOf({ ...g, pack }));
        const single = checkBooking({ serviceId: x, start: g.start }, ctxOf({ ...g, shop: withX, pack }));
        expect(json(combo)).toBe(json(single));
        expect(resolveService(id!, g.shop.services)?.durationMin).toBe(sum);
        if (combo.ok) {
          seen.accepted++;
          expect(combo.end.epochMilliseconds - combo.start.epochMilliseconds).toBe(sum * 60_000);
        } else {
          seen.rejected++;
          if (combo.reason === "sector:too_long") seen.sector++;
          if (combo.alternatives.length > 0) seen.alternatives++;
        }
      }),
      { numRuns: NUM_RUNS },
    );
    // Every branch was reached, so the property cannot pass without testing anything.
    expect(seen.two).toBeGreaterThan(0);
    expect(seen.three).toBeGreaterThan(0);
    expect(seen.accepted).toBeGreaterThan(0);
    expect(seen.rejected).toBeGreaterThan(0);
    expect(seen.sector).toBeGreaterThan(0);
    expect(seen.alternatives).toBeGreaterThan(0);
  });

  it("every invalid Combo_Id is unknown_service with no alternatives", { timeout: 300_000 }, () => {
    const seen = new Map<InvalidKind, number>(KINDS.map((k) => [k, 0]));
    let exactly481 = 0;
    fc.assert(
      fc.property(arbInvalid, (g) => {
        seen.set(g.kind, seen.get(g.kind)! + 1);
        if (g.kind === "over480") {
          const total = g.id.split("+").reduce((s, p) => s + g.shop.services.find((c) => c.id === p)!.durationMin, 0);
          expect(total).toBeGreaterThan(480);
          if (total === 481) exactly481++;
        }
        expect(resolveService(g.id, g.shop.services)).toBeNull();
        expect(checkBooking({ serviceId: g.id, start: g.start }, ctxOf(g))).toEqual({
          ok: false,
          reason: "unknown_service",
          alternatives: [],
        });
      }),
      { numRuns: NUM_RUNS },
    );
    for (const k of KINDS) expect(seen.get(k), k).toBeGreaterThan(0);
    expect(exactly481).toBeGreaterThan(0);
  });

  it("the P1–P9 generators draw valid Combo_Ids as request service ids (task 2.4)", () => {
    // Every generated combo is one the code accepts as a Combo_Id.
    for (const sc of fc.sample(arbShop, NUM_RUNS)) {
      for (const id of comboIdsOf(sc.shop)) expect(resolveService(id, sc.shop.services)?.id).toBe(id);
    }
    // And the shared request generator really uses them (about 1 in 3 when a combo exists).
    const reqs = fc.sample(arbCase, NUM_RUNS).map((c) => c.req.serviceId);
    const combos = reqs.filter((id) => id.includes("+")).length;
    expect(combos).toBeGreaterThanOrEqual(NUM_RUNS / 10);
    expect(combos).toBeLessThan(NUM_RUNS);
  });
});

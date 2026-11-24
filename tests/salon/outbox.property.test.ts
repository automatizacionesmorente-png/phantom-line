import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { OPT_OUT, outboxBody } from "@/lib/salon/outboxCopy";
import { planOutbox, type OutboxBooking, type OutboxClient, type PlanInput } from "@/lib/salon/outbox";
import { PROMO_KINDS, isReviewUrl, type OutboxKind } from "@/lib/salon/settings";

/** Tuesday 10 November 2026, 09:00 in Madrid. */
const NOW = Temporal.Instant.from("2026-11-10T08:00:00Z");
const TZ = "Europe/Madrid";
const E164 = /^\+[0-9]{6,15}$/;
const HOUR = 3_600_000;
const at = (hours: number) => Temporal.Instant.fromEpochMilliseconds(NOW.epochMilliseconds + Math.round(hours * HOUR));

const phone = fc.oneof(fc.stringMatching(/^\+[0-9]{6,15}$/), fc.constantFrom("", "612345678", "+12", "abc"));
const name = fc.oneof(fc.stringMatching(/^[A-Za-zñÁé]{1,12}( [A-Za-z]{1,12}){0,3}$/), fc.string({ maxLength: 400 }));
const lang = fc.constantFrom("es" as const, "en" as const);

const arbBooking = fc.record({
  id: fc.uuid(),
  clientId: fc.option(fc.uuid(), { nil: null }),
  name,
  phone,
  language: lang,
  start: fc.integer({ min: -100, max: 200 }).map(at),
  status: fc.constantFrom("confirmed" as const, "cancelled" as const),
  cancelledAt: fc.option(fc.integer({ min: -40, max: 2 }).map(at), { nil: null }),
  paidAt: fc.option(fc.integer({ min: -80, max: 2 }).map(at), { nil: null }),
}) satisfies fc.Arbitrary<OutboxBooking>;

const arbClient = fc.record({
  id: fc.uuid(),
  name,
  phone,
  language: lang,
  birthday: fc.option(fc.constantFrom("11-10", "11-11", "02-29", "02-28", "12-31"), { nil: null }),
  promoConsentAt: fc.option(fc.constant(at(-1000)), { nil: null }),
  summary: fc.record({
    lastVisit: fc.option(fc.integer({ min: -3000, max: -1 }).map(at), { nil: null }),
    upcoming: fc.option(fc.integer({ min: 1, max: 500 }).map(at), { nil: null }),
    intervalDays: fc.option(fc.integer({ min: 1, max: 90 }), { nil: null }),
    totalVisits: fc.integer({ min: 0, max: 30 }),
  }),
}) satisfies fc.Arbitrary<OutboxClient>;

const arbInput = fc.record({
  shopName: fc.string({ minLength: 1, maxLength: 200 }),
  on: fc.record({ reminder: fc.boolean(), review: fc.boolean(), gap: fc.boolean(), winback: fc.boolean(), birthday: fc.boolean() }),
  url: fc.constantFrom("https://g.page/r/abc/review", "https://search.google.com/local/writereview?placeid=x", null),
  bookings: fc.array(arbBooking, { maxLength: 30 }),
  cancellations: fc.array(arbBooking, { maxLength: 30 }),
  clients: fc.array(arbClient, { maxLength: 30 }),
});
type Gen = typeof arbInput extends fc.Arbitrary<infer T> ? T : never;
const planOf = (g: Gen, existingKeys: ReadonlySet<string> = new Set()): PlanInput => ({
  now: NOW,
  tz: TZ,
  shop: { name: g.shopName },
  settings: { automations: g.on, googleReviewUrl: g.url },
  bookings: g.bookings,
  cancellations: g.cancellations,
  clients: g.clients,
  existingKeys,
});

describe("planOutbox", () => {
  it("every draft has an E.164 phone and a body ≤700 chars ending with the opt-out line when promotional", () => {
    fc.assert(
      fc.property(arbInput, (g) => {
        const drafts = planOf(g);
        const plan = planOutbox(drafts);
        expect(plan.length).toBeLessThanOrEqual(200);
        const consenting = new Map(g.clients.map((c) => [c.id, c.promoConsentAt !== null]));
        for (const d of plan) {
          expect(d.phone).toMatch(E164);
          expect(d.body.length).toBeGreaterThan(0);
          expect(d.body.length).toBeLessThanOrEqual(700);
          if (PROMO_KINDS.includes(d.kind)) {
            expect(d.body.endsWith(OPT_OUT[d.language])).toBe(true);
            expect(consenting.get(d.clientId ?? "")).toBe(true);
          }
          if (d.kind === "review") expect(g.url && d.body.includes(g.url)).toBeTruthy();
          expect(g.on[d.kind]).toBe(true);
        }
        // Idempotent and deterministic: the same input gives the same drafts, and with their keys known, nothing.
        expect(planOutbox(planOf(g))).toEqual(plan);
        expect(planOutbox(planOf(g, new Set(plan.map((d) => d.dedupeKey))))).toEqual([]);
        expect(new Set(plan.map((d) => d.dedupeKey)).size).toBe(plan.length);
      }),
      { numRuns: 300 },
    );
  });

  it("a slot is offered to at most 3 clients per cancellation, across runs", () => {
    fc.assert(
      fc.property(arbInput, (g) => {
        const gap = { ...g, on: { reminder: false, review: false, gap: true, winback: false, birthday: false } };
        const first = planOutbox(planOf(gap));
        const keys = new Set(first.map((d) => d.dedupeKey));
        const second = planOutbox(planOf(gap, keys));
        const perBooking = new Map<string, number>();
        for (const d of [...first, ...second]) perBooking.set(d.bookingId!, (perBooking.get(d.bookingId!) ?? 0) + 1);
        for (const n of perBooking.values()) expect(n).toBeLessThanOrEqual(3);
      }),
      { numRuns: 200 },
    );
  });

  it("copy bodies are bounded for the longest inputs", () => {
    const kinds: OutboxKind[] = ["reminder", "review", "gap", "winback", "birthday"];
    const url = "https://g.page/" + "a".repeat(285);
    expect(isReviewUrl(url)).toBe(true);
    for (const kind of kinds) {
      for (const l of ["es", "en"] as const) {
        const body = outboxBody({ kind, lang: l, shopName: "S".repeat(500), name: "N".repeat(500), tz: TZ, start: NOW.add({ hours: 30 }), url });
        expect(body.length).toBeLessThanOrEqual(700);
      }
    }
  });
});

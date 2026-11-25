import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { localDateOf, overlaps, sessionsOn } from "@/lib/booking";
import { toShopRules } from "@/lib/conversation/shopProfile";
import { buildCuratedSet, type CuratedSet } from "@/lib/demo/curated";
import { priceOf } from "@/lib/demo/month";
import { lolaSeedProfile } from "@/lib/db/seed";
import { bookingState } from "@/lib/salon/state";
import { monthOf } from "@/lib/salon/month";
import { isReviewUrl } from "@/lib/salon/settings";

const tz = lolaSeedProfile.timeZone;
const rules = toShopRules(lolaSeedProfile);
const cmp = Temporal.Instant.compare;
const build = (now: Temporal.Instant): CuratedSet => buildCuratedSet({ now, shop: lolaSeedProfile, newId: () => randomUUID() });

const FIXED = [
  "2026-12-21T11:00:00Z",
  "2026-12-01T00:30:00Z",
  "2026-10-26T09:00:00Z", // the day after the DST change
  "2027-03-29T09:00:00Z",
  "2026-12-27T22:30:00Z",
].map((s) => Temporal.Instant.from(s));

/** Every check that must hold at any `now`. */
function check(now: Temporal.Instant) {
  const set = build(now);
  const { salon } = set;
  const all = [
    ...set.bookings.map((b) => ({ ...b, status: "confirmed" as const })),
    ...set.history.map((b) => ({ ...b, status: "confirmed" as const })),
    ...salon.month,
  ];
  const ids = new Set(all.map((b) => b.id));
  expect(ids.size).toBe(all.length);

  // No overlap between active bookings of a chair, nor with a block; all inside opening hours.
  const active = all.filter((b) => b.status === "confirmed");
  for (const chair of ["chair-1", "chair-2"]) {
    const own = active.filter((b) => b.resourceId === chair).sort((a, b) => cmp(a.startsAt, b.startsAt));
    for (let i = 1; i < own.length; i++) expect(cmp(own[i].startsAt, own[i - 1].endsAt)).toBeGreaterThanOrEqual(0);
    for (const blk of salon.blocks.filter((x) => x.resourceId === null || x.resourceId === chair)) {
      for (const b of own) expect(overlaps({ start: b.startsAt, end: b.endsAt }, { start: blk.startsAt, end: blk.endsAt })).toBe(false);
    }
  }
  for (const b of salon.month) {
    const date = localDateOf(b.startsAt, tz);
    expect(sessionsOn(date, rules).some((s) => cmp(b.startsAt, s.open) >= 0 && cmp(b.endsAt, s.close) <= 0)).toBe(true);
    expect(b.priceCents).toBe(priceOf(lolaSeedProfile, b.serviceId));
    expect(Number.isInteger(b.priceCents)).toBe(true);
  }
  for (const b of set.bookings) expect(b.priceCents).toBe(priceOf(lolaSeedProfile, b.serviceId));
  expect(salon.blocks.length).toBe(2);

  // Payments: only past, ended, not no-show or cancelled bookings; at most one per booking.
  const byId = new Map(all.map((b) => [b.id, b]));
  const seen = new Set<string>();
  for (const p of salon.payments) {
    expect(cmp(p.paidAt, now)).toBeLessThanOrEqual(0);
    expect(p.productCents).toBeLessThanOrEqual(p.amountCents);
    if (p.bookingId === null) {
      expect(p.amountCents).toBe(p.productCents);
      continue;
    }
    expect(seen.has(p.bookingId)).toBe(false);
    seen.add(p.bookingId);
    const b = byId.get(p.bookingId)!;
    expect(b, "payment of a known booking").toBeDefined();
    expect(b.status).toBe("confirmed");
    expect("noShow" in b && b.noShow).toBe(false);
    expect(cmp(b.endsAt, p.paidAt)).toBeLessThanOrEqual(0);
    expect(p.amountCents - p.productCents).toBe(b.priceCents);
  }

  // State per spec 9.1 over the past month: paid = done, no-show, cancelled, the rest to collect.
  const counts = { done: 0, no_show: 0, to_collect: 0, cancelled: 0 };
  for (const b of salon.month) {
    if (cmp(b.endsAt, now) > 0) continue;
    const st = bookingState({
      status: b.status,
      ownerConfirmedAt: b.ownerConfirmed ? b.createdAt : null,
      channel: b.channel,
      noShowAt: b.noShow ? b.endsAt : null,
      paid: seen.has(b.id),
      start: b.startsAt,
      end: b.endsAt,
      now,
    });
    expect(["done", "no_show", "to_collect", "cancelled"]).toContain(st);
    counts[st as keyof typeof counts]++;
  }
  const past = counts.done + counts.no_show + counts.to_collect + counts.cancelled;
  expect(counts.no_show).toBe(3);
  expect(counts.done / past).toBeGreaterThan(0.65);
  expect(counts.done / past).toBeLessThan(0.85);
  expect(new Set(salon.month.map((b) => b.channel))).toEqual(new Set(["voice", "manual"]));
  expect(salon.month.some((b) => b.channel === "manual" && b.customerPhone === "")).toBe(true);

  // Plausible for two chairs: 4 to 8 thousand euros (the catalogue prices cap a two-chair salon) taken in the 30 days.
  const paidMonth = salon.payments.filter((p) => cmp(p.paidAt, now.subtract({ hours: 24 * 30 })) >= 0).reduce((n, p) => n + p.amountCents, 0);
  expect(paidMonth).toBeGreaterThan(400_000);
  expect(paidMonth).toBeLessThan(780_000);

  // Clients: unique phones and names, links consistent, one birthday today, consent and notes present.
  const phones = new Set(set.clients.map((c) => c.phone));
  expect(phones.size).toBe(set.clients.length);
  expect(new Set(set.clients.map((c) => c.name)).size).toBe(set.clients.length);
  const byPhone = new Map(set.clients.map((c) => [c.phone, c]));
  for (const b of [...salon.month, ...set.history]) {
    if (b.clientId) expect(byPhone.get(b.customerPhone)?.id).toBe(b.clientId);
    else expect(byPhone.has(b.customerPhone)).toBe(false);
  }
  const today = localDateOf(now, tz);
  const md = `${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  expect(set.clients.filter((c) => c.birthday === md).length).toBeGreaterThanOrEqual(1);
  expect(set.clients.some((c) => c.promoConsent)).toBe(true);
  expect(set.clients.some((c) => !c.promoConsent)).toBe(true);
  expect(set.clients.some((c) => /alerg/i.test(c.note))).toBe(true);

  // Expenses: one fixed monthly, one-offs never after today, this month's present.
  const cur = monthOf(now, tz);
  expect(salon.expenses.some((e) => e.recurring && e.category === "rent" && e.amountCents === 90_000 && e.endMonth === null)).toBe(true);
  for (const e of salon.expenses) {
    if (e.recurring) expect(e.day).toBeNull();
    else expect(e.day! <= today.toString()).toBe(true);
  }
  expect(salon.expenses.filter((e) => e.day?.startsWith(cur)).length).toBeGreaterThanOrEqual(2);

  // Settings and outbox.
  expect(salon.settings.automations).toMatchObject({ reminder: true, review: true });
  expect(isReviewUrl(salon.settings.googleReviewUrl)).toBe(true);
  const keys = salon.outbox.map((o) => o.dedupeKey);
  expect(new Set(keys).size).toBe(keys.length);
  for (const o of salon.outbox) {
    expect(["reminder", "review"]).toContain(o.kind);
    expect(o.body.length).toBeLessThanOrEqual(700);
  }
  expect(salon.outbox.some((o) => o.status === "prepared")).toBe(true);

  // Calls: every call ended before now, and each receptionist booking's call exists.
  for (const c of set.calls) expect(cmp(c.endedAt, now)).toBeLessThanOrEqual(0);
  const callIds = new Set(set.calls.map((c) => c.id));
  for (const b of salon.month) if (b.callId) expect(callIds.has(b.callId)).toBe(true);
  for (const b of salon.month.filter((x) => x.channel === "voice" && x.callId)) {
    const c = set.calls.find((x) => x.id === b.callId)!;
    expect(cmp(c.endedAt, b.createdAt)).toBe(0);
    expect(cmp(b.createdAt, b.startsAt)).toBeLessThan(0);
  }
  return set;
}

describe("the demo month is consistent", () => {
  it.each(FIXED.map((i) => [i.toString(), i] as const))("at %s", (_l, now) => {
    check(now);
  });

  it("at any moment of the next two years", () => {
    const base = Temporal.Instant.from("2026-11-25T00:00:00Z").epochMilliseconds;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 730 * 24 * 12 }), (n) => {
        check(Temporal.Instant.fromEpochMilliseconds(base + n * 300_000));
      }),
      { numRuns: 20 },
    );
  });

  it("the same instant gives the same content", () => {
    const strip = (s: CuratedSet) => JSON.stringify(s.salon.month.map((b) => [b.serviceId, b.startsAt.toString(), b.priceCents, b.noShow, b.status]));
    expect(strip(build(FIXED[0]))).toBe(strip(build(FIXED[0])));
  });
});

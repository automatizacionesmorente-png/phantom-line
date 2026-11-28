import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { comparedThrough, sameDaysTotals, type ExpenseItem } from "@/lib/salon/month";
import type { PaymentRow } from "@/lib/salon/types";

const TZ = "Europe/Madrid";
const at = (s: string) => Temporal.Instant.from(s);
let seq = 0;
const pay = (paidAt: string, amountCents: number): PaymentRow => ({
  id: `p${++seq}`, bookingId: null, amountCents, productCents: 0, productLabel: "", method: "cash", paidAt: at(paidAt), serviceId: null, resourceId: null,
});
const one = (day: string, amountCents: number): ExpenseItem => ({ id: `e${++seq}`, concept: "x", category: "other", amountCents, day, recurring: false });
const fixed = (month: string, amountCents: number): ExpenseItem => ({ id: `f${++seq}`, concept: "Alquiler", category: "rent", amountCents, day: `${month}-01`, recurring: true });

describe("comparedThrough", () => {
  it("is the local day of the month for the current month, null for any other", () => {
    const now = at("2026-11-10T09:00:00Z");
    expect(comparedThrough("2026-11", now, TZ)).toBe(10);
    expect(comparedThrough("2026-10", now, TZ)).toBeNull();
    expect(comparedThrough("2026-12", now, TZ)).toBeNull();
    // 23:30Z on the 30th is already 1 December in Madrid.
    expect(comparedThrough("2026-12", at("2026-11-30T23:30:00Z"), TZ)).toBe(1);
    expect(comparedThrough("2026-11", at("2026-11-30T23:30:00Z"), TZ)).toBeNull();
  });
});

describe("sameDaysTotals (previous month, 1st through day N)", () => {
  const payments = [
    pay("2026-10-01T08:00:00Z", 1000),
    pay("2026-10-10T20:00:00Z", 2000), // 22:00 on the 10th in Madrid: in
    pay("2026-10-10T22:30:00Z", 4000), // 00:30 on the 11th (summer time, +2): out
    pay("2026-10-20T10:00:00Z", 8000),
  ];
  const items = [fixed("2026-10", 90_000), one("2026-10-05", 500), one("2026-10-10", 700), one("2026-10-11", 9000), one("2026-10-28", 9000)];

  it("counts payments up to the 10th and one-offs up to the 10th, fixed ones whole", () => {
    expect(sameDaysTotals(payments, items, 10, TZ)).toEqual({ takenCents: 3000, expensesCents: 91_200, leftCents: 3000 - 91_200 });
  });

  it("a day beyond the month's length takes the whole month", () => {
    expect(sameDaysTotals(payments, items, 31, TZ).takenCents).toBe(15_000);
    expect(sameDaysTotals(payments, items, 31, TZ).expensesCents).toBe(90_000 + 500 + 700 + 9000 + 9000);
  });

  it("is DST-safe: the day is the shop's local day on both sides of the clock change", () => {
    // Clocks went back on 25 October 2026 (02:00 -> 01:00 local).
    const p = [pay("2026-10-24T22:30:00Z", 100), pay("2026-10-24T23:30:00Z", 200), pay("2026-10-25T22:30:00Z", 400), pay("2026-10-25T23:30:00Z", 800)];
    // 24 Oct 22:30Z = 00:30 on the 25th (+2); 25 Oct 22:30Z = 23:30 on the 25th (+1); 25 Oct 23:30Z = 00:30 on the 26th.
    expect(sameDaysTotals(p, [], 25, TZ).takenCents).toBe(700);
    expect(sameDaysTotals(p, [], 24, TZ).takenCents).toBe(0);
  });
});

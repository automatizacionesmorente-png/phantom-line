import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import {
  addMonths,
  euros,
  exportCsv,
  monthBounds,
  monthExpenses,
  monthInWindow,
  monthOf,
  monthReport,
  splitVat,
  type ExpenseItem,
  type ExpenseRow,
  type MonthBooking,
} from "@/lib/salon/month";
import type { PaymentRow } from "@/lib/salon/types";

const TZ = "Europe/Madrid";
const at = (s: string) => Temporal.Instant.from(s);

let seq = 0;
const pay = (paidAt: string, amountCents: number, o: Partial<PaymentRow> = {}): PaymentRow => ({
  id: `p${++seq}`,
  bookingId: null,
  amountCents,
  productCents: 0,
  productLabel: "",
  method: "cash",
  paidAt: at(paidAt),
  serviceId: null,
  resourceId: null,
  ...o,
});
const exp = (day: string, amountCents: number, concept = "Luz"): ExpenseItem => ({
  id: `e${++seq}`,
  concept,
  category: "utilities",
  amountCents,
  day,
  recurring: false,
});
const base = { tz: TZ, bookings: [], calls: [], gapSends: [], expenses: [] };

describe("month buckets use shop local time", () => {
  it("a payment at 00:30 local on 1 December is December, and 23:59 on 30 November is November", () => {
    expect(monthOf(at("2026-11-30T23:30:00Z"), TZ)).toBe("2026-12");
    expect(monthOf(at("2026-11-30T22:59:00Z"), TZ)).toBe("2026-11");
    const rows = [pay("2026-11-30T23:30:00Z", 1000), pay("2026-11-30T22:59:00Z", 500)];
    expect(monthReport({ ...base, month: "2026-12", payments: rows }).takenCents).toBe(1000);
    expect(monthReport({ ...base, month: "2026-11", payments: rows }).takenCents).toBe(500);
  });

  it("the DST change on 25 Oct 2026 moves nothing between months", () => {
    const oct = monthBounds("2026-10", TZ);
    // Oct 2026 has 31 days and one 25-hour day: 745 hours, ending at 00:00 CET on 1 Nov.
    expect(oct.end.since(oct.start).total("hours")).toBe(745);
    expect(oct.end.toString()).toBe("2026-10-31T23:00:00Z");
    const rows = [
      pay("2026-10-24T22:30:00Z", 100), // 00:30 CEST on 25 Oct
      pay("2026-10-25T01:30:00Z", 200), // 02:30 CET, in the repeated hour
      pay("2026-10-31T22:59:00Z", 300), // 23:59 on 31 Oct
      pay("2026-10-31T23:00:00Z", 400), // 00:00 on 1 Nov
    ];
    expect(monthReport({ ...base, month: "2026-10", payments: rows }).takenCents).toBe(600);
    expect(monthReport({ ...base, month: "2026-11", payments: rows }).takenCents).toBe(400);
  });

  it("weeks run Monday to Sunday, clipped to the month, and add up to the takings", () => {
    // 1 Dec 2026 is a Tuesday.
    const r = monthReport({ ...base, month: "2026-12", payments: [pay("2026-12-01T10:00:00Z", 100), pay("2026-12-07T10:00:00Z", 200), pay("2026-12-31T10:00:00Z", 50)] });
    expect(r.weeks.map((w) => w.label)).toEqual(["1-6", "7-13", "14-20", "21-27", "28-31"]);
    expect(r.weeks.map((w) => w.takenCents)).toEqual([100, 200, 0, 0, 50]);
  });
});

describe("expenses", () => {
  it("left = taken - expenses for any rows", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { maxLength: 30 }),
        fc.array(fc.integer({ min: 1, max: 10_000_000 }), { maxLength: 30 }),
        (taken, spent) => {
          const r = monthReport({
            ...base,
            month: "2026-11",
            payments: taken.map((c) => pay("2026-11-10T10:00:00Z", c)),
            expenses: spent.map((c) => exp("2026-11-03", c)),
          });
          expect(r.leftCents).toBe(r.takenCents - r.expensesCents);
          expect(r.takenCents).toBe(taken.reduce((a, b) => a + b, 0));
          expect(r.weeks.reduce((n, w) => n + w.takenCents, 0)).toBe(r.takenCents);
        },
      ),
    );
  });

  it("editing a recurring amount keeps past months", () => {
    const old: ExpenseRow = { id: "t1", concept: "Alquiler", category: "rent", amountCents: 50_000, day: null, recurring: true, startMonth: "2026-01", endMonth: null };
    // The edit: the old template ends in October, the new one starts in November.
    const ended = { ...old, endMonth: "2026-10" };
    const next: ExpenseRow = { ...old, id: "t2", amountCents: 55_000, startMonth: "2026-11" };
    const rows = [ended, next];
    const total = (m: string) => monthExpenses(rows, m).reduce((n, e) => n + e.amountCents, 0);
    expect(total("2026-10")).toBe(50_000);
    expect(total("2026-09")).toBe(50_000);
    expect(total("2026-11")).toBe(55_000);
    expect(total("2027-03")).toBe(55_000);
    expect(total("2025-12")).toBe(0);
  });

  it("a month holds the one-offs dated in it plus the active templates", () => {
    const rows: ExpenseRow[] = [
      { id: "a", concept: "Tinte", category: "products", amountCents: 900, day: "2026-11-30", recurring: false, startMonth: null, endMonth: null },
      { id: "b", concept: "Tinte", category: "products", amountCents: 700, day: "2026-12-01", recurring: false, startMonth: null, endMonth: null },
      { id: "c", concept: "Alquiler", category: "rent", amountCents: 100, day: null, recurring: true, startMonth: "2026-11", endMonth: "2026-11" },
    ];
    expect(monthExpenses(rows, "2026-11").map((e) => e.id)).toEqual(["c", "a"]);
    expect(monthExpenses(rows, "2026-12").map((e) => e.id)).toEqual(["b"]);
  });
});

describe("the previous month", () => {
  it("deltaPct is null without a previous month, and a figure is null when its previous total is 0", () => {
    const p = [pay("2026-11-10T10:00:00Z", 1500)];
    expect(monthReport({ ...base, month: "2026-11", payments: p }).deltaPct).toBeNull();
    const r = monthReport({ ...base, month: "2026-11", payments: p, expenses: [exp("2026-11-02", 500)], prev: { takenCents: 1000, expensesCents: 0, leftCents: 1000 } });
    expect(r.deltaPct).toEqual({ taken: 50, expenses: null, left: 0 });
  });

  it("the month window is 24 months back and 1 ahead, and only real months", () => {
    const now = at("2026-11-10T08:00:00Z");
    expect(monthInWindow("2026-11", now, TZ)).toBe(true);
    expect(monthInWindow("2026-12", now, TZ)).toBe(true);
    expect(monthInWindow("2027-01", now, TZ)).toBe(false);
    expect(monthInWindow("2024-11", now, TZ)).toBe(true);
    expect(monthInWindow("2024-10", now, TZ)).toBe(false);
    for (const bad of ["2026-13", "2026-00", "26-11", "2026-1", "2026-11-01", ""]) expect(monthInWindow(bad, now, TZ)).toBe(false);
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("receptionist figures follow 9.6", () => {
  const b = (id: string, o: Partial<MonthBooking> = {}): MonthBooking => ({
    id,
    serviceId: "haircut",
    resourceId: "chair-1",
    channel: "voice",
    status: "confirmed",
    createdAt: at("2026-11-05T10:00:00Z"),
    start: at("2026-11-12T10:00:00Z"),
    noShow: false,
    priceCents: 1500,
    rescheduledFrom: null,
    phone: "+34612345678",
    ...o,
  });

  it("counts calls answered, its own bookings, their value, phone time and refilled gaps", () => {
    const bookings = [
      b("1"), // counts, 1500
      b("2", { priceCents: null, serviceId: "colour", phone: "+34600000002" }), // counts, catalogue 4500
      b("3", { status: "cancelled" }), // cancelled: not counted
      b("4", { channel: "manual", phone: "+34600000004" }), // the owner's own: not counted
      b("5", { createdAt: at("2026-10-31T22:59:00Z") }), // October (local): not this month
      b("6", { rescheduledFrom: "1" }), // a move, not a new appointment
      b("7", { noShow: true, start: at("2026-11-02T10:00:00Z"), channel: "manual", phone: "+34600000007" }), // a no-show, counted apart
      b("8", { noShow: true, start: at("2026-12-02T10:00:00Z"), createdAt: at("2026-10-02T10:00:00Z"), phone: "+34600000008" }), // a December no-show
    ];
    const calls = [
      { status: "completed", startedAt: at("2026-11-03T10:00:00Z"), endedAt: at("2026-11-03T10:02:30Z") }, // 150 s
      { status: "completed", startedAt: at("2026-11-04T10:00:00Z"), endedAt: at("2026-11-04T10:01:00Z") }, // 60 s
      { status: "abandoned", startedAt: at("2026-11-05T10:00:00Z"), endedAt: null }, // answered, no time
      { status: "failed", startedAt: at("2026-11-06T10:00:00Z"), endedAt: at("2026-11-06T10:09:00Z") }, // not answered
      { status: "completed", startedAt: at("2026-10-31T22:00:00Z"), endedAt: at("2026-10-31T22:10:00Z") }, // October
    ];
    // Gap sent to +34612345678 on 4 Nov 12:00; booking 1 (5 Nov 10:00) is inside 72 h. A gap to a phone
    // that did not book, and one whose booking came 4 days later, refill nothing.
    const gapSends = [
      { phone: "+34612345678", sentAt: at("2026-11-04T12:00:00Z") },
      { phone: "+34699999999", sentAt: at("2026-11-04T12:00:00Z") },
      { phone: "+34600000002", sentAt: at("2026-10-31T10:00:00Z") },
    ];
    const r = monthReport({ ...base, month: "2026-11", payments: [], bookings, calls, gapSends, catalogue: { haircut: 1500, colour: 4500 } });
    expect(r.receptionist).toEqual({ calls: 3, booked: 2, bookedValueCents: 6000, phoneSeconds: 210, gapsRefilled: 1 });
    expect(r.noShows).toBe(1);
  });

  it("works with no rows at all", () => {
    const r = monthReport({ ...base, month: "2026-11", payments: [] });
    expect(r).toMatchObject({ takenCents: 0, expensesCents: 0, leftCents: 0, byWorker: [], topServices: [], noShows: 0 });
    expect(r.receptionist).toEqual({ calls: 0, booked: 0, bookedValueCents: 0, phoneSeconds: 0, gapsRefilled: 0 });
  });

  it("by worker and top services (top 5, services net of the product part)", () => {
    const rows = [
      pay("2026-11-02T10:00:00Z", 1800, { serviceId: "haircut", resourceId: "chair-1", productCents: 300, bookingId: "x1" }),
      pay("2026-11-03T10:00:00Z", 1500, { serviceId: "haircut", resourceId: "chair-2", bookingId: "x2" }),
      pay("2026-11-04T10:00:00Z", 4500, { serviceId: "colour", resourceId: "chair-2", bookingId: "x3" }),
      pay("2026-11-05T10:00:00Z", 900, { productCents: 900 }),
      ...["a", "b", "c", "d"].map((s, i) => pay("2026-11-06T10:00:00Z", 10 + i, { serviceId: s, resourceId: "chair-3", bookingId: `y${i}` })),
    ];
    const r = monthReport({ ...base, month: "2026-11", payments: rows });
    expect(r.byWorker).toEqual([
      { resourceId: "chair-2", takenCents: 6000 },
      { resourceId: "chair-1", takenCents: 1800 },
      { resourceId: "chair-3", takenCents: 46 },
    ]);
    expect(r.topServices).toHaveLength(5);
    expect(r.topServices[0]).toEqual({ serviceId: "colour", count: 1, takenCents: 4500 });
    expect(r.topServices[1]).toEqual({ serviceId: "haircut", count: 2, takenCents: 3000 });
  });
});

describe("the accountant's CSV", () => {
  const parse = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n").map((l) => l.split(";"));
  const cents = (s: string) => Number(s.replace(",", ""));

  it("base + iva = total per row, for any total and rate", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 0, max: 30 }), (total, vat) => {
        const { base: b, iva } = splitVat(total, vat);
        expect(b + iva).toBe(total);
        expect(Math.abs(b - total / (1 + vat / 100))).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(euros(total)).toMatch(/^\d+,\d\d$/);
      }),
    );
    const p = [pay("2026-11-10T10:00:00Z", 1999), pay("2026-11-11T10:00:00Z", 1), pay("2026-11-12T10:00:00Z", 12_345, { method: "bizum" })];
    const e = [exp("2026-11-02", 3333), { ...exp("2026-11-01", 50_000, "Alquiler"), recurring: true }];
    const report = monthReport({ ...base, month: "2026-11", payments: p, expenses: e });
    const lines = parse(exportCsv(report, p, e, 21, "es"));
    const rows = lines.slice(1, -1);
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(cents(r[5]) + cents(r[6])).toBe(cents(r[4]));
  });

  it("has the es header, a BOM, ; separators, comma decimals and the VAT footer", () => {
    const p = [pay("2026-11-10T10:00:00Z", 12_100, { productLabel: "Champú", productCents: 1210, bookingId: "b", serviceId: "haircut" })];
    const e = [exp("2026-11-02", 3333, "Luz; \"nave\"")];
    const report = monthReport({ ...base, month: "2026-11", payments: p, expenses: e });
    const csv = exportCsv(report, p, e, 21, "es", { haircut: "corte" });
    expect(csv.startsWith("﻿fecha;tipo;concepto;método;total;base;iva\r\n")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toBe("2026-11-02;gasto;\"Luz; \"\"nave\"\"\";;33,33;27,55;5,78");
    expect(lines[2]).toBe("2026-11-10;ingreso;corte + Champú;efectivo;121,00;100,00;21,00");
    expect(lines[3]).toBe("IVA incluido al 21 %, revisar con tu gestor");
    expect(exportCsv(report, p, e, 10, "en").split("\r\n")[0]).toBe("﻿date;type;concept;method;total;base;vat");
  });

  it("defuses a concept that a spreadsheet would run as a formula", () => {
    const e = [exp("2026-11-02", 100, "=HYPERLINK(\"x\")")];
    const csv = exportCsv(monthReport({ ...base, month: "2026-11", payments: [], expenses: e }), [], e, 21, "es");
    expect(csv).toContain(";\"'=HYPERLINK(\"\"x\"\")\";");
  });

  it("only the month's own payments are written (local time)", () => {
    const p = [pay("2026-11-30T23:30:00Z", 1000), pay("2026-11-30T22:59:00Z", 500)];
    const report = monthReport({ ...base, month: "2026-11", payments: p });
    const rows = parse(exportCsv(report, p, [], 21, "es")).slice(1, -1);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("2026-11-30");
  });
});

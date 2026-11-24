/**
 * The month report, the expense expansion and the accountant's CSV (spec 2.3, 9.5, 9.6, 9.12).
 * Pure: rows and the shop's time zone come in. A month is a local calendar month of the shop, so
 * a payment at 00:30 on 1 December in Madrid is December whatever the server's zone is.
 */
import { Temporal } from "temporal-polyfill";
import type { Lang } from "@/lib/sectors";
import type { PaymentRow } from "./types";

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const EXPENSE_CATEGORIES = ["rent", "products", "utilities", "staff", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** A stored expense row: a one-off has `day`, a monthly template has `startMonth` (and maybe `endMonth`). */
export interface ExpenseRow {
  id: string;
  concept: string;
  category: ExpenseCategory;
  amountCents: number;
  /** YYYY-MM-DD for a one-off, else null. */
  day: string | null;
  recurring: boolean;
  startMonth: string | null;
  endMonth: string | null;
}

/** An expense as it counts in one month. A template counts on the 1st of each month it is active. */
export interface ExpenseItem {
  id: string;
  concept: string;
  category: ExpenseCategory;
  amountCents: number;
  /** YYYY-MM-DD. */
  day: string;
  recurring: boolean;
}

/** A booking as the report needs it (`priceCents` null on rows older than the snapshot). */
export interface MonthBooking {
  id: string;
  serviceId: string;
  resourceId: string;
  channel: string;
  status: string;
  createdAt: Temporal.Instant;
  start: Temporal.Instant;
  noShow: boolean;
  priceCents: number | null;
  rescheduledFrom: string | null;
  /** E.164 or '' (a walk-in). */
  phone: string;
}

export interface MonthCall {
  status: string;
  startedAt: Temporal.Instant;
  endedAt: Temporal.Instant | null;
}

/** A "hueco libre" message the Owner marked as sent. */
export interface GapSend {
  phone: string;
  sentAt: Temporal.Instant;
}

export interface MonthTotals {
  takenCents: number;
  expensesCents: number;
  leftCents: number;
}

export interface MonthReport extends MonthTotals {
  month: string;
  timeZone: string;
  /** Percent change against the previous month, whole numbers. Null without a previous month; each figure is null when its previous total is 0. */
  deltaPct: { taken: number | null; expenses: number | null; left: number | null } | null;
  weeks: { label: string; takenCents: number }[];
  byWorker: { resourceId: string; takenCents: number }[];
  topServices: { serviceId: string; count: number; takenCents: number }[];
  noShows: number;
  receptionist: {
    calls: number;
    booked: number;
    bookedValueCents: number;
    phoneSeconds: number;
    gapsRefilled: number;
  };
}

export interface MonthInput {
  month: string;
  tz: string;
  payments: readonly PaymentRow[];
  /** Already expanded for the month (`monthExpenses`). */
  expenses: readonly ExpenseItem[];
  bookings: readonly MonthBooking[];
  calls: readonly MonthCall[];
  gapSends: readonly GapSend[];
  prev?: MonthTotals;
  /** Catalogue price by service id, for bookings with no price snapshot. */
  catalogue?: Readonly<Record<string, number>>;
}

/** A gap message refills a gap when its client books within this long after it was sent. */
export const GAP_WINDOW_HOURS = 72;

// ---------------------------------------------------------------------------
// Months

/** "YYYY-MM" of the local date `d`. */
const monthOfDate = (d: Temporal.PlainDate) => `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}`;

export const monthOf = (i: Temporal.Instant, tz: string): string => monthOfDate(i.toZonedDateTimeISO(tz).toPlainDate());

const firstDay = (month: string) => Temporal.PlainDate.from(`${month}-01`);

export function addMonths(month: string, n: number): string {
  return monthOfDate(firstDay(month).add({ months: n }));
}

/** [start, end) of a local month as instants (the month's own midnights, so DST never moves a boundary). */
export function monthBounds(month: string, tz: string): { start: Temporal.Instant; end: Temporal.Instant } {
  const first = firstDay(month);
  return {
    start: first.toZonedDateTime({ timeZone: tz, plainTime: "00:00" }).toInstant(),
    end: first.add({ months: 1 }).toZonedDateTime({ timeZone: tz, plainTime: "00:00" }).toInstant(),
  };
}

/** Whether `month` is a real month, at most `back` months before `now`'s month and `ahead` after it. */
export function monthInWindow(month: string, now: Temporal.Instant, tz: string, back = 24, ahead = 1): boolean {
  if (!MONTH_RE.test(month)) return false;
  const here = firstDay(monthOf(now, tz));
  const months = firstDay(month).since(here, { largestUnit: "months" }).months;
  return months >= -back && months <= ahead;
}

// ---------------------------------------------------------------------------
// Expenses (spec 9.5)

/**
 * The expenses that count in `month`: the one-off rows dated in it, plus each template active in it
 * (start <= month <= end). Changing a fixed amount ends the old template and starts a new one, so a
 * past month is never recomputed with a newer amount.
 */
export function monthExpenses(rows: readonly ExpenseRow[], month: string): ExpenseItem[] {
  const items: ExpenseItem[] = [];
  for (const r of rows) {
    if (r.recurring) {
      if (r.startMonth === null || r.startMonth > month || (r.endMonth !== null && r.endMonth < month)) continue;
      items.push({ id: r.id, concept: r.concept, category: r.category, amountCents: r.amountCents, day: `${month}-01`, recurring: true });
    } else if (r.day !== null && r.day.slice(0, 7) === month) {
      items.push({ id: r.id, concept: r.concept, category: r.category, amountCents: r.amountCents, day: r.day, recurring: false });
    }
  }
  return items.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------
// The report (spec 9.6)

const sum = (xs: readonly number[]) => xs.reduce((n, x) => n + x, 0);

/** Percent change from `prev` to `cur`, rounded; null when there is nothing to compare with. */
function delta(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  // Half away from zero, so +12.5 and -12.5 round alike (Math.round would send -12.5 to -12).
  return Math.sign(pct) * Math.round(Math.abs(pct));
}

export function monthReport(input: MonthInput): MonthReport {
  const { month, tz } = input;
  const inMonth = (i: Temporal.Instant) => monthOf(i, tz) === month;

  const payments = input.payments.filter((p) => inMonth(p.paidAt));
  const takenCents = sum(payments.map((p) => p.amountCents));
  const expensesCents = sum(input.expenses.map((e) => e.amountCents));

  // Weeks: Monday to Sunday, clipped to the month, every one listed (a quiet week is a zero bar).
  const first = firstDay(month);
  const last = first.add({ months: 1 }).subtract({ days: 1 });
  const weeks: { from: Temporal.PlainDate; to: Temporal.PlainDate; takenCents: number }[] = [];
  for (let d = first; Temporal.PlainDate.compare(d, last) <= 0; ) {
    const sunday = d.add({ days: 7 - d.dayOfWeek });
    const to = Temporal.PlainDate.compare(sunday, last) > 0 ? last : sunday;
    weeks.push({ from: d, to, takenCents: 0 });
    d = to.add({ days: 1 });
  }
  for (const p of payments) {
    const day = p.paidAt.toZonedDateTimeISO(tz).toPlainDate();
    const w = weeks.find((x) => Temporal.PlainDate.compare(day, x.from) >= 0 && Temporal.PlainDate.compare(day, x.to) <= 0);
    if (w) w.takenCents += p.amountCents;
  }

  // By worker: the full payment amount, product part included (the chair took it); what each resource's paid bookings took (a product-only sale has no worker).
  const worker = new Map<string, number>();
  // Top services: deliberately NET of the product part, so a service is not credited with a shampoo sold.
  const service = new Map<string, { count: number; takenCents: number }>();
  for (const p of payments) {
    if (p.resourceId !== null) worker.set(p.resourceId, (worker.get(p.resourceId) ?? 0) + p.amountCents);
    if (p.serviceId !== null) {
      const s = service.get(p.serviceId) ?? { count: 0, takenCents: 0 };
      s.count += 1;
      s.takenCents += p.amountCents - p.productCents;
      service.set(p.serviceId, s);
    }
  }

  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  // The receptionist: only its own, real rows.
  // "Booked by the receptionist": deliberately leaves out manual bookings, cancelled ones and moves
  // (a move is the same appointment, not a new one), so the figure is only real, attributable work.
  const made = [...new Map(input.bookings.map((b) => [b.id, b])).values()].filter(
    (b) => b.channel !== "manual" && b.status !== "cancelled" && b.rescheduledFrom === null && inMonth(b.createdAt),
  );
  // "Calls answered": deliberately leaves out failed calls (nobody was answered), as the 7-day panel does.
  const calls = input.calls.filter((c) => c.status !== "failed" && inMonth(c.startedAt));
  const timed = calls.filter(
    (c) => c.status === "completed" && c.endedAt !== null && Temporal.Instant.compare(c.endedAt, c.startedAt) >= 0,
  );
  const phoneSeconds = sum(timed.map((c) => Math.floor(c.endedAt!.since(c.startedAt).total("seconds"))));

  // A gap is refilled when a booking of that phone (not cancelled, not the Owner's own, not a move, made that month) was created
  // within 72 h after the gap message was marked sent; each booking counts once.
  const refilled = new Set<string>();
  for (const g of input.gapSends) {
    if (g.phone === "") continue;
    const until = g.sentAt.add({ hours: GAP_WINDOW_HOURS });
    for (const b of input.bookings) {
      if (b.phone !== g.phone || b.status === "cancelled" || b.channel === "manual" || b.rescheduledFrom !== null || !inMonth(b.createdAt)) continue;
      if (Temporal.Instant.compare(b.createdAt, g.sentAt) >= 0 && Temporal.Instant.compare(b.createdAt, until) <= 0) refilled.add(b.id);
    }
  }

  const label = (w: { from: Temporal.PlainDate; to: Temporal.PlainDate }) =>
    w.from.day === w.to.day ? String(w.from.day) : `${w.from.day}-${w.to.day}`;

  return {
    month,
    timeZone: tz,
    takenCents,
    expensesCents,
    leftCents: takenCents - expensesCents,
    deltaPct: input.prev
      ? {
          taken: delta(takenCents, input.prev.takenCents),
          expenses: delta(expensesCents, input.prev.expensesCents),
          left: delta(takenCents - expensesCents, input.prev.leftCents),
        }
      : null,
    weeks: weeks.map((w) => ({ label: label(w), takenCents: w.takenCents })),
    byWorker: [...worker].map(([resourceId, c]) => ({ resourceId, takenCents: c })).sort((a, b) => b.takenCents - a.takenCents || byId(a.resourceId, b.resourceId)),
    topServices: [...service]
      .map(([serviceId, s]) => ({ serviceId, ...s }))
      .sort((a, b) => b.takenCents - a.takenCents || b.count - a.count || byId(a.serviceId, b.serviceId))
      .slice(0, 5),
    noShows: input.bookings.filter((b) => b.noShow && inMonth(b.start)).length,
    receptionist: {
      calls: calls.length,
      booked: made.length,
      bookedValueCents: sum(made.map((b) => b.priceCents ?? input.catalogue?.[b.serviceId] ?? 0)),
      phoneSeconds,
      gapsRefilled: refilled.size,
    },
  };
}

// ---------------------------------------------------------------------------
// The accountant's CSV (spec 9.12)

const T = {
  es: {
    header: ["fecha", "tipo", "concepto", "método", "total", "base", "iva"],
    income: "ingreso",
    expense: "gasto",
    sale: "Venta de producto",
    product: "producto",
    methods: { cash: "efectivo", card: "tarjeta", bizum: "bizum", voucher: "vale" },
    footer: (vat: number) => `IVA incluido al ${vat} %, revisar con tu gestor`,
  },
  en: {
    header: ["date", "type", "concept", "method", "total", "base", "vat"],
    income: "income",
    expense: "expense",
    sale: "Product sale",
    product: "product",
    methods: { cash: "cash", card: "card", bizum: "bizum", voucher: "voucher" },
    footer: (vat: number) => `VAT included at ${vat} %, check with your accountant`,
  },
} as const satisfies Record<Lang, unknown>;

/** 1234 -> "12,34". */
export const euros = (cents: number): string => {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
};

/** Gross to base: base = round(total / (1 + vat/100)), so base + iva = total to the cent. */
export function splitVat(totalCents: number, vatPct: number): { base: number; iva: number } {
  const base = Math.round((totalCents * 100) / (100 + vatPct));
  return { base, iva: totalCents - base };
}

/** A cell: quoted when it holds a separator, a quote or a line break; a leading = + - @ is defused (spreadsheet formulas). */
function cell(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The month's takings and expenses for the accountant: UTF-8 BOM, `;` separator, comma decimals,
 * one row per payment and per expense (date order, takings first on a day), then the VAT line.
 * `serviceNames` turns a service id into the words of the sale; the report supplies the zone.
 */
export function exportCsv(
  report: MonthReport,
  payments: readonly PaymentRow[],
  expenses: readonly ExpenseItem[],
  vatPct: number,
  lang: Lang,
  serviceNames: Readonly<Record<string, string>> = {},
): string {
  const t = T[lang];
  const tz = report.timeZone;
  type Row = { date: string; order: number; concept: string; method: string; type: string; total: number };
  const rows: Row[] = [];
  for (const p of payments) {
    if (monthOf(p.paidAt, tz) !== report.month) continue;
    const base = p.bookingId !== null && p.serviceId !== null ? (serviceNames[p.serviceId] ?? p.serviceId) : "";
    const product = p.productCents > 0 || p.bookingId === null ? (p.productLabel || t.product) : "";
    const concept = base && product ? `${base} + ${product}` : base || (p.bookingId === null ? (p.productLabel || t.sale) : product);
    rows.push({
      date: p.paidAt.toZonedDateTimeISO(tz).toPlainDate().toString(),
      order: 0,
      concept,
      method: t.methods[p.method],
      type: t.income,
      total: p.amountCents,
    });
  }
  for (const e of expenses) {
    rows.push({ date: e.day, order: 1, concept: e.concept, method: "", type: t.expense, total: e.amountCents });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order || (a.concept < b.concept ? -1 : a.concept > b.concept ? 1 : 0)));

  const lines = [t.header.join(";")];
  for (const r of rows) {
    const { base, iva } = splitVat(r.total, vatPct);
    lines.push([r.date, r.type, cell(r.concept), r.method, euros(r.total), euros(base), euros(iva)].join(";"));
  }
  lines.push(cell(t.footer(vatPct)));
  return `﻿${lines.join("\r\n")}\r\n`;
}

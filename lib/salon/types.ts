import type { Temporal } from "temporal-polyfill";
import type { Actor } from "@/lib/owner/types";
import type { OwnerDeps } from "@/lib/owner/handleOwner";
import type { ExpenseCategory, ExpenseRow, GapSend, MonthBooking, MonthCall } from "./month";

/** Time nobody can book: a day off, a holiday, a break. `resourceId` null = the whole shop. */
export interface TimeBlock {
  id: string;
  resourceId: string | null;
  start: Temporal.Instant;
  /** Exclusive. */
  end: Temporal.Instant;
  reason: string;
}

export type PaymentMethod = "cash" | "card" | "bizum" | "voucher";

/** A booking the Owner writes by hand (a phone call, a walk-in). `phone` is E.164 or '' for a walk-in. */
export interface ManualBooking {
  shopId: string;
  resourceId: string;
  serviceId: string;
  start: Temporal.Instant;
  end: Temporal.Instant;
  name: string;
  phone: string;
  priceCents: number;
  now: Temporal.Instant;
  actor: Actor;
}

export interface NewBlock {
  shopId: string;
  resourceId: string | null;
  start: Temporal.Instant;
  end: Temporal.Instant;
  reason: string;
}

export interface NewPayment {
  shopId: string;
  /** Null for a product-only sale. */
  bookingId: string | null;
  amountCents: number;
  method: PaymentMethod;
  productCents: number;
  productLabel: string;
  /** Booking payments only are cut off by the 12 h rule; this is the earliest start allowed. */
  now: Temporal.Instant;
  actor: Actor;
}

export interface PaymentRow {
  id: string;
  bookingId: string | null;
  amountCents: number;
  productCents: number;
  productLabel: string;
  method: PaymentMethod;
  paidAt: Temporal.Instant;
  /** Service and resource of the booking this pays; null for a product-only sale. */
  serviceId: string | null;
  resourceId: string | null;
}

export type InsertPaymentResult =
  | { ok: true; id: string }
  /** No row written: the booking is missing, cancelled, too far ahead or already paid (the handler re-reads to say which). */
  | { ok: false };

/** The salon's own persistence (lib/db/salonRepository.ts). Every method names the shop. */
export interface SalonRepository {
  insertManualBooking(b: ManualBooking): Promise<{ ok: true; id: string } | { ok: false; reason: "overlap" }>;
  listBlocks(shopId: string, from: Temporal.Instant, to: Temporal.Instant): Promise<TimeBlock[]>;
  insertBlock(b: NewBlock): Promise<TimeBlock>;
  deleteBlock(shopId: string, id: string): Promise<boolean>;
  insertPayment(p: NewPayment): Promise<InsertPaymentResult>;
  /** False when no booking of this shop has that id. */
  setVisitNote(shopId: string, bookingId: string, note: string): Promise<boolean>;
  /** Payments with paid_at in [from, to). */
  listPayments(shopId: string, from: Temporal.Instant, to: Temporal.Instant): Promise<PaymentRow[]>;
  /** The one-off expenses dated in `month` (YYYY-MM) and the monthly templates active in it. */
  listExpenses(shopId: string, month: string): Promise<ExpenseRow[]>;
  insertExpense(e: NewExpense): Promise<string>;
  /** How many expense rows (one-offs and templates) the shop has. */
  countExpenses(shopId: string): Promise<number>;
  /** How many time blocks the shop has. */
  countBlocks(shopId: string): Promise<number>;
  /**
   * Ends a monthly template after `lastMonth`; a template that never began by then is removed.
   * False when this shop has no such template.
   */
  endRecurring(shopId: string, id: string, lastMonth: string): Promise<boolean>;
  /** False when this shop has no such expense. */
  deleteExpense(shopId: string, id: string): Promise<boolean>;
  /** Bookings created in [from, to), plus the ones starting in it that were marked no-show. */
  listMonthBookings(shopId: string, from: Temporal.Instant, to: Temporal.Instant): Promise<MonthBooking[]>;
  /** Calls started in [from, to). */
  listMonthCalls(shopId: string, from: Temporal.Instant, to: Temporal.Instant): Promise<MonthCall[]>;
  /** "Hueco libre" messages marked sent in [from, to). */
  listGapSends(shopId: string, from: Temporal.Instant, to: Temporal.Instant): Promise<GapSend[]>;
  /** The shop's VAT rate in percent (21 until the Owner sets another). */
  vatRatePct(shopId: string): Promise<number>;
}

export interface NewExpense {
  shopId: string;
  concept: string;
  category: ExpenseCategory;
  amountCents: number;
  /** YYYY-MM-DD for a one-off; for a monthly template its first day, and only the month is kept. */
  day: string;
  recurring: boolean;
}

export type SalonDeps = OwnerDeps & { salon: SalonRepository };

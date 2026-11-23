import type { Temporal } from "temporal-polyfill";
import type { Actor } from "@/lib/owner/types";
import type { OwnerDeps } from "@/lib/owner/handleOwner";

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
}

export type SalonDeps = OwnerDeps & { salon: SalonRepository };

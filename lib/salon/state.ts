/**
 * The booking states the Owner sees (salon spec 9.1). The database keeps only
 * `confirmed`/`cancelled`; everything else is derived here, in one place.
 */
import { Temporal } from "temporal-polyfill";

export type BookingState = "pending" | "confirmed" | "done" | "no_show" | "to_collect" | "cancelled";

export interface StateInput {
  status: "confirmed" | "cancelled";
  ownerConfirmedAt: Temporal.Instant | null;
  channel: string;
  noShowAt: Temporal.Instant | null;
  /** Has a payment. */
  paid: boolean;
  start: Temporal.Instant;
  end: Temporal.Instant;
  now: Temporal.Instant;
}

/**
 * - done: has a payment; no-show: `noShowAt` set;
 * - to collect: it has ended and is neither of those;
 * - otherwise confirmed (owner-confirmed, or made by the owner by hand) or pending (made by the
 *   receptionist and not yet confirmed).
 * A cancelled booking is `cancelled` and is never to collect.
 */
export function bookingState(i: StateInput): BookingState {
  if (i.status === "cancelled") return "cancelled";
  if (i.paid) return "done";
  if (i.noShowAt !== null) return "no_show";
  if (Temporal.Instant.compare(i.end, i.now) <= 0) return "to_collect";
  return i.ownerConfirmedAt !== null || i.channel === "manual" ? "confirmed" : "pending";
}

/**
 * Owner moves (owner-machine 10.3, 10.4, 10.6, 10.9). A move is the caller's own
 * Booking_Rules: `evaluateBooking` with the moved Booking ignored, against the bookings
 * read in the same request, with the Booking's own resource tried first. The code decides;
 * the database's no-overlap constraint checks the UPDATE afterwards (10.5). Pure.
 */
import { Temporal } from "temporal-polyfill";
import {
  daySlots,
  evaluateBooking,
  localDateOf,
  preferResource,
  type AcceptedVerdict,
  type ExistingBooking,
  type RejectionReason,
  type RuleContext,
  type Slot,
} from "@/lib/booking";
import { toShopRules, type ShopProfile } from "@/lib/conversation/shopProfile";
import type { SectorPack } from "@/lib/sectors";
import { allowedActions, type AgendaBooking } from "./agenda";

/** A Booking can be moved to today or any of the next 13 local days. */
export const MOVE_WINDOW_DAYS = 14;

/** Today … today + 13, local dates in the shop's zone. */
export function moveDays(now: Temporal.Instant, timeZone: string): Temporal.PlainDate[] {
  const today = localDateOf(now, timeZone);
  return Array.from({ length: MOVE_WINDOW_DAYS }, (_, k) => today.add({ days: k }));
}

/** Whether a local date is one of `moveDays(now, timeZone)`. */
export function isMoveDay(date: Temporal.PlainDate, now: Temporal.Instant, timeZone: string): boolean {
  const offset = localDateOf(now, timeZone).until(date, { largestUnit: "days" }).days;
  return offset >= 0 && offset < MOVE_WINDOW_DAYS;
}

/** The Booking_Rules context of a move: the shop with the Booking's own resource first. */
export function moveContext(
  b: Pick<AgendaBooking, "resourceId">,
  shop: ShopProfile,
  pack: SectorPack,
  now: Temporal.Instant,
  existing: readonly ExistingBooking[],
): RuleContext {
  return {
    now,
    shop: preferResource(toShopRules(shop), b.resourceId),
    pack: { slotStepMin: pack.slotStepMin, rules: pack.rules },
    existing,
  };
}

export type MoveRejection = RejectionReason | "not_movable" | "outside_move_window";
export type MoveDecision =
  | { ok: true; verdict: AcceptedVerdict }
  | { ok: false; reason: MoveRejection; slots: Slot[] };

export interface MoveInput {
  booking: AgendaBooking;
  start: Temporal.Instant;
  now: Temporal.Instant;
  shop: ShopProfile;
  pack: SectorPack;
  /** The active bookings read in this request; the moved one may be among them. */
  existing: readonly ExistingBooking[];
}

/**
 * 1. `not_movable` unless `allowedActions` includes move (10.1).
 * 2. `outside_move_window` unless the start's local date is in `moveDays`.
 * 3. `evaluateBooking` with the Booking ignored: accept with its verdict or reject with its reason (10.4, 10.9).
 *
 * A Booking_Rules rejection carries the fresh Move_Slots of the requested day, so the
 * dialog refreshes in place. The first two carry none: nothing can be offered for a
 * Booking that cannot move, and the slots route only lists days in `moveDays`.
 */
export function decideMove(input: MoveInput): MoveDecision {
  const { booking, start, now, shop, pack, existing } = input;
  if (!allowedActions(booking, now).includes("move")) {
    return { ok: false, reason: "not_movable", slots: [] };
  }
  const date = localDateOf(start, shop.timeZone);
  if (!isMoveDay(date, now, shop.timeZone)) {
    return { ok: false, reason: "outside_move_window", slots: [] };
  }
  const ctx = moveContext(booking, shop, pack, now, existing);
  const req = { serviceId: booking.serviceId, ignoreBookingId: booking.id };
  const e = evaluateBooking({ ...req, start }, ctx);
  if (e.ok) return { ok: true, verdict: e };
  return { ok: false, reason: e.reason, slots: daySlots(req, date, ctx) };
}

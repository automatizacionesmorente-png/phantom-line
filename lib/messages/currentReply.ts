/**
 * Current_Reply (owner-machine 4.6): the suggested reply as it should be sent now.
 * The stored reply, unless the Owner changed the Booking after the Message; then the
 * same `phrases(callLang).owner` template with the Booking as it is now, so the Owner
 * never copies a reply with a stale time. It stays in the Call's language, because it
 * goes to the customer. Pure.
 */
import { Temporal } from "temporal-polyfill";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { phrases } from "@/lib/receptionist/phrases";
import type { Lang, SectorPack } from "@/lib/sectors";

export interface ReplyBooking {
  serviceId: string;
  start: Temporal.Instant;
  status: "confirmed" | "cancelled";
  cancelledBy: "caller" | "owner" | null;
  /** The time of the latest `move` Audit_Record, or null. */
  ownerMovedAt: Temporal.Instant | null;
}

export function currentReply(
  m: { suggestedReply: string; callerName: string | null; createdAt: Temporal.Instant },
  booking: ReplyBooking | null,
  callLang: Lang,
  shop: ShopProfile,
  pack: SectorPack,
): string {
  if (booking === null) return m.suggestedReply;
  const r = phrases(callLang, pack, shop).owner;
  if (booking.status === "cancelled") {
    return booking.cancelledBy === "owner" ? r.replyCancelled(m.callerName) : m.suggestedReply;
  }
  if (booking.ownerMovedAt !== null && Temporal.Instant.compare(booking.ownerMovedAt, m.createdAt) > 0) {
    return r.replyRescheduled(m.callerName, booking.serviceId, booking.start);
  }
  return m.suggestedReply;
}

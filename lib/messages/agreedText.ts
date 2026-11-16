/**
 * Agreed_Text (owner-machine 4.7): "what was agreed", rendered at read time from the
 * Booking as it is now, with the same `phrases(lang).owner` templates that
 * `buildOwnerMessage` used to write the stored text. Pure.
 */
import type { Temporal } from "temporal-polyfill";
import type { Outcome } from "@/lib/conversation/types";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { phrases } from "@/lib/receptionist/phrases";
import type { Lang, SectorPack } from "@/lib/sectors";

export interface AgreedBooking {
  serviceId: string;
  resourceId: string;
  start: Temporal.Instant;
  status: "confirmed" | "cancelled";
}

/**
 * A cancelled Booking says it was cancelled; an active one says the Service, local day,
 * time and Resource, "changed" when the Call rescheduled it. An owner move shows the new
 * time; the Agenda row says who moved it (9.5).
 */
export function agreedText(
  outcome: Outcome,
  booking: AgreedBooking,
  lang: Lang,
  shop: ShopProfile,
  pack: SectorPack,
): string {
  const o = phrases(lang, pack, shop).owner;
  if (booking.status === "cancelled") return o.agreedCancelled(booking.serviceId, booking.start);
  if (outcome === "rescheduled") return o.agreedRescheduled(booking.serviceId, booking.start, booking.resourceId);
  return o.agreedBooked(booking.serviceId, booking.start, booking.resourceId);
}

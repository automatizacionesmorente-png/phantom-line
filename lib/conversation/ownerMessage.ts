import { Temporal } from "temporal-polyfill";
import { phrases } from "@/lib/receptionist/phrases";
import type { SectorPack } from "@/lib/sectors";
import type { ShopProfile } from "./shopProfile";
import { suggestedFrom } from "@/lib/messages/urgency";
import type { CallState, Outcome, OwnerMessageDraft } from "./types";

/** The booking a Message is about, when the outcome touched one. */
export interface MessageBooking {
  serviceId: string;
  start: Temporal.Instant;
  resourceId: string;
}

/**
 * The Message for the tape, built by code from server state. Owner-facing
 * texts are in the shop's first language; the suggested reply is in the
 * caller's language.
 *
 * It is a draft: it carries the model's Suggested_Urgency and the facts the
 * Urgency_Rules need, never a final urgency. Only `messageWrite` turns it into
 * a write (owner-machine 4.1).
 */
export function buildOwnerMessage(
  state: CallState,
  outcome: Outcome,
  shop: ShopProfile,
  pack: SectorPack,
  booking?: MessageBooking,
): OwnerMessageDraft {
  const ownerLang = shop.languages[0];
  const o = phrases(ownerLang, pack, shop).owner;
  const r = phrases(state.language, pack, shop).owner;
  const name = state.fields.name ?? null;
  const reason = state.note.reason.trim() || o.defaultReason();

  let agreed: string;
  let suggestedReply: string;
  if (outcome === "booked" && booking) {
    agreed = o.agreedBooked(booking.serviceId, booking.start, booking.resourceId);
    suggestedReply = r.replyBooked(name, booking.serviceId, booking.start);
  } else if (outcome === "rescheduled" && booking) {
    agreed = o.agreedRescheduled(booking.serviceId, booking.start, booking.resourceId);
    suggestedReply = r.replyRescheduled(name, booking.serviceId, booking.start);
  } else if (outcome === "cancelled" && booking) {
    agreed = o.agreedCancelled(booking.serviceId, booking.start);
    suggestedReply = r.replyCancelled(name);
  } else {
    const detail =
      outcome === "fallback" ? o.detailFallback() : outcome === "abandoned" ? o.detailAbandoned() : reason;
    agreed = o.agreedNothing(detail);
    suggestedReply = r.replyCallBack(name);
  }

  return {
    callerName: name,
    callerPhone: state.fields.phone ?? null,
    reason,
    suggested: suggestedFrom(state.note),
    requestedDate: requestedDateOf(state),
    bookingStart: booking?.start ?? null,
    agreed,
    suggestedReply,
    outcome,
    modelFailed: outcome === "fallback" || state.modelFailed,
  };
}

/** The shop-local day the caller asked for, if any (5.4). `mergeFields` only stores valid dates. */
function requestedDateOf(state: CallState): Temporal.PlainDate | null {
  const date = state.fields.requested?.date;
  if (!date) return null;
  try {
    return Temporal.PlainDate.from(date);
  } catch {
    return null;
  }
}

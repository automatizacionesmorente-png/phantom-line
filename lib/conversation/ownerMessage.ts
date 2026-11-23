import { Temporal } from "temporal-polyfill";
import { phrases } from "@/lib/receptionist/phrases";
import type { SectorPack } from "@/lib/sectors";
import { serviceView } from "./catalog";
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
 * The Message for the tape, built by code from server state, never from the
 * model's words. Owner-facing texts (reason included) are in the shop's first
 * language; the suggested reply is in the caller's language.
 *
 * It is a draft: it carries the model's Suggested_Urgency and the facts the
 * Urgency_Rules need, never a final urgency. Only `messageWrite` turns it into
 * a write (owner-machine 4.1).
 */
export function buildOwnerMessage(
  state: CallState,
  asked: Outcome,
  shop: ShopProfile,
  pack: SectorPack,
  booking?: MessageBooking,
): OwnerMessageDraft {
  const ownerLang = shop.languages[0];
  const o = phrases(ownerLang, pack, shop).owner;
  const r = phrases(state.language, pack, shop).owner;
  const name = state.fields.name ?? null;
  const reason = reasonOf(state, shop, pack, booking);
  // 10.6: a Call that leaves the Owner something to do is a message unless it booked, moved or cancelled.
  const outcome: Outcome = asked === "answered" && (state.notes?.length ?? 0) > 0 ? "message" : asked;

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

/** The longest reason a Message keeps (10.7). */
export const MAX_REASON_CHARS = 160;

const clamp = (text: string) =>
  text.length <= MAX_REASON_CHARS ? text : `${text.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…`;

/**
 * The Message's reason, always built by code from server state and in the owner's language (the
 * shop's first one), because the Owner reads it: what the Caller wanted (the booked service, or
 * the services asked for), the change they asked for, the Profile_Topics answered, then the
 * Owner_Notes (10.6), at most 160 characters. It never uses the model's note, so a goodbye or a
 * language mix cannot reach the tape, and it names no relative day.
 */
function reasonOf(state: CallState, shop: ShopProfile, pack: SectorPack, booking: MessageBooking | undefined): string {
  const ownerLang = shop.languages[0];
  const o = phrases(ownerLang, pack, shop).owner;
  const name = (id: string) => serviceView(id, shop, pack).name[ownerLang];
  const id = booking?.serviceId ?? state.fields.serviceId;
  const names = id ? [name(id)] : (state.fields.serviceChoice?.candidates ?? []).map(name);
  const parts: string[] = [];
  if (state.intent === "reschedule" || state.intent === "cancel") parts.push(o.reasonChange(state.intent));
  else if (names.length > 0) parts.push(o.reasonWants(names));
  if ((state.topics?.length ?? 0) > 0) parts.push(o.reasonAsked(state.topics!));
  const all = [...parts, ...(state.notes ?? []).map((n) => o.note(n))].filter((x) => x !== "").join(". ");
  return all === "" ? o.defaultReason() : clamp(all);
}

/**
 * Whether a Call leaves the Owner anything to act on: a booking change, a model failure, or a
 * name, phone, service, requested time or Owner_Note. A Call with none of these writes no Message,
 * so the tape holds no empty cards.
 */
export function isActionable(state: CallState, outcome: Outcome): boolean {
  if (outcome === "booked" || outcome === "rescheduled" || outcome === "cancelled" || outcome === "fallback") return true;
  if (state.modelFailed) return true;
  const f = state.fields;
  return Boolean(f.name || f.phone || f.serviceId || f.serviceChoice || f.requested) || (state.notes?.length ?? 0) > 0;
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

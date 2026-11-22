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
  asked: Outcome,
  shop: ShopProfile,
  pack: SectorPack,
  booking?: MessageBooking,
): OwnerMessageDraft {
  const ownerLang = shop.languages[0];
  const o = phrases(ownerLang, pack, shop).owner;
  const r = phrases(state.language, pack, shop).owner;
  const name = state.fields.name ?? null;
  const reason = reasonOf(state, shop, pack, o.defaultReason());
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
 * The Message's reason. With brain Turns it is built by code, in the Call's language (10.7): the
 * services asked for and the Profile_Topics answered. Otherwise it is the model's. Either way the
 * Owner_Notes follow the main reason (10.6), and the whole is at most 160 characters.
 */
function reasonOf(state: CallState, shop: ShopProfile, pack: SectorPack, fallback: string): string {
  const r = phrases(state.language, pack, shop).owner;
  const notes = (state.notes ?? []).map((n) => r.note(n));
  let main = state.note.reason.trim();
  if ((state.brainTurns ?? 0) > 0) {
    const id = state.fields.serviceId;
    const names = id
      ? [serviceView(id, shop, pack).name[state.language]]
      : (state.fields.serviceChoice?.candidates ?? []).map((c) => serviceView(c, shop, pack).name[state.language]);
    const parts: string[] = [];
    if (names.length > 0) parts.push(r.reasonWants(names));
    if ((state.topics?.length ?? 0) > 0) parts.push(r.reasonAsked(state.topics!));
    main = parts.join(". ");
  }
  const all = [main, ...notes].filter((x) => x !== "").join(". ");
  return all === "" ? fallback : clamp(all);
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

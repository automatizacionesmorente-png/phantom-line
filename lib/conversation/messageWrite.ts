import type { Temporal } from "temporal-polyfill";
import { callerLinesOf, decideUrgency } from "@/lib/messages/urgency";
import type { SectorPack } from "@/lib/sectors";
import type { ShopProfile } from "./shopProfile";
import type { Line, OwnerMessageDraft, StoredCall, Write } from "./types";

export interface MessageWriteContext {
  call: Pick<StoredCall, "id" | "channel">;
  shop: ShopProfile;
  pack: SectorPack;
  /** Includes the current Turn's line when there is one. Only its Caller side is read (5.10). */
  transcript: readonly Line[];
  now: Temporal.Instant;
  bookingId?: string;
}

/**
 * The one place an end-of-Call Message becomes a write (owner-machine 4.1). Pure.
 * The code decides the urgency from the Caller's own words and the Call's facts;
 * the model's urgency is only the suggestion, stored next to it (4.3, 5.8).
 */
export function messageWrite(draft: OwnerMessageDraft, ctx: MessageWriteContext): Extract<Write, { type: "insertMessage" }> {
  const { suggested, requestedDate, bookingStart, ...texts } = draft;
  const decision = decideUrgency({
    callerLines: callerLinesOf(ctx.transcript),
    vocabulary: ctx.pack.vocabulary,
    timeZone: ctx.shop.timeZone,
    now: ctx.now,
    requestedDate,
    bookingStart,
    outcome: draft.outcome,
    modelFailed: draft.modelFailed,
    suggested,
  });
  return {
    type: "insertMessage",
    message: {
      ...texts,
      urgency: decision.final,
      urgencySuggested: decision.suggested,
      urgencyBasis: decision.basis,
      shopId: ctx.shop.id,
      callId: ctx.call.id,
      channel: ctx.call.channel,
      ...(ctx.bookingId ? { bookingId: ctx.bookingId } : {}),
    },
  };
}

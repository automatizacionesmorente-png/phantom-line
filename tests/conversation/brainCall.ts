import { Temporal } from "temporal-polyfill";
import type { ExistingBooking } from "@/lib/booking";
import { readUtterance, type Reading } from "@/lib/conversation/brain/read";
import { decideTurn, type Decision } from "@/lib/conversation/decide";
import { factsFromReading, type TurnFacts } from "@/lib/conversation/facts";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { initialCallState, type CallerBooking, type CallState, type Lang } from "@/lib/conversation/types";
import { getSectorPack } from "@/lib/sectors";

/**
 * A brain-only Call for tests: each utterance is read by the Code_Brain and decided by
 * `decideTurn`, with no model. A `createBooking` effect is applied to the bookings the next Turn
 * sees, as a database commit would (the in-memory repository of task 9.1 does the same with
 * overlap checks; here a booking only ever comes from an accepted verdict).
 */
export interface BrainTurn {
  utterance: string;
  reading: Reading;
  facts: TurnFacts;
  before: CallState;
  decision: Decision;
  /** The bookings this Turn was decided against. */
  existing: readonly ExistingBooking[];
}

export interface BrainCallOptions {
  shop: ShopProfile;
  now: Temporal.Instant;
  lang?: Lang;
  existing?: readonly ExistingBooking[];
  callerBookings?: readonly CallerBooking[];
  callId?: string;
  state?: CallState;
}

export function brainCall(lines: readonly string[], opts: BrainCallOptions): BrainTurn[] {
  const pack = getSectorPack(opts.shop.sectorPackId);
  let state = opts.state ?? initialCallState(opts.lang ?? "es");
  const existing: ExistingBooking[] = [...(opts.existing ?? [])];
  const out: BrainTurn[] = [];
  for (const utterance of lines) {
    const reading = readUtterance({ utterance, state, shop: opts.shop, pack, now: opts.now, lang: state.language });
    const facts = factsFromReading(reading, utterance);
    const seen = [...existing];
    const decision = decideTurn({
      state,
      facts,
      reading,
      shop: opts.shop,
      pack,
      now: opts.now,
      existing: seen,
      callerBookings: opts.callerBookings ?? [],
      callId: opts.callId ?? "brain-call",
    });
    for (const e of decision.effects) {
      if (e.type === "createBooking") {
        existing.push({ id: `bk${out.length}`, resourceId: e.verdict.resourceId, start: e.verdict.start, end: e.verdict.end });
      }
    }
    out.push({ utterance, reading, facts, before: state, decision, existing: seen });
    state = decision.state;
    if (decision.complete) break;
  }
  return out;
}

/** The Rich_Profile's clock in the regression call: Saturday 14 November 2026, 19:30 in Madrid. */
export const SAT_1930 = Temporal.Instant.from("2026-11-14T18:30:00Z");
/** The First_Offer of that clock: Tuesday 17 November, 10:00 in Madrid. */
export const TUE_1000 = Temporal.Instant.from("2026-11-17T09:00:00Z");

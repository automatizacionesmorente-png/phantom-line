import { Temporal } from "temporal-polyfill";
import { checkBooking, toInstant, type ExistingBooking, type RuleContext } from "@/lib/booking";
import { phrases, type Said } from "@/lib/receptionist/phrases";
import type { ModelTurn } from "@/lib/receptionist/schema";
import type { RequiredField, SectorPack } from "@/lib/sectors";
import { mergeFields } from "./fields";
import { matchesCaller } from "./matchCaller";
import { looksLikeName } from "./names";
import { buildOwnerMessage, type MessageBooking } from "./ownerMessage";
import { toShopRules, type ShopProfile } from "./shopProfile";
import type { CallerBooking, CallFields, CallState, Effect, Intent, Outcome, PendingAction, PublicState } from "./types";

export const DEFAULT_MAX_TURNS = 20;

export interface DecideInput {
  state: CallState;
  /** Already zod-validated. */
  turn: ModelTurn;
  shop: ShopProfile;
  pack: SectorPack;
  now: Temporal.Instant;
  /** Fresh from the database when a time is involved, else []. Must cover the slot-search window. */
  existing: readonly ExistingBooking[];
  /** Upcoming confirmed bookings for the caller's phone; filtered here with matchesCaller. */
  callerBookings: readonly CallerBooking[];
  maxTurns?: number;
  /** The Call's id: with the Turn number it picks the Phrase_Variants (Variant_Seed). Without it, variant 0. */
  callId?: string;
}

export interface Decision {
  state: CallState;
  reply: string;
  /** The audio of `reply` may be stored and replayed: false for a line with a name or phone, and for model text. */
  cacheable: boolean;
  /** The reply is the model's own line (a question, an out-of-profile answer), not a template. */
  fromModel: boolean;
  complete: boolean;
  outcome?: Outcome;
  effects: Effect[];
}

const FLOW_INTENTS: readonly Intent[] = ["booking", "reschedule", "cancel"];

function hasField(fields: CallFields, f: RequiredField): boolean {
  switch (f) {
    case "service":
      return fields.serviceId !== undefined;
    case "requestedTime":
      return fields.requested !== undefined;
    case "name":
      return fields.name !== undefined;
    case "phone":
      return fields.phone !== undefined;
  }
}

const sameRequested = (a: CallFields["requested"], b: CallFields["requested"]) =>
  a?.date === b?.date && a?.time === b?.time;

/**
 * One Turn, decided by code. The model's turn supplies the words it heard and a
 * conversational line; every fact about bookings, times and availability comes
 * from the Booking_Rules and the phrase templates. Pure.
 */
export function decideTurn(input: DecideInput): Decision {
  const { turn, shop, pack, now } = input;
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const prev = input.state;
  const phraseSet = (lang: CallState["language"], turnNumber: number) =>
    phrases(lang, pack, shop, input.callId ? { callId: input.callId, turn: turnNumber } : undefined, now);

  if (prev.stage === "done") {
    const goodbye = phraseSet(prev.language, prev.turnCount).goodbye();
    return { state: prev, reply: goodbye.text, cacheable: goodbye.cacheable, fromModel: false, complete: true, effects: [] };
  }

  const merged = mergeFields(prev, turn, shop);
  const switched = turn.wantsLanguage !== null && turn.wantsLanguage !== prev.language;
  const s: CallState = {
    ...prev,
    language: switched && turn.wantsLanguage ? turn.wantsLanguage : prev.language,
    fields: merged.fields,
    note: { reason: turn.reason, urgency: turn.urgency },
    consecutiveInvalid: 0,
    turnCount: prev.turnCount + 1,
  };
  const P = phraseSet(s.language, s.turnCount);
  const tz = shop.timeZone;
  const ctx: RuleContext = {
    now,
    shop: toShopRules(shop),
    pack: { slotStepMin: pack.slotStepMin, rules: pack.rules },
    existing: input.existing,
  };

  const reply = (line: Said, model = false): Decision => ({
    state: s,
    reply: line.text,
    cacheable: line.cacheable,
    fromModel: model,
    complete: false,
    effects: [],
  });
  const say = (line: Said): Decision => reply(line);
  /** The model's own words: never cacheable. */
  const sayModel = (text: string): Decision => reply({ text, cacheable: false }, true);
  const end = (outcome: Outcome, line: Said, effects: Effect[] = [], booking?: MessageBooking): Decision => {
    s.stage = "done";
    s.pending = undefined;
    const message = buildOwnerMessage(s, outcome, shop, pack, booking);
    return {
      state: s,
      reply: line.text,
      cacheable: line.cacheable,
      fromModel: false,
      complete: true,
      outcome,
      effects: [...effects, { type: "saveMessage", message }],
    };
  };
  const offer = (alts: readonly { start: Temporal.Instant }[]) => {
    s.lastOffer = alts.length > 0 ? alts.map((a) => a.start.toString()) : undefined;
    return alts.map((a) => a.start);
  };
  /** The caller's own upcoming bookings: phone AND name must match (Booking_Match). */
  const myBookings = (): CallerBooking[] => {
    const { name, phone } = s.fields;
    if (!name || !phone) return [];
    return input.callerBookings
      .filter((b) => matchesCaller({ name, phone }, b) && Temporal.Instant.compare(b.start, now) >= 0)
      .sort((a, b) => Temporal.Instant.compare(a.start, b.start));
  };

  // 1. A pending read-back: only a "yes" in the awaiting_confirmation stage counts,
  //    and only if the caller did not change the service or the time in the same breath.
  if (prev.stage === "awaiting_confirmation" && prev.pending) {
    const changed =
      merged.unknownService !== null ||
      s.fields.serviceId !== prev.fields.serviceId ||
      !sameRequested(s.fields.requested, prev.fields.requested);
    if (turn.callerConfirmed && (!changed || prev.pending.kind === "cancel")) {
      return confirm(prev.pending);
    }
    s.stage = "collecting";
    s.pending = undefined;
  }

  // 2. The caller wants to end, or the Call reached its last Turn.
  if (turn.callerWantsToEnd) {
    const answered = (turn.intent === "question" || s.intent === "question") && !turn.outOfProfile;
    return end(answered ? "answered" : "message", P.goodbye());
  }
  if (s.turnCount >= maxTurns) return end("message", P.maxTurns());

  // 3. Intent: a question in the middle of a booking, reschedule or cancel keeps the flow.
  if (FLOW_INTENTS.includes(turn.intent)) {
    const lockedChange =
      prev.existingBookingId !== undefined && (prev.intent === "reschedule" || prev.intent === "cancel");
    s.intent = lockedChange && turn.intent === "booking" ? prev.intent : turn.intent;
  } else if (!FLOW_INTENTS.includes(prev.intent)) {
    s.intent = turn.intent;
  }

  // 4. Language switch and questions: the model's line.
  if (switched) return sayModel(turn.reply);
  if (turn.intent === "question" || turn.outOfProfile) return sayModel(turn.reply);

  // 5. The flows.
  if (s.intent === "booking") return bookingFlow();
  if (s.intent === "reschedule" || s.intent === "cancel") return changeFlow(s.intent);
  return sayModel(turn.reply);

  // -------------------------------------------------------------------------

  function requestedStart(): Temporal.Instant | null {
    const r = s.fields.requested;
    if (!r) return null;
    return toInstant(Temporal.PlainDate.from(r.date), Temporal.PlainTime.from(r.time), tz);
  }

  /** A day the model heard without a time, if it is a real date. */
  function heardDate(): Temporal.PlainDate | null {
    if (turn.date === null) return null;
    try {
      return Temporal.PlainDate.from(turn.date, { overflow: "reject" });
    } catch {
      return null;
    }
  }

  function bookingFlow(): Decision {
    // A name that is clearly not a name ("Mi amor") is not kept: the caller is asked once more,
    // once the time is accepted. After that one re-ask, whatever they say is taken.
    const heardName = s.fields.name;
    const suspectName =
      heardName !== undefined && heardName !== prev.fields.name && !prev.nameReasked && !looksLikeName(heardName);
    if (suspectName) s.fields.name = prev.fields.name;

    if (merged.unknownService !== null) return say(P.serviceNotOffered(merged.unknownService));
    const serviceId = s.fields.serviceId;
    const start = requestedStart();
    if (!serviceId) return sayModel(turn.reply);
    // Safety net (bugfix 2026-11-12): once the service is known, a missing day or time is
    // asked for by code. The model's own line here once told the caller the opening hours
    // instead of the code's rejection with alternatives, because it had left out a time
    // it judged impossible (Requirement 5.8).
    if (!start) return say(P.askDayAndTime(heardDate()));

    const v = checkBooking({ serviceId, start }, ctx);
    if (!v.ok) return say(P.rejected(v.reason, start, offer(v.alternatives)));
    s.lastOffer = undefined;

    // From here the time is accepted, so every missing field is asked by a template, in the
    // order of the pack, and the model's own line is never spoken (natural-voice 6.2).
    // A caller who switched service mid-booking first hears what the new one takes and costs.
    const switchedService = prev.fields.serviceId !== undefined && prev.fields.serviceId !== serviceId;
    const info = P.serviceInfo(serviceId);
    const withInfo = (line: Said): Said =>
      switchedService ? { text: `${info.text} ${line.text}`, cacheable: info.cacheable && line.cacheable } : line;

    if (suspectName && prev.fields.name === undefined) {
      s.nameReasked = true;
      return say(withInfo(P.askNameAgain()));
    }
    const next = pack.requiredFields.find((f) => !hasField(s.fields, f));
    if (next === "name") {
      const justAccepted = switchedService || !sameRequested(s.fields.requested, prev.fields.requested);
      return say(withInfo(justAccepted ? P.timeAcceptedAskName(v.start) : P.askName()));
    }
    if (next === "phone") return say(withInfo(P.askPhone()));
    const { name, phone } = s.fields;
    if (next !== undefined || !name || !phone) return sayModel(turn.reply);
    s.pending = { kind: "book", serviceId, start: v.start.toString() };
    s.stage = "awaiting_confirmation";
    return say(withInfo(P.readBack(serviceId, v.start, name, phone)));
  }

  function changeFlow(kind: "reschedule" | "cancel"): Decision {
    if (!s.fields.name || !s.fields.phone) return sayModel(turn.reply);
    const mine = myBookings();
    if (mine.length === 0) {
      s.existingBookingId = undefined;
      return say(P.bookingNotFound());
    }
    const known = mine.find((b) => b.id === prev.existingBookingId);
    const target = known ?? mine[0];
    s.existingBookingId = target.id;

    if (kind === "cancel") {
      s.pending = { kind: "cancel", bookingId: target.id };
      s.stage = "awaiting_confirmation";
      return say(P.cancelReadBack(target.serviceId, target.start));
    }
    // Reschedule: read the booking back first, then ask for the new time.
    if (!known) return say(P.existingForReschedule(target.serviceId, target.start));
    if (merged.unknownService !== null) return say(P.serviceNotOffered(merged.unknownService));
    const start = requestedStart();
    if (!start || start.equals(target.start)) return say(P.existingForReschedule(target.serviceId, target.start));
    const serviceId = s.fields.serviceId ?? target.serviceId;
    const v = checkBooking({ serviceId, start, ignoreBookingId: target.id }, ctx);
    if (!v.ok) return say(P.rejected(v.reason, start, offer(v.alternatives)));
    s.lastOffer = undefined;
    s.pending = { kind: "reschedule", serviceId, start: v.start.toString(), oldBookingId: target.id };
    s.stage = "awaiting_confirmation";
    return say(P.rescheduleReadBack(serviceId, v.start));
  }

  function confirm(pending: PendingAction): Decision {
    const { name, phone } = s.fields;
    s.stage = "collecting";
    s.pending = undefined;
    if (!name || !phone) return sayModel(turn.reply);

    if (pending.kind === "book") {
      const start = Temporal.Instant.from(pending.start);
      // Re-check against the bookings read from the database in this request.
      const v = checkBooking({ serviceId: pending.serviceId, start }, ctx);
      if (!v.ok) return say(P.slotJustTaken(start, offer(v.alternatives)));
      s.lastOffer = undefined;
      return end(
        "booked",
        P.booked(pending.serviceId, v.start),
        [{ type: "createBooking", verdict: v, serviceId: pending.serviceId, name, phone }],
        { serviceId: pending.serviceId, start: v.start, resourceId: v.resourceId },
      );
    }

    const targetId = pending.kind === "cancel" ? pending.bookingId : pending.oldBookingId;
    const target = myBookings().find((b) => b.id === targetId);
    if (!target) {
      s.existingBookingId = undefined;
      return say(P.bookingNotFound());
    }

    if (pending.kind === "cancel") {
      return end("cancelled", P.cancelled(), [{ type: "cancelBooking", bookingId: target.id }], {
        serviceId: target.serviceId,
        start: target.start,
        resourceId: target.resourceId,
      });
    }

    const start = Temporal.Instant.from(pending.start);
    const v = checkBooking({ serviceId: pending.serviceId, start, ignoreBookingId: target.id }, ctx);
    if (!v.ok) return say(P.slotJustTaken(start, offer(v.alternatives)));
    s.lastOffer = undefined;
    return end(
      "rescheduled",
      P.rescheduled(pending.serviceId, v.start),
      [{ type: "reschedule", oldBookingId: target.id, verdict: v, serviceId: pending.serviceId, name, phone }],
      { serviceId: pending.serviceId, start: v.start, resourceId: v.resourceId },
    );
  }
}

/** Requirement 3.5: what the browser may display. Derived from server state. */
export function publicStateOf(state: CallState, shop: ShopProfile, complete: boolean): PublicState {
  const service = shop.services.find((x) => x.id === state.fields.serviceId);
  const r = state.fields.requested;
  return {
    intent: state.intent,
    fields: {
      name: state.fields.name ?? null,
      phone: state.fields.phone ?? null,
      service: service ? service.name[state.language] : null,
      requestedTime: r ? `${r.date}T${r.time}` : null,
    },
    complete,
  };
}

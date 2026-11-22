import { Temporal } from "temporal-polyfill";
import { checkBooking, firstSlotsFrom, toInstant, type ExistingBooking, type RuleContext } from "@/lib/booking";
import { phrases, type Said } from "@/lib/receptionist/phrases";
import type { ModelTurn } from "@/lib/receptionist/schema";
import { splitSentences, MAX_TEMPLATE_SENTENCES } from "@/lib/receptionist/speech";
import type { RequiredField, SectorPack } from "@/lib/sectors";
import type { Reading } from "./brain/read";
import type { TopicHit } from "./brain/topics";
import { serviceView } from "./catalog";
import { factsFromModel, type TurnFacts } from "./facts";
import { mergeFields } from "./fields";
import { matchesCaller } from "./matchCaller";
import { looksLikeName } from "./names";
import { buildOwnerMessage, type MessageBooking } from "./ownerMessage";
import { toShopRules, type ShopProfile } from "./shopProfile";
import {
  MAX_OWNER_NOTES,
  type AnsweredTopic,
  type CallerBooking,
  type CallFields,
  type CallState,
  type Effect,
  type Intent,
  type Outcome,
  type OwnerNote,
  type PendingAction,
  type PublicState,
} from "./types";

export const DEFAULT_MAX_TURNS = 20;
/** The First_Offer starts at least this long after `now` (8.1). An offer preference, not a Booking_Rule. */
export const OFFER_LEAD_MIN = 30;
/** First_Offers in a row before the Receptionist asks for a day and time (8.5; design.md "The First_Offer"). */
export const MAX_DECLINES = 2;
/** Not-understood Turns in a row before an Owner_Note (10.3). */
export const MAX_MISSES = 3;
/** Profile_Topics kept for the Owner's reason (10.7). */
const MAX_TOPICS = 5;
/** Local start minutes of a part of the day (design.md, "The First_Offer"). */
const PART_OF_DAY = { morning: { fromMin: 0, toMin: 840 }, afternoon: { fromMin: 840, toMin: 1440 } } as const;

interface DecideCommon {
  state: CallState;
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
  /** The Code_Brain's Reading of the utterance, when there is one. */
  reading?: Reading | null;
  /** The Caller's words, only for an unanswered question's Owner_Note. */
  utterance?: string;
}

/**
 * `facts` from either Turn_Source (front-desk-brain 13.5), or a validated model `turn`, which is
 * turned into facts with `factsFromModel(turn, reading)`: the shape every core-call-loop test uses.
 * One of the two is required; `facts` wins when both are given.
 */
export interface DecideInput extends DecideCommon {
  facts?: TurnFacts;
  /** Already zod-validated. */
  turn?: ModelTurn;
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

const join = (...lines: Said[]): Said => ({
  text: lines.map((l) => l.text).filter((t) => t.trim() !== "").join(" "),
  cacheable: lines.every((l) => l.cacheable),
});

const sentenceCount = (text: string) => splitSentences(text).length;

/** The Owner's label of an answered topic. */
function topicKey(topic: TopicHit): AnsweredTopic {
  return topic.kind === "faq" ? `faq:${topic.id}` : topic.kind;
}

/**
 * One Turn, decided by code (front-desk-brain design.md, "decideTurn, step by step"). The facts
 * come from the model or from the Code_Brain; every fact about bookings, times, availability and
 * the shop comes from the Booking_Rules, the Shop_Profile and the phrase templates. The model's
 * own line is spoken only on the model path, for free conversation. Pure.
 */
export function decideTurn(input: DecideInput): Decision {
  const { shop, pack, now } = input;
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const prev = input.state;
  const given =
    input.facts ??
    (input.turn ? factsFromModel(input.turn, input.reading ?? null, shop, { state: prev, utterance: input.utterance }) : null);
  if (!given) throw new TypeError("decideTurn needs `facts` or a model `turn`");
  const facts: TurnFacts = given;
  const brain = facts.source === "brain";
  const phraseSet = (lang: CallState["language"], turnNumber: number) =>
    phrases(lang, pack, shop, input.callId ? { callId: input.callId, turn: turnNumber } : undefined, now);

  if (prev.stage === "done") {
    const goodbye = phraseSet(prev.language, prev.turnCount).goodbye();
    return { state: prev, reply: goodbye.text, cacheable: goodbye.cacheable, fromModel: false, complete: true, effects: [] };
  }

  const merged = mergeFields(prev, facts, shop);
  const switched = facts.wantsLanguage !== null && facts.wantsLanguage !== prev.language;
  const s: CallState = {
    ...prev,
    language: switched && facts.wantsLanguage ? facts.wantsLanguage : prev.language,
    fields: merged.fields,
    // The model's reason and suggestion; the brain path has neither, so the last model's stay (10.7, 5.8).
    note: facts.reason !== null && facts.urgency !== null ? { reason: facts.reason, urgency: facts.urgency } : prev.note,
    consecutiveInvalid: 0,
    turnCount: prev.turnCount + 1,
    ...(brain ? { brainTurns: (prev.brainTurns ?? 0) + 1 } : {}),
  };
  // 10.3: the misses are "in a row", so any Turn that placed something resets them.
  if (!facts.notUnderstood && (prev.misses ?? 0) > 0) s.misses = 0;
  // An offer was found for the Call's services; when they change, it no longer holds (9.2, 7.8).
  if (s.fields.serviceId !== prev.fields.serviceId && !merged.offerAccepted) {
    s.lastOffer = undefined;
    s.offerKind = undefined;
    s.declined = undefined;
  }
  const P = phraseSet(s.language, s.turnCount);
  const tz = shop.timeZone;
  const ctx: RuleContext = {
    now,
    shop: toShopRules(shop),
    pack: { slotStepMin: pack.slotStepMin, rules: pack.rules },
    existing: input.existing,
  };
  /** The offer's question alone, when an offer was just made: what a prefixed reply falls back to. */
  let shortLine: Said | null = null;

  const reply = (line: Said, model = false): Decision => ({
    state: s,
    reply: line.text,
    cacheable: line.cacheable,
    fromModel: model,
    complete: false,
    effects: [],
  });
  const say = (line: Said): Decision => reply(line);
  /** The model's own words: never cacheable. On the brain path there are none, so the template speaks. */
  const sayModelOr = (template: Said): Decision =>
    facts.modelReply !== null ? reply({ text: facts.modelReply, cacheable: false }, true) : say(template);
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
  const clearOffer = () => {
    s.lastOffer = undefined;
    s.offerKind = undefined;
    s.declined = undefined;
  };
  const offer = (alts: readonly { start: Temporal.Instant }[]) => {
    s.lastOffer = alts.length > 0 ? alts.map((a) => a.start.toString()) : undefined;
    s.offerKind = alts.length > 0 ? "alternatives" : undefined;
    s.declined = undefined;
    return alts.map((a) => a.start);
  };
  const addNote = (note: OwnerNote) => {
    const notes = s.notes ?? [];
    if (notes.length < MAX_OWNER_NOTES) s.notes = [...notes, note];
  };
  const addTopic = (topic: TopicHit) => {
    const key = topicKey(topic);
    const topics = s.topics ?? [];
    if (!topics.includes(key) && topics.length < MAX_TOPICS) s.topics = [...topics, key];
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
    if (facts.yes && (!changed || prev.pending.kind === "cancel")) {
      return confirm(prev.pending);
    }
    s.stage = "collecting";
    s.pending = undefined;
    // A plain "no" to the read-back on the brain path: ask for another time, or keep the booking.
    if (brain && facts.no && !changed && !facts.wantsToEnd) {
      if (prev.pending.kind === "cancel") return say(P.smallTalk("no"));
      s.fields = { ...s.fields };
      delete s.fields.requested;
      clearOffer();
      return say(P.askDayAndTime(null));
    }
  }

  // 2. The caller wants to end, or the Call reached its last Turn.
  if (facts.wantsToEnd) {
    const asked = facts.intent === "question" || s.intent === "question" || (s.topics?.length ?? 0) > 0;
    const answered = asked && !facts.outOfProfile && (s.notes?.length ?? 0) === 0;
    return end(answered ? "answered" : "message", P.goodbye());
  }
  if (s.turnCount >= maxTurns) return end("message", P.maxTurns());

  // 3. Intent: a question in the middle of a booking, reschedule or cancel keeps the flow.
  if (FLOW_INTENTS.includes(facts.intent)) {
    const lockedChange =
      prev.existingBookingId !== undefined && (prev.intent === "reschedule" || prev.intent === "cancel");
    s.intent = lockedChange && facts.intent === "booking" ? prev.intent : facts.intent;
  } else if (!FLOW_INTENTS.includes(prev.intent)) {
    s.intent = facts.intent;
  }

  /** A booking, reschedule or cancel was already under way before this Turn. */
  const flowOpen = FLOW_INTENTS.includes(prev.intent);
  /**
   * This utterance itself carries flow content (3.3). With a Profile_Topic, the topic's own words
   * do not count: "¿cuánto cuesta un corte?" names a service and "¿a qué hora abrís el sábado?"
   * has the booking word "hora" and a day, but both are questions, not requests (9.1). A topic
   * starts a booking only with facts of its own: a time, a name, a phone, or services that are
   * not the subject of a price or duration question.
   */
  const topicIsAboutServices = facts.topic !== null && (facts.topic.kind === "price" || facts.topic.kind === "duration");
  const ownFlowFacts =
    facts.intent !== "booking" ||
    facts.time !== null ||
    facts.name !== null ||
    facts.phone !== null ||
    (facts.serviceChange.next !== null && !topicIsAboutServices);
  const startsFlow = FLOW_INTENTS.includes(facts.intent) && (facts.topic === null || ownFlowFacts);

  // 4.–8. Notes and answers, with the flow's next line after them when a flow is open.
  // An Owner_Request or a Sensitive_Hit is a note, never a booking request: "me ha dado alergia
  // el tinte" must not make the colour the Call's service, so those Turns keep the flow as it was.
  if (facts.ownerRequest) {
    addNote({ kind: "owner_request" });
    return noted(P.ownerNoted(true), P.ownerNoted(), false);
  }
  if (facts.sensitive) {
    addNote({ kind: "sensitive", term: facts.sensitive.term });
    return noted(P.sensitiveNoted(true), P.sensitiveNoted(), false);
  }
  if (switched) {
    const Pbefore = phraseSet(prev.language, s.turnCount);
    if (facts.topic) {
      addTopic(facts.topic);
      return say(join(Pbefore.topicAnswer(facts.topic), P.languageSwitched()));
    }
    return sayModelOr(P.languageSwitched());
  }
  if (facts.topic) {
    // 13.3: a Profile_Topic is answered from the profile even when the model said outOfProfile.
    addTopic(facts.topic);
    const answer = P.topicAnswer(facts.topic);
    if (!startsFlow) s.intent = flowOpen ? prev.intent : "question";
    return noted(answer, answer);
  }
  if (facts.intent === "question" || facts.outOfProfile) {
    if (!brain) return sayModelOr(P.unknownKeepAlive());
    addNote({ kind: "unanswered", question: facts.unansweredQuestion ?? "" });
    return noted(P.unknownKeepAlive(true), P.unknownKeepAlive());
  }

  // 10. (brain) Nothing placed: the miss counter; small talk with nothing open.
  if (brain) {
    if (facts.notUnderstood) {
      s.misses = (prev.misses ?? 0) + 1;
      if (s.misses >= MAX_MISSES) {
        s.misses = 0;
        addNote({ kind: "not_understood" });
        return say(P.notUnderstoodAgain());
      }
      if (!flowOpen) return say(P.notUnderstood());
    }
    if (!FLOW_INTENTS.includes(s.intent)) {
      if (facts.smallTalk) return say(P.smallTalk(facts.smallTalk));
      if (facts.no) return say(P.smallTalk("no"));
      return say(P.askService());
    }
  }

  // 9. The flows.
  if (s.intent === "booking") return bookingFlow();
  if (s.intent === "reschedule" || s.intent === "cancel") return changeFlow(s.intent);
  return sayModelOr(P.askService());

  // -------------------------------------------------------------------------

  /**
   * A note or an answer (`prefix`), then the flow: with this utterance's facts when it carries
   * flow content (3.3), else the open flow's next question with the flow state as it was (9.6).
   * With no flow, `alone`.
   */
  function noted(prefix: Said, alone: Said, takeFacts = true): Decision {
    if (takeFacts && startsFlow)
      return prepend(prefix, s.intent === "booking" ? bookingFlow() : changeFlow(s.intent as "reschedule" | "cancel"));
    if (!takeFacts) keepFlow();
    if (flowOpen) {
      keepFlow();
      return say(join(prefix, nextQuestion()));
    }
    return say(alone);
  }

  /** A prefix and the flow's reply, in at most 3 sentences: the flow's closing question alone if needed. */
  function prepend(prefix: Said, d: Decision): Decision {
    if (d.fromModel || d.complete) return d;
    const line: Said = { text: d.reply, cacheable: d.cacheable };
    if (sentenceCount(prefix.text) + sentenceCount(d.reply) <= MAX_TEMPLATE_SENTENCES) return say(join(prefix, line));
    if (shortLine) return say(join(prefix, shortLine));
    // A read-back is never shortened: the caller must hear what they confirm.
    if (s.stage === "awaiting_confirmation") return d;
    const last = splitSentences(d.reply).at(-1)?.trim() ?? "";
    if (last.endsWith("?") && sentenceCount(prefix.text) < MAX_TEMPLATE_SENTENCES) {
      return say(join(prefix, { text: last, cacheable: d.cacheable }));
    }
    return d;
  }

  /** The flow as it was before this Turn: a question in the middle does not change it (9.6). */
  function keepFlow(): void {
    s.stage = prev.stage === "done" ? "collecting" : prev.stage;
    s.pending = prev.pending;
    s.fields = prev.fields;
    s.lastOffer = prev.lastOffer;
    s.offerKind = prev.offerKind;
    s.declined = prev.declined;
    s.existingBookingId = prev.existingBookingId;
    s.intent = prev.intent;
  }

  /** The open flow's next question, without its facts changing (9.6). */
  function nextQuestion(): Said {
    if (s.stage === "awaiting_confirmation" && s.pending) return P.confirmAgain();
    const f = s.fields;
    if (s.intent !== "booking") {
      if (!f.name) return P.askName();
      if (!f.phone) return P.askPhone();
      return s.intent === "reschedule" ? P.askDayAndTime(null) : P.smallTalk("no");
    }
    if (!f.serviceId) return f.serviceChoice ? P.askServiceChoice(f.serviceChoice.candidates) : P.askService(true);
    if (s.lastOffer?.length) return P.offerAgain(Temporal.Instant.from(s.lastOffer[0]));
    if (!f.requested) {
      const slot = offerSlot(f.serviceId, 0);
      if (!slot) return P.askDayAndTime(dayOf(f));
      s.lastOffer = [slot.toString()];
      s.offerKind = "first";
      s.declined = 0;
      return P.offerAgain(slot);
    }
    const next = pack.requiredFields.find((x) => !hasField(f, x));
    if (next === "name") return P.askName();
    if (next === "phone") return P.askPhone();
    return P.askDayAndTime(null);
  }

  function dayOf(f: CallFields): Temporal.PlainDate | null {
    return f.day ? Temporal.PlainDate.from(f.day) : null;
  }

  function requestedStart(): Temporal.Instant | null {
    const r = s.fields.requested;
    if (!r) return null;
    return toInstant(Temporal.PlainDate.from(r.date), Temporal.PlainTime.from(r.time), tz);
  }

  /**
   * The `index`-th slot the Booking_Rules accept from the later of `now` + 30 minutes (rounded up
   * to the pack's step) and the start of the day asked for, inside the part of the day (8.1–8.3).
   */
  function offerSlot(serviceId: string, index: number): Temporal.Instant | null {
    const step = Math.max(1, pack.slotStepMin);
    const earliest = now.add({ minutes: OFFER_LEAD_MIN });
    // Rounded up to the step in local wall time, so a DST day does not shift it by an hour.
    const lead = earliest.toZonedDateTimeISO(tz);
    const exact = lead.second === 0 && lead.millisecond === 0 && lead.microsecond === 0 && lead.nanosecond === 0;
    const total = Math.ceil((lead.hour * 60 + lead.minute + (exact ? 0 : 1)) / step) * step;
    const date = lead.toPlainDate().add({ days: Math.floor(total / 1440) });
    const m = total % 1440;
    let from = toInstant(date, Temporal.PlainTime.from({ hour: Math.floor(m / 60), minute: m % 60 }), tz);
    if (Temporal.Instant.compare(from, earliest) < 0) from = earliest;
    const day = dayOf(s.fields);
    if (day) {
      const startOfDay = day.toZonedDateTime({ timeZone: tz }).toInstant();
      if (Temporal.Instant.compare(startOfDay, from) > 0) from = startOfDay;
    }
    const part = s.fields.partOfDay;
    const slots = firstSlotsFrom({ serviceId, from }, ctx, {
      limit: index + 1,
      ...(part ? { within: PART_OF_DAY[part] } : {}),
    });
    return slots[index]?.start ?? null;
  }

  /** The First_Offer, the next one after a "no", and the ask after two (8.1, 8.3, 8.5). */
  function firstOffer(serviceId: string): Decision {
    const newWhen = facts.date !== null || facts.time !== null || facts.partOfDay !== null;
    const sameRequest = prev.offerKind === "first" && (prev.lastOffer?.length ?? 0) > 0 && prev.fields.serviceId === serviceId && !newWhen;
    const declined = sameRequest ? (prev.declined ?? 0) + (facts.no ? 1 : 0) : 0;
    if (declined >= MAX_DECLINES) {
      clearOffer();
      return say(P.askDayAndTime(dayOf(s.fields)));
    }
    const slot = offerSlot(serviceId, declined);
    if (!slot) {
      clearOffer();
      return say(P.noSlotNearby());
    }
    s.lastOffer = [slot.toString()];
    s.offerKind = "first";
    s.declined = declined;
    shortLine = P.offerAgain(slot);
    return say(P.firstOffer(serviceId, slot));
  }

  function bookingFlow(): Decision {
    // A name that is clearly not a name ("Mi amor") is not kept: the caller is asked once more,
    // once the time is accepted. After that one re-ask, whatever they say is taken.
    const heardName = s.fields.name;
    const suspectName =
      heardName !== undefined && heardName !== prev.fields.name && !prev.nameReasked && !looksLikeName(heardName);
    if (suspectName) s.fields.name = prev.fields.name;

    if (merged.comboRefused || facts.serviceChange.tooMany) return say(P.tooManyServices());
    if (merged.unknownService !== null) return say(P.serviceNotOffered(merged.unknownService));

    // "sin el corte": the base and its Add_Ons go together, and the reply says so (4.10, 7.8).
    const addOns = facts.serviceChange.removedAddOns;
    const bases = facts.serviceChange.removed.filter((id) => !addOns.includes(id));
    const removal = addOns.length > 0 && bases.length > 0 ? P.addOnRemoved(addOns, bases, true) : null;
    if (removal && !s.fields.serviceId) return say(P.addOnRemoved(addOns, bases));
    const withRemoval = (d: Decision): Decision => (removal ? prepend(removal, d) : d);

    const serviceId = s.fields.serviceId;
    if (!serviceId) {
      if (s.fields.serviceChoice) return say(P.askServiceChoice(s.fields.serviceChoice.candidates));
      return sayModelOr(P.askService());
    }
    // A "no" to the alternatives of a rejection, with nothing new: ask for a day and time.
    if (brain && facts.no && prev.offerKind === "alternatives" && facts.date === null && facts.time === null && facts.partOfDay === null) {
      s.fields = { ...s.fields };
      delete s.fields.requested;
      clearOffer();
      return withRemoval(say(P.askDayAndTime(dayOf(s.fields))));
    }
    const start = requestedStart();
    if (!start) {
      // A time with no day at all: the code asks for the day (Requirement 5.8 still holds).
      if (facts.time !== null && facts.date === null && !s.fields.day) return withRemoval(say(P.askDayAndTime(null)));
      // Once the services are known, the code offers the nearest free slot (8.1; was "¿Qué día y a qué hora?").
      return withRemoval(firstOffer(serviceId));
    }

    const v = checkBooking({ serviceId, start }, ctx);
    if (!v.ok) return withRemoval(say(P.rejected(v.reason, start, offer(v.alternatives))));
    clearOffer();

    // From here the time is accepted, so every missing field is asked by a template, in the
    // order of the pack, and the model's own line is never spoken (natural-voice 6.2).
    // A caller who switched service mid-booking first hears what the new one takes and costs.
    const switchedService = prev.fields.serviceId !== undefined && prev.fields.serviceId !== serviceId;
    const info = P.serviceInfo(serviceId);
    const withInfo = (line: Said): Said => (switchedService && !removal ? join(info, line) : line);

    if (suspectName && prev.fields.name === undefined) {
      s.nameReasked = true;
      return withRemoval(say(withInfo(P.askNameAgain())));
    }
    const next = pack.requiredFields.find((f) => !hasField(s.fields, f));
    if (next === "name") {
      const justAccepted = switchedService || !sameRequested(s.fields.requested, prev.fields.requested);
      return withRemoval(say(withInfo(justAccepted ? P.timeAcceptedAskName(v.start) : P.askName())));
    }
    if (next === "phone") return withRemoval(say(withInfo(brain && facts.phoneRejected ? P.phoneAgain() : P.askPhone())));
    const { name, phone } = s.fields;
    if (next !== undefined || !name || !phone) return sayModelOr(name ? P.askPhone() : P.askName());
    s.pending = { kind: "book", serviceId, start: v.start.toString() };
    s.stage = "awaiting_confirmation";
    return withRemoval(say(withInfo(P.readBack(serviceId, v.start, name, phone))));
  }

  function changeFlow(kind: "reschedule" | "cancel"): Decision {
    if (!s.fields.name || !s.fields.phone) {
      const missing = !s.fields.name ? P.askName() : brain && facts.phoneRejected ? P.phoneAgain() : P.askPhone();
      return sayModelOr(missing);
    }
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
    // 7.7: a reschedule keeps all the parts of a Service_Combo.
    const serviceId = s.fields.serviceId ?? target.serviceId;
    const v = checkBooking({ serviceId, start, ignoreBookingId: target.id }, ctx);
    if (!v.ok) return say(P.rejected(v.reason, start, offer(v.alternatives)));
    clearOffer();
    s.pending = { kind: "reschedule", serviceId, start: v.start.toString(), oldBookingId: target.id };
    s.stage = "awaiting_confirmation";
    return say(P.rescheduleReadBack(serviceId, v.start));
  }

  function confirm(pending: PendingAction): Decision {
    const { name, phone } = s.fields;
    s.stage = "collecting";
    s.pending = undefined;
    if (!name || !phone) return sayModelOr(name ? P.askPhone() : P.askName());

    if (pending.kind === "book") {
      const start = Temporal.Instant.from(pending.start);
      // Re-check against the bookings read from the database in this request.
      const v = checkBooking({ serviceId: pending.serviceId, start }, ctx);
      if (!v.ok) return say(P.slotJustTaken(start, offer(v.alternatives)));
      clearOffer();
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
    clearOffer();
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
  const id = state.fields.serviceId;
  const view = id === undefined ? null : serviceView(id, shop);
  const r = state.fields.requested;
  return {
    intent: state.intent,
    fields: {
      name: state.fields.name ?? null,
      phone: state.fields.phone ?? null,
      // A Service_Combo by its parts ("Corte de hombre + Degradado"); an id outside the catalog shows nothing.
      service: view?.known ? view.name[state.language] : null,
      requestedTime: r ? `${r.date}T${r.time}` : null,
    },
    complete,
  };
}

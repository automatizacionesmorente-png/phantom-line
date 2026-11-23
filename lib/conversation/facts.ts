import type { ModelTurn } from "@/lib/receptionist/schema";
import type { Lang } from "@/lib/sectors";
import type { Reading } from "./brain/read";
import { matchServices, servicesOfCall, type ServiceMatch, type ServiceRequest } from "./brain/services";
import type { TopicHit } from "./brain/topics";
import type { ShopProfile } from "./shopProfile";
import { MAX_NOTE_QUESTION, type CallState, type Intent, type Urgency } from "./types";

/**
 * What one Turn said, from either reader (front-desk-brain 13; design.md "The Reading and the
 * TurnFacts", "Who decides what"). `decideTurn` reads only this, so both Turn_Sources go through
 * the same Booking_Rules, read-back and confirmation rules (13.5). Pure.
 */
export interface TurnFacts {
  source: "model" | "brain";
  /** The model's own line; null on the brain path, so decideTurn can never speak model text it does not have. */
  modelReply: string | null;
  intent: Intent;
  wantsLanguage: Lang | null;
  services: ServiceRequest;
  /**
   * What `services` does to the Call's services: the list after this utterance (null when it does
   * not change them), the services and Add_Ons removed, the 3-part cap, and an answered
   * Service_Choice. An addition to the design's sketch: `decideTurn` needs it on both paths.
   */
  serviceChange: Pick<ServiceMatch, "next" | "removed" | "removedAddOns" | "tooMany" | "choiceAnswered">;
  /** Shop-local YYYY-MM-DD. */
  date: string | null;
  /** Shop-local HH:MM. */
  time: string | null;
  partOfDay: "morning" | "afternoon" | null;
  name: string | null;
  /** Raw on the model path (mergeFields normalizes), E.164 on the brain path. */
  phone: string | null;
  /** Digits were heard but `normalizePhone` refused them (6.5). Brain path only. */
  phoneRejected: boolean;
  yes: boolean;
  no: boolean;
  wantsToEnd: boolean;
  outOfProfile: boolean;
  topic: TopicHit | null;
  ownerRequest: boolean;
  sensitive: Reading["sensitive"];
  /** Nothing in the utterance could be placed (10.3). Brain path only. */
  notUnderstood: boolean;
  /** Only a thanks or a greeting, nothing else. Brain path only. */
  smallTalk: "thanks" | "greeting" | null;
  /** The Caller's words, truncated to 160, only for the Owner_Note. */
  unansweredQuestion: string | null;
  /** The model's reason; null on the brain path. */
  reason: string | null;
  /** The model's suggestion; null on the brain path. */
  urgency: Urgency | null;
}

const NO_CHANGE: TurnFacts["serviceChange"] = { next: null, removed: [], removedAddOns: [], tooMany: false, choiceAnswered: false };

/** The Caller's words for an Owner_Note: one line, at most 160 characters (10.5). */
export function noteQuestion(utterance: string): string {
  const line = utterance.replace(/\s+/g, " ").trim();
  return line.length <= MAX_NOTE_QUESTION ? line : `${line.slice(0, MAX_NOTE_QUESTION - 1).trimEnd()}…`;
}

const changeOf = (m: Pick<ServiceMatch, keyof TurnFacts["serviceChange"]>): TurnFacts["serviceChange"] => ({
  next: m.next,
  removed: m.removed,
  removedAddOns: m.removedAddOns,
  tooMany: m.tooMany,
  choiceAnswered: m.choiceAnswered,
});

/** The core-call-loop Intent of a Reading, by the order of Requirement 3.3: cancel, reschedule, booking, a question. */
function intentOf(reading: Reading): Intent {
  if (reading.intents.includes("cancel")) return "cancel";
  if (reading.intents.includes("reschedule")) return "reschedule";
  if (reading.intents.includes("booking")) return "booking";
  if (reading.intents.includes("question")) return "question";
  return "other";
}

/** True when the Reading placed nothing at all (10.3). */
function placedNothing(reading: Reading): boolean {
  return (
    reading.intents.length === 1 &&
    reading.intents[0] === "unknown" &&
    !reading.question &&
    reading.services.kind === "none" &&
    reading.serviceChange.next === null &&
    reading.day === null &&
    reading.time === null &&
    reading.partOfDay === null &&
    reading.name === null &&
    reading.phone === null &&
    !reading.phoneRejected &&
    !reading.yes &&
    !reading.no &&
    reading.topic === null &&
    reading.sensitive === null
  );
}

const ONLY_SMALL_TALK = new Set(["thanks", "greeting"]);

/**
 * The brain path: every fact from the Reading, no model text (design.md, "Who decides what",
 * column `brain`). `utterance` is only used for an unanswered question's Owner_Note.
 */
export function factsFromReading(reading: Reading, utterance = ""): TurnFacts {
  const intent = intentOf(reading);
  const unanswered = intent === "question" && reading.topic === null && !reading.ownerRequest && reading.sensitive === null;
  const others = reading.intents.filter((x) => !ONLY_SMALL_TALK.has(x));
  const plain =
    others.length === 0 &&
    reading.name === null &&
    reading.phone === null &&
    reading.services.kind === "none" &&
    reading.day === null &&
    reading.time === null &&
    reading.partOfDay === null;
  const smallTalk = plain && reading.intents.includes("thanks") ? "thanks" : plain && reading.intents.includes("greeting") ? "greeting" : null;
  return {
    source: "brain",
    modelReply: null,
    intent,
    wantsLanguage: reading.wantsLanguage,
    services: reading.services,
    serviceChange: changeOf(reading.serviceChange),
    date: reading.day?.toString() ?? null,
    time: reading.time ? reading.time.toString().slice(0, 5) : null,
    partOfDay: reading.partOfDay,
    name: reading.name,
    phone: reading.phone,
    phoneRejected: reading.phoneRejected,
    yes: reading.yes,
    no: reading.no,
    wantsToEnd: reading.intents.includes("goodbye"),
    outOfProfile: unanswered,
    topic: reading.topic,
    ownerRequest: reading.ownerRequest,
    sensitive: reading.sensitive,
    notUnderstood: placedNothing(reading),
    smallTalk,
    unansweredQuestion: unanswered && utterance.trim() !== "" ? noteQuestion(utterance) : null,
    reason: null,
    urgency: null,
  };
}

export interface ModelFactsOptions {
  /** The Call before this Turn: its services break ties and take additions (4.4(c), 4.7). */
  state?: CallState;
  /** The Caller's words, only for an unanswered question's Owner_Note. */
  utterance?: string;
}

/**
 * The model path (design.md, "Who decides what", column `model`): the model's intent, day,
 * time, name, phone, yes, goodbye and language switch, and its line for free conversation. The
 * Reading, when there is one, still decides the services it found, the Profile_Topic, an
 * Owner_Request and a Sensitive_Hit (13.2); without one the model's service words go through
 * the same matcher (4.9).
 */
export function factsFromModel(
  turn: ModelTurn,
  reading: Reading | null,
  shop: ShopProfile,
  opts: ModelFactsOptions = {},
): TurnFacts {
  let services: ServiceRequest;
  let serviceChange: TurnFacts["serviceChange"];
  if (reading && (reading.services.kind !== "none" || reading.serviceChange.next !== null)) {
    services = reading.services;
    serviceChange = changeOf(reading.serviceChange);
  } else if (turn.service !== null) {
    const m = matchServices(turn.service, shop, {
      current: servicesOfCall(opts.state?.fields.serviceId),
      choice: opts.state?.fields.serviceChoice ?? null,
    });
    services = m.request.kind === "none" ? { kind: "unknown", said: turn.service.trim() } : m.request;
    serviceChange = m.request.kind === "none" ? NO_CHANGE : changeOf(m);
  } else {
    services = { kind: "none" };
    serviceChange = NO_CHANGE;
  }
  const topic = reading?.topic ?? null;
  const unanswered = turn.outOfProfile && topic === null;
  // A question with no Profile_Topic is not answered from the profile either, whatever the model said.
  const unansweredQuestion = (unanswered || (turn.intent === "question" && topic === null)) && opts.utterance;
  // The model placed nothing: no intent, field, question, language switch or goodbye, and the Reading found nothing either.
  const notUnderstood =
    turn.intent === "other" &&
    !turn.outOfProfile &&
    !turn.callerWantsToEnd &&
    !turn.callerConfirmed &&
    turn.wantsLanguage === null &&
    turn.name === null &&
    turn.phone === null &&
    turn.date === null &&
    turn.time === null &&
    turn.service === null &&
    services.kind === "none" &&
    (reading === null || placedNothing(reading));
  return {
    source: "model",
    modelReply: turn.reply,
    intent: turn.intent,
    wantsLanguage: turn.wantsLanguage,
    services,
    serviceChange,
    date: turn.date,
    time: turn.time,
    partOfDay: reading?.partOfDay ?? null,
    name: turn.name,
    phone: turn.phone,
    phoneRejected: false,
    yes: turn.callerConfirmed,
    no: reading?.no ?? false,
    wantsToEnd: turn.callerWantsToEnd,
    outOfProfile: unanswered,
    topic,
    ownerRequest: reading?.ownerRequest ?? false,
    sensitive: reading?.sensitive ?? null,
    notUnderstood,
    smallTalk: null,
    unansweredQuestion: unansweredQuestion ? noteQuestion(opts.utterance as string) : null,
    reason: turn.reason,
    urgency: turn.urgency,
  };
}

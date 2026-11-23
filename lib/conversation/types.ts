import type { Temporal } from "temporal-polyfill";
import type { AcceptedVerdict, ExistingBooking } from "@/lib/booking";
import type { Lang } from "@/lib/sectors";
import type { FinalUrgency, UrgencyBasis } from "@/lib/messages/urgency";
import type { ShopProfile } from "./shopProfile";
import type { FallbackLogger } from "./fallbackLog";

export type { Lang } from "@/lib/sectors";
export type Channel = "voice" | "whatsapp" | "webchat";
export type Intent = "booking" | "reschedule" | "cancel" | "question" | "order" | "other";
export type Urgency = "low" | "normal" | "urgent";
export type Outcome = "booked" | "rescheduled" | "cancelled" | "answered" | "message" | "fallback" | "abandoned";

export interface Line {
  caller: string;
  receptionist: string;
}

// ---------------------------------------------------------------------------
// The one function every channel calls

export type TurnInput =
  | { kind: "start"; channel: Channel; shop: ShopProfile; language: Lang; visitorKey: string }
  | {
      kind: "say";
      channel: Channel;
      shop: ShopProfile;
      language: Lang;
      visitorKey: string;
      callId: string;
      utterance: string;
      conversation: readonly Line[];
    }
  | { kind: "hangup"; channel: Channel; shop: ShopProfile; callId: string };

/** Requirement 3.5: derived on the server, for display only. */
export interface PublicState {
  intent: Intent;
  fields: { name: string | null; phone: string | null; service: string | null; requestedTime: string | null };
  complete: boolean;
}

export interface TurnOutput {
  callId: string;
  /** What to say or show. */
  reply: string;
  /**
   * Whether the audio of `reply` may be stored and replayed for other callers: false for any
   * line with a name or a phone, and for the model's own words (natural-voice 6.5). Signed
   * into the speech token by the voice adapter (task 8).
   */
  cacheable: boolean;
  /** May change if the caller asked to switch. */
  language: Lang;
  state: PublicState;
  complete: boolean;
  /** Set when complete. */
  outcome?: Outcome;
}

// ---------------------------------------------------------------------------
// Server-owned Call state (stored in calls.state; the browser never sends it)

export type PendingAction =
  | { kind: "book"; serviceId: string; start: string /* ISO instant */ }
  | { kind: "reschedule"; serviceId: string; start: string; oldBookingId: string }
  | { kind: "cancel"; bookingId: string };

export interface CallFields {
  name?: string;
  /** E.164. */
  phone?: string;
  serviceId?: string;
  /** Shop-local date "YYYY-MM-DD" and time "HH:MM". */
  requested?: { date: string; time: string };
  /** An open Service_Choice (front-desk-brain 4.5): the candidates, and the other services said with it. */
  serviceChoice?: { candidates: string[]; with: string[] };
  /** A day heard without a time, "YYYY-MM-DD" (front-desk-brain 5.6). */
  day?: string;
  /** Narrows the First_Offer (front-desk-brain 5.4, 8.3). */
  partOfDay?: "morning" | "afternoon";
}

/**
 * Something the Receptionist could not do and noted for the Owner during the Call
 * (front-desk-brain 10.5). It goes into the Call's Message, never into the server log.
 */
export type OwnerNote =
  | { kind: "owner_request" }
  /** `term` is the pack's urgent term or sensitive word, not the Caller's sentence. */
  | { kind: "sensitive"; term: string }
  /** The Caller's words, at most `MAX_NOTE_QUESTION` characters. */
  | { kind: "unanswered"; question: string }
  | { kind: "not_understood" };

/** At most this many Owner_Notes per Call (design.md, "New CallState fields"). */
export const MAX_OWNER_NOTES = 5;
/** An unanswered question is kept to this many characters (10.5). */
export const MAX_NOTE_QUESTION = 160;

/** A Profile_Topic the Receptionist answered, for the Owner's code-built reason (10.7): a built-in kind or an FAQ id. */
export type AnsweredTopic = "hours" | "address" | "services" | "price" | "duration" | `faq:${string}`;

export interface CallState {
  stage: "collecting" | "awaiting_confirmation" | "done";
  intent: Intent;
  language: Lang;
  fields: CallFields;
  /** What the read-back asked the caller to confirm. */
  pending?: PendingAction;
  /** ISO instants of the alternatives just offered, so "vale, a las siete y media" resolves. */
  lastOffer?: string[];
  /** What `lastOffer` holds: the First_Offer, or the alternatives of a rejection (front-desk-brain 8.4, 8.5). */
  offerKind?: "first" | "alternatives";
  /** First_Offers declined in a row (8.5). */
  declined?: number;
  /** The Owner_Notes of the Call, at most `MAX_OWNER_NOTES` (10.5). */
  notes?: OwnerNote[];
  /** Profile_Topics answered in the Call, for the code-built reason (10.7); at most 5, first ones kept. */
  topics?: AnsweredTopic[];
  /** Not-understood Turns in a row (10.3). */
  misses?: number;
  /** The Caller was asked for a name and phone because an Owner_Note promised a call back (backlog 20). */
  callbackAsked?: boolean;
  /**
   * Turns whose facts came from the Code_Brain (1.6). Counted by `decideTurn`. The design's
   * `modelTurns` is not stored: only a valid model Turn writes `note.reason`, so an empty
   * reason already means "no Suggested_Urgency" (`suggestedFrom`, owner-machine 5.8).
   */
  brainTurns?: number;
  /** Passed the Booking_Match (phone AND name) for reschedule / cancel. */
  existingBookingId?: string;
  note: { reason: string; urgency: Urgency };
  consecutiveInvalid: number;
  modelFailed: boolean;
  turnCount: number;
  /** The caller was already asked once more for a name that did not look like one (natural-voice 6.2). */
  nameReasked?: boolean;
}

// ---------------------------------------------------------------------------
// Owner message and effects

/** The texts of a Message every end-of-Call path shares. */
interface OwnerMessageTexts {
  callerName: string | null;
  callerPhone: string | null;
  reason: string;
  agreed: string;
  suggestedReply: string;
  outcome: Outcome;
  modelFailed: boolean;
}

/**
 * What `buildOwnerMessage` returns: the texts plus what the Urgency_Rules need.
 * It has no final urgency, so it cannot be written as it is (owner-machine 4.1).
 */
export interface OwnerMessageDraft extends OwnerMessageTexts {
  /** The model's Suggested_Urgency; null when the model never gave a valid Turn (5.8). */
  suggested: Urgency | null;
  /** Shop-local, from `CallState.fields.requested`. */
  requestedDate: Temporal.PlainDate | null;
  /** The Booking the Call created, moved or cancelled. */
  bookingStart: Temporal.Instant | null;
}

/** A Message ready to store. Only `decideUrgency` makes a `FinalUrgency`, so only `messageWrite` makes one of these. */
export interface OwnerMessage extends OwnerMessageTexts {
  urgency: FinalUrgency;
  urgencySuggested: Urgency | null;
  /** Null only in rows written before owner-machine (and in database test fixtures). */
  urgencyBasis: UrgencyBasis | null;
}

export type Effect =
  | { type: "createBooking"; verdict: AcceptedVerdict; serviceId: string; name: string; phone: string }
  | {
      type: "reschedule";
      oldBookingId: string;
      verdict: AcceptedVerdict;
      serviceId: string;
      name: string;
      phone: string;
    }
  | { type: "cancelBooking"; bookingId: string }
  | { type: "saveMessage"; message: OwnerMessageDraft };

/** An upcoming, confirmed booking for the caller's phone, as read from the database. */
export interface CallerBooking extends ExistingBooking {
  serviceId: string;
  customerName: string;
  /** E.164. */
  customerPhone: string;
}

// ---------------------------------------------------------------------------
// Ports (implemented in lib/db and lib/receptionist; faked in tests)

export interface StoredCall {
  id: string;
  shopId: string;
  channel: Channel;
  language: Lang;
  status: "open" | "completed" | "abandoned" | "failed";
  state: CallState;
  transcript: Line[];
  turnCount: number;
  updatedAt: Temporal.Instant;
}

export interface NewBooking {
  id: string;
  shopId: string;
  resourceId: string;
  serviceId: string;
  start: Temporal.Instant;
  end: Temporal.Instant;
  customerName: string;
  customerPhone: string;
  channel: Channel;
  callId: string;
  rescheduledFrom?: string;
}

/** One atomic batch of writes (`db.batch` on Neon). */
export type Write =
  | { type: "insertCall"; call: Omit<StoredCall, "updatedAt"> }
  | {
      type: "updateCall";
      callId: string;
      state: CallState;
      transcript: Line[];
      turnCount: number;
      status?: StoredCall["status"];
    }
  | { type: "insertBooking"; booking: NewBooking }
  | { type: "cancelBooking"; bookingId: string }
  | {
      type: "insertMessage";
      message: OwnerMessage & { shopId: string; callId: string; channel: Channel; bookingId?: string };
    };

export interface Repository {
  getShop(id: string): Promise<ShopProfile | null>;
  getCall(id: string, shopId: string): Promise<StoredCall | null>;
  listBookings(shopId: string, from: Temporal.Instant, to: Temporal.Instant): Promise<ExistingBooking[]>;
  findCallerBookings(shopId: string, phone: string, now: Temporal.Instant): Promise<CallerBooking[]>;
  commit(writes: readonly Write[]): Promise<{ ok: true } | { ok: false; conflict: "booking_overlap" }>;
  /** Counts this Turn in the visitor's minute and the global hour that contain `now`; returns the new counts. */
  hitRateLimits(visitorKey: string, now: Temporal.Instant): Promise<{ visitor: number; global: number }>;
  /** Deletes rate-limit windows that started before `before`; returns how many. */
  pruneRateLimits(before: Temporal.Instant): Promise<number>;
  /**
   * Open Calls idle since before `idleBefore` become `abandoned` with their Message; returns how many.
   * `now` decides the Message's "today" (owner-machine 5.4); it defaults to the current instant.
   */
  closeStaleCalls(shopId: string, idleBefore: Temporal.Instant, now?: Temporal.Instant): Promise<number>;
}

export interface RateLimiter {
  hit(visitorKey: string, now: Temporal.Instant): Promise<{ visitor: number; global: number }>;
}

export type Clock = () => Temporal.Instant;

/** The model port. `lib/receptionist/geminiClient.ts` implements it (task 6). */
export interface ModelClient {
  /**
   * `attempt` is 0 for the first attempt of a Turn and grows with each fresh attempt
   * after a deadline or a 5xx, so a client with a model list can move to the next model.
   */
  generate(req: {
    systemInstruction: string;
    input: string;
    jsonSchema: object;
    signal: AbortSignal;
    attempt?: number;
  }): Promise<string>;
  /** The model id an attempt uses, for logs. Optional. */
  modelFor?(attempt: number): string;
}

export interface CoreConfig {
  modelTimeoutMs: number; // MODEL_TIMEOUT_MS, 2400
  maxTurns: number; // 20
  perVisitorPerMinute: number;
  globalPerHour: number;
  /**
   * @deprecated front-desk-brain 9.2: two invalid outputs in a row no longer end a Call (1.2), so
   * `handleTurn` ignores this. Kept for one release because the harnesses set it; removed in the
   * cleanup task.
   */
  maxConsecutiveInvalid: number; // 2
}

export interface CoreDeps {
  repo: Repository;
  model: ModelClient;
  limiter: RateLimiter;
  clock: Clock;
  newId: () => string;
  config: CoreConfig;
  /** Where a fallback's cause is logged. Defaults to one JSON line on stderr. */
  logFallback?: FallbackLogger;
  /**
   * A monotonic clock in milliseconds for the stage times (front-desk-brain 19.4). Defaults to
   * `performance.now`. It never decides anything, so a test may leave it out.
   */
  timer?: () => number;
}

/**
 * Where one request's server time went, in milliseconds (front-desk-brain 19.4; design.md
 * "handleTurn", step 7). Numbers only: the adapter turns them into the `Server-Timing` header.
 * `brain` is the Code_Brain's Reading and `decideTurn`; `db` the sum of the repository and
 * rate-limiter calls (the early bookings read may run beside the model, so `db` and `model` may
 * overlap); `model` the model call, 0 when it was not called; `total` the whole request.
 */
export interface StageTimes {
  brain: number;
  db: number;
  model: number;
  total: number;
}

/** `handleTurn`'s output with its stage times beside it. */
export interface TimedTurnOutput {
  output: TurnOutput;
  timings: StageTimes;
}

export function initialCallState(language: Lang): CallState {
  return {
    stage: "collecting",
    intent: "other",
    language,
    fields: {},
    note: { reason: "", urgency: "normal" },
    consecutiveInvalid: 0,
    modelFailed: false,
    turnCount: 0,
  };
}

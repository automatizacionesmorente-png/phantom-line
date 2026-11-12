import type { Temporal } from "temporal-polyfill";
import type { AcceptedVerdict, ExistingBooking } from "@/lib/booking";
import type { Lang } from "@/lib/sectors";
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
}

export interface CallState {
  stage: "collecting" | "awaiting_confirmation" | "done";
  intent: Intent;
  language: Lang;
  fields: CallFields;
  /** What the read-back asked the caller to confirm. */
  pending?: PendingAction;
  /** ISO instants of the alternatives just offered, so "vale, a las siete y media" resolves. */
  lastOffer?: string[];
  /** Passed the Booking_Match (phone AND name) for reschedule / cancel. */
  existingBookingId?: string;
  note: { reason: string; urgency: Urgency };
  consecutiveInvalid: number;
  modelFailed: boolean;
  turnCount: number;
}

// ---------------------------------------------------------------------------
// Owner message and effects

export interface OwnerMessage {
  callerName: string | null;
  callerPhone: string | null;
  reason: string;
  urgency: Urgency;
  agreed: string;
  suggestedReply: string;
  outcome: Outcome;
  modelFailed: boolean;
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
  | { type: "saveMessage"; message: OwnerMessage };

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
  /** Open Calls idle since before `idleBefore` become `abandoned` with their Message; returns how many. */
  closeStaleCalls(shopId: string, idleBefore: Temporal.Instant): Promise<number>;
}

export interface RateLimiter {
  hit(visitorKey: string, now: Temporal.Instant): Promise<{ visitor: number; global: number }>;
}

export type Clock = () => Temporal.Instant;

/** The model port. `lib/receptionist/geminiClient.ts` implements it (task 6). */
export interface ModelClient {
  generate(req: { systemInstruction: string; input: string; jsonSchema: object; signal: AbortSignal }): Promise<string>;
}

export interface CoreConfig {
  modelTimeoutMs: number; // 8000
  maxTurns: number; // 20
  perVisitorPerMinute: number;
  globalPerHour: number;
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

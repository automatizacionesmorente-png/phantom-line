/**
 * The Machine_API contract (owner-machine design, "Machine_API"): the zod request schemas
 * and the response types, shared by the route handlers and the Machine_Page. Pure zod and
 * types only, no server imports, so the browser bundle can import it.
 *
 * Every request schema is a `z.strictObject`, so an extra key is a 400 like on the Turn_API.
 * Instants travel as ISO strings; the page formats them in the shop's zone.
 */
import { z } from "zod";
import type { Channel, Line, Outcome, Urgency } from "@/lib/conversation/types";
import type { UrgencyBasis } from "@/lib/messages/urgency";
import type { Lang } from "@/lib/sectors";
import type { AgendaStatus, OwnerBookingAction } from "./agenda";

// ---------------------------------------------------------------------------
// Requests

/** The same 6-digit rule as `PIN_PATTERN` in pin.ts, which cannot be imported here (node:crypto). A unit test keeps them equal. */
const PIN = /^\d{6}$/;
/** Largest Owner_Session label (design: `label?: string ≤ 30`). */
export const LABEL_MAX = 30;

/** POST /api/machine/[shopId]/session */
export const LoginRequestSchema = z.strictObject({
  pin: z.string().regex(PIN),
  label: z.string().max(LABEL_MAX).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** GET /api/machine/[shopId]?since=<int>: the query as `Object.fromEntries(searchParams)`. */
export const PollQuerySchema = z.strictObject({
  since: z
    .string()
    .regex(/^\d{1,15}$/)
    .transform(Number)
    .optional(),
});
export type PollQuery = z.infer<typeof PollQuerySchema>;

/** POST /api/machine/[shopId]/messages/[messageId] */
export const MessageActionSchema = z.strictObject({ action: z.enum(["play", "erase"]) });
export type MessageActionRequest = z.infer<typeof MessageActionSchema>;

const Revision = z.number().int().min(0);

/** POST /api/machine/[shopId]/bookings/[bookingId]: every action carries the revision the Owner saw (10.7). */
export const BookingActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.enum(["confirm", "cancel"]), revision: Revision }),
  z.strictObject({ action: z.literal("move"), revision: Revision, start: z.iso.datetime({ offset: true }) }),
]);
export type BookingActionRequest = z.infer<typeof BookingActionSchema>;

/** GET /api/machine/[shopId]/bookings/[bookingId]/slots?date=YYYY-MM-DD */
export const SlotsQuerySchema = z.strictObject({ date: z.iso.date() });
export type SlotsQuery = z.infer<typeof SlotsQuerySchema>;

// ---------------------------------------------------------------------------
// Responses

/** The fixed Sample_Messages of the Demo_Shop (7.12, 16.4). `lib/owner/demo.ts` uses this type. */
export const SAMPLE_KEYS = ["urgent", "booking", "question"] as const;
export type SampleKey = (typeof SAMPLE_KEYS)[number];

export interface PollCounts {
  /** New_Messages: on the Tape, not erased. */
  new: number;
  /** Unheard_Messages: of those, never played. */
  unheard: number;
}

/** One Message on the Tape. Never a Transcript: PLAY fetches it (14.2). */
export interface TapeItem {
  id: string;
  channel: Channel;
  /** ISO instant. */
  createdAt: string;
  heard: boolean;
  callerName: string | null;
  callerPhone: string | null;
  /** The stored reason, always as stored (4.7). */
  reason: string;
  urgency: Urgency;
  urgencyBasis: UrgencyBasis | null;
  /** Agreed_Text: from the Booking as it is now in every Shop language, or the stored text (4.7, 6.8). */
  agreed: { byLang: Record<Lang, string> } | { stored: string };
  currentReply: string;
  /** The Call's language: the reply is sent to the customer in it. */
  replyLang: Lang;
  /** The language the stored reason and stored texts were written in. */
  ownerLang: Lang;
  outcome: Outcome;
  modelFailed: boolean;
  /** Set for a Sample_Message ("Sample" badge, 7.12). */
  sample: SampleKey | null;
}

/** One Booking in the Agenda, as the page needs it. */
export interface AgendaItem {
  id: string;
  revision: number;
  resourceId: string;
  serviceId: string;
  /** ISO instants. */
  start: string;
  end: string;
  status: AgendaStatus;
  cancelledBy: "caller" | "owner" | null;
  customerName: string;
  channel: Channel;
  /** What the Owner may do now, in button order (10.1, 10.2). */
  actions: OwnerBookingAction[];
  lastOwnerAction: { action: OwnerBookingAction; label: string; at: string } | null;
}

export interface AgendaDayDto {
  /** Local date "YYYY-MM-DD" in the shop's zone. */
  date: string;
  items: AgendaItem[];
}

/** The small body: only what the light and the counter need (12.2). */
export interface PollUnchanged {
  changed: false;
  version: number;
  counts: PollCounts;
}

/** The full body: the Tape without Transcripts and the Agenda, in one response (12.3). */
export interface PollChanged {
  changed: true;
  version: number;
  counts: PollCounts;
  /** The server's ISO instant when the snapshot was read: "has started" is judged against it. */
  now: string;
  tape: TapeItem[];
  agenda: AgendaDayDto[];
}

export type PollResponse = PollUnchanged | PollChanged;

export interface PlayResponse {
  version: number;
  transcript: Line[];
  lang: Lang;
}

export interface EraseResponse {
  version: number;
}

export interface BookingActionResponse {
  version: number;
  booking: AgendaItem;
}

export interface SlotDto {
  start: string;
  resourceId: string;
}

export interface SlotsResponse {
  slots: SlotDto[];
}

/** Every error body: a stable code, plus what the dialog needs to refresh in place. */
export type MachineErrorBody =
  | { error: "wrong_pin" | "too_many_tries" | "no_pin" | "machine_not_configured" }
  | { error: "shop_not_found" | "message_not_found" | "booking_not_found" | "bad_origin" }
  | { error: "invalid_request"; issues: { path: (string | number)[]; message: string }[] }
  | { error: "not_allowed" }
  | { error: "unavailable" }
  | { error: "stale"; booking: AgendaItem }
  | { error: "rejected"; reason: string; slots: SlotDto[] }
  | { error: "taken"; slots: SlotDto[] };

/**
 * The owner side's ports (owner-machine design, "OwnerRepository port"). Types only: the
 * Drizzle implementation is lib/db/ownerRepository.ts, the fakes live in the tests, and
 * handleOwner / demoRetention reach the database only through these.
 */
import type { Temporal } from "temporal-polyfill";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { ErrorSummary } from "@/lib/conversation/fallbackLog";
import type { Channel, Lang, Line, Outcome, Urgency } from "@/lib/conversation/types";
import type { AgreedBooking } from "@/lib/messages/agreedText";
import type { ReplyBooking } from "@/lib/messages/currentReply";
import type { UrgencyBasis } from "@/lib/messages/urgency";
import type { AgendaBooking } from "./agenda";
import type { SampleKey } from "./api";
import type { DemoCutoffs, DemoSample } from "./demo";
import type { PollHead } from "./poll";
import type { ClientBooking } from "@/lib/clients/summary";

/** The before and after values of an Audit_Record. Never a name, a phone, a Transcript or the PIN (11.4). Instants are ISO strings in UTC. */
export interface AuditValues {
  start?: string;
  end?: string;
  resourceId?: string;
  status?: "confirmed" | "cancelled";
  ownerConfirmed?: boolean;
  erased?: boolean;
  heard?: boolean;
  /** "No vino" on a past booking (clients 14). */
  noShow?: boolean;
}

export interface ShopAccess {
  profile: ShopProfile;
  pinHash: string | null;
  pinSetAt: Temporal.Instant | null;
  /** A shop created by the /nacer wizard: its pages show the "Prueba" badge. */
  trial?: boolean;
}

/** Who did an Owner_Action: the Owner_Session's id and the label typed at login. */
export interface Actor {
  sessionId: string;
  label: string;
}

/**
 * One Owner_Action, run as one statement with its Audit_Record (11.1). The before and after
 * values are read and written by that statement itself, so the record always matches the row.
 */
export type OwnerCommand =
  | { kind: "play" | "erase"; shopId: string; messageId: string; actor: Actor; now: Temporal.Instant }
  | { kind: "confirm" | "cancel"; shopId: string; bookingId: string; revision: number; actor: Actor; now: Temporal.Instant }
  | {
      kind: "move";
      shopId: string;
      bookingId: string;
      revision: number;
      actor: Actor;
      now: Temporal.Instant;
      to: { start: Temporal.Instant; end: Temporal.Instant; resourceId: string };
    }
  /** "No vino" (or its undo) on a finished booking of the client with this phone (clients 14). */
  | { kind: "no_show"; shopId: string; bookingId: string; phone: string; noShow: boolean; actor: Actor; now: Temporal.Instant };

export type OwnerCommandStatus = "applied" | "noop" | "stale" | "not_found" | "overlap";

export interface OwnerCommandResult {
  status: OwnerCommandStatus;
  /** The shop's Machine_Version after the command. */
  version: number;
}

/** One Message of the Tape as stored, with what the Agreed_Text and the Current_Reply need. No Transcript (14.2). */
export interface TapeRow {
  id: string;
  channel: Channel;
  createdAt: Temporal.Instant;
  heard: boolean;
  callerName: string | null;
  callerPhone: string | null;
  reason: string;
  urgency: Urgency;
  urgencyBasis: UrgencyBasis | null;
  agreed: string;
  suggestedReply: string;
  outcome: Outcome;
  modelFailed: boolean;
  sample: SampleKey | null;
  /** The Call's language: the stored texts and the reply are in it. */
  callLang: Lang;
  /** The Message's Booking as it is now, with the latest owner move. */
  booking: (AgreedBooking & ReplyBooking) | null;
}

export interface DemoRetentionCounts {
  erased: number;
  deletedCalls: number;
  deletedMessages: number;
  deletedBookings: number;
  deletedAuditRecords: number;
  deletedClients: number;
}

/** One Client of the customer book with the bookings that share their phone (same shop only). */
export interface ClientRecord {
  id: string;
  name: string;
  phone: string;
  language: Lang;
  note: string;
  createdAt: Temporal.Instant;
  bookings: ClientBooking[];
}

export interface OwnerRepository {
  getShopAccess(shopId: string): Promise<ShopAccess | null>;
  /** Counts one attempt in each window; returns the new counts in the order of `keys`. */
  hitCounters(keys: readonly { key: string; windowStart: Temporal.Instant }[]): Promise<number[]>;
  /** One read of the shop row and the two counts (12.2). */
  pollHead(shopId: string): Promise<PollHead | null>;
  /** The New_Messages, newest first, at most `limit`. */
  listTape(shopId: string, limit: number): Promise<TapeRow[]>;
  /** The Transcript of a Message's Call, or null for an unknown or erased Message. */
  getTranscript(shopId: string, messageId: string): Promise<{ lines: Line[]; lang: Lang } | null>;
  /** Bookings whose start is in [from, to), cancelled included, each with its latest owner action. */
  listAgenda(shopId: string, from: Temporal.Instant, to: Temporal.Instant): Promise<AgendaBooking[]>;
  getBooking(shopId: string, bookingId: string): Promise<AgendaBooking | null>;
  applyOwnerCommand(cmd: OwnerCommand): Promise<OwnerCommandResult>;
  /** The shop's Clients, most recently active first, at most `limit`, each with their bookings. Scoped to `shopId`. */
  listClients(shopId: string, limit: number): Promise<ClientRecord[]>;
  /** One Client of this shop, or null for an unknown id or one that belongs to another shop. */
  getClient(shopId: string, clientId: string): Promise<ClientRecord | null>;
  /** Sets the Owner's private note; false when no Client of this shop has that id. */
  setClientNote(shopId: string, clientId: string, note: string): Promise<boolean>;
  /** Seed only. */
  setOwnerPin(shopId: string, hash: string, at: Temporal.Instant): Promise<void>;
  // Demo_Retention (16). None of these takes a shop id: they act on DEMO_SHOP_ID only.
  /** True for exactly one caller in any 10 minutes (16.6). */
  claimDemoRetention(now: Temporal.Instant): Promise<boolean>;
  applyDemoCutoffs(c: DemoCutoffs): Promise<DemoRetentionCounts>;
  demoTapeState(): Promise<{ newCount: number; activeSampleKeys: SampleKey[] }>;
  /** Inserts each sample's Call and Message in one transaction; returns how many Messages. */
  insertDemoSamples(samples: readonly DemoSample[]): Promise<number>;
}

/** One JSON line on stderr per event (design, "Logging"). Never a name, phone, reason, Transcript, PIN, token or Visitor key. */
export type OwnerLogEvent =
  | {
      event: "owner_auth";
      outcome: "wrong_pin" | "rate_limited" | "no_pin" | "misconfigured";
      shopId: string;
      limit?: "visitor" | "shop";
      counts?: { visitor: number; shop: number | null };
    }
  | { event: "owner_error"; route: string; shopId: string; error: ErrorSummary }
  | {
      event: "demo_retention";
      step: "claim" | "cutoffs" | "samples";
      outcome: "ok" | "failed";
      counts: DemoRetentionCounts & { samplesAdded: number };
      error?: ErrorSummary;
    };

export type OwnerLogger = (e: OwnerLogEvent) => void;

export const consoleOwnerLogger: OwnerLogger = (e) => {
  console.error(JSON.stringify(e));
};

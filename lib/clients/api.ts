/**
 * The customer book's part of the Machine_API: zod request schemas and response types, shared by
 * the route handlers and the Machine_Page. Pure zod and types only, so the browser can import it.
 */
import { z } from "zod";
import type { Lang } from "@/lib/sectors";
import type { HistoryState } from "./summary";

/** The Owner's private note is at most this many characters. */
export const NOTE_MAX = 500;

/** Postgres refuses NUL in text; a note never has one. */
const Note = z
  .string()
  .max(NOTE_MAX)
  .refine((s) => !s.includes("\u0000"), "The note has an invalid character");

/** "MM-DD" of a real day (29 February counts: the year is not stored). */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const Birthday = z
  .string()
  .regex(/^\d{2}-\d{2}$/)
  .refine((s) => {
    const m = Number(s.slice(0, 2));
    const d = Number(s.slice(3));
    return m >= 1 && m <= 12 && d >= 1 && d <= DAYS_IN_MONTH[m - 1];
  }, "Not a real day");

/** Sector fields: ids and lengths are checked against the shop's pack by the handler. */
const FieldValue = z
  .string()
  .max(500)
  .refine((s) => !s.includes("\u0000"), "The value has an invalid character");
const Fields = z.record(z.string().max(20), FieldValue).refine((r) => Object.keys(r).length <= 20, "Too many fields");

/** POST /api/machine/[shopId]/clients/[clientId] */
export const ClientActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("note"), note: Note }),
  z.strictObject({ action: z.literal("birthday"), birthday: Birthday.nullable() }),
  /** Promotion consent: on sets the date to now, off clears it. */
  z.strictObject({ action: z.literal("consent"), consent: z.boolean() }),
  z.strictObject({ action: z.literal("fields"), fields: Fields }),
  /** "No vino" on a finished booking of this client, or its undo. */
  z.strictObject({ action: z.literal("no_show"), bookingId: z.uuid(), noShow: z.boolean() }),
]);
export type ClientActionRequest = z.infer<typeof ClientActionSchema>;

export interface ClientHistoryItem {
  bookingId: string;
  serviceId: string;
  /** ISO instants. */
  start: string;
  end: string;
  state: HistoryState;
  /** "No vino" can be set or undone: the booking is confirmed and finished. */
  canMarkNoShow: boolean;
  /** Cents the cash desk took for this visit, or null when unpaid. */
  paidCents: number | null;
  /** The Owner's visit note ('' when none). */
  visitNote: string;
}

export interface ClientDto {
  id: string;
  name: string;
  phone: string;
  language: Lang;
  note: string;
  /** "MM-DD" or null. */
  birthday: string | null;
  /** ISO instant the client agreed to promotions, or null. */
  promoConsentAt: string | null;
  /** Sector fields by id (only the ones filled in). */
  fields: Record<string, string>;
  /** Everything paid for this client's bookings, in cents. */
  spentCents: number;
  totalVisits: number;
  noShows: number;
  /** ISO instants, or null. */
  lastVisit: string | null;
  upcoming: string | null;
  intervalDays: number | null;
  usualServices: { serviceId: string; count: number }[];
  /** Newest first, at most `HISTORY_LIMIT`. */
  history: ClientHistoryItem[];
}

/** A client who has not come back, with the suggested WhatsApp text and its wa.me link. */
export interface LapsedDto {
  clientId: string;
  name: string;
  language: Lang;
  daysSince: number;
  thresholdDays: number;
  overdueDays: number;
  text: string;
  whatsappUrl: string;
}

/** Both lists in one response: the Clientes tab and "Clientes que no han vuelto". */
export interface ClientsResponse {
  /** ISO instant the book was read. */
  now: string;
  clients: ClientDto[];
  lapsed: LapsedDto[];
}

export const HISTORY_LIMIT = 20;

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

/** POST /api/machine/[shopId]/clients/[clientId] */
export const ClientActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("note"), note: Note }),
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
}

export interface ClientDto {
  id: string;
  name: string;
  phone: string;
  language: Lang;
  note: string;
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

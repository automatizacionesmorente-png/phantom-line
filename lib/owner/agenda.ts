/**
 * The Agenda (owner-machine 9.1–9.4, 10.1, 10.2): today and the next 7 local days of the
 * shop, the three states the Owner sees, and which one-tap actions a Booking allows. Pure,
 * no server imports, so the browser uses it too. Every day is a local date in the shop's
 * IANA zone, never the server's.
 */
import { Temporal } from "temporal-polyfill";
import { localDateOf, toInstant } from "@/lib/booking";
import { nameByParts } from "@/lib/conversation/catalog";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { Channel } from "@/lib/conversation/types";
import type { Lang, SectorPack } from "@/lib/sectors";

/** A booking's channel: the receptionist's three, or `manual` (the Owner wrote it by hand). */
export type BookingChannel = Channel | "manual";

export type AgendaStatus = "booked" | "confirmed" | "cancelled";
export type OwnerBookingAction = "confirm" | "move" | "cancel";

export interface AgendaBooking {
  id: string;
  revision: number;
  resourceId: string;
  serviceId: string;
  start: Temporal.Instant;
  end: Temporal.Instant;
  /** The database column: an active Booking is `confirmed`, because the no-overlap constraint filters on it. */
  status: "confirmed" | "cancelled";
  ownerConfirmedAt: Temporal.Instant | null;
  cancelledBy: "caller" | "owner" | null;
  customerName: string;
  channel: BookingChannel;
  noShowAt: Temporal.Instant | null;
  /** The amount of its payment in cents; null when unpaid. */
  paidCents: number | null;
  /** Price snapshot in cents; null on rows that predate it. */
  priceCents: number | null;
  visitNote: string;
  lastOwnerAction: { action: OwnerBookingAction; label: string; at: Temporal.Instant } | null;
}

/** The Agenda shows today and the next 7 local days (9.1). */
export const AGENDA_DAYS = 8;

export interface AgendaWindow {
  /** Start of today in the shop's zone. */
  from: Temporal.Instant;
  /** Start of the local day after the last one (exclusive). */
  to: Temporal.Instant;
  /** The 8 local dates, today first. */
  days: Temporal.PlainDate[];
}

const MIDNIGHT = Temporal.PlainTime.from("00:00");

/**
 * Today 00:00 to the start of today + 8 local days, in the shop's zone. Calendar days, not
 * 24-hour blocks, so the 23- and 25-hour days are whole days like any other.
 */
export function agendaWindow(now: Temporal.Instant, timeZone: string): AgendaWindow {
  const today = localDateOf(now, timeZone);
  const days = Array.from({ length: AGENDA_DAYS }, (_, k) => today.add({ days: k }));
  return {
    from: toInstant(today, MIDNIGHT, timeZone),
    to: toInstant(today.add({ days: AGENDA_DAYS }), MIDNIGHT, timeZone),
    days,
  };
}

/** The only place the database status and the Owner's confirmation become the three words the Owner sees. */
export function agendaStatus(b: Pick<AgendaBooking, "status" | "ownerConfirmedAt">): AgendaStatus {
  if (b.status === "cancelled") return "cancelled";
  return b.ownerConfirmedAt === null ? "booked" : "confirmed";
}

/**
 * None for a cancelled Booking or one that has started (start <= now); otherwise move and
 * cancel, and confirm first while the Owner has not confirmed it (10.1, 10.2).
 */
export function allowedActions(
  b: Pick<AgendaBooking, "status" | "ownerConfirmedAt" | "start">,
  now: Temporal.Instant,
): OwnerBookingAction[] {
  if (b.status === "cancelled") return [];
  if (Temporal.Instant.compare(b.start, now) <= 0) return [];
  return b.ownerConfirmedAt === null ? ["confirm", "move", "cancel"] : ["move", "cancel"];
}

export interface AgendaDay {
  /** The local date, "YYYY-MM-DD". */
  date: string;
  /** Active Bookings by start, then cancelled ones by start. */
  items: AgendaBooking[];
}

function byStart(a: AgendaBooking, b: AgendaBooking): number {
  return Temporal.Instant.compare(a.start, b.start) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The 8 days of the window, each with the Bookings that start on it in the shop's zone,
 * empty days included (9.1). A Booking outside `[from, to)` is left out (9.4).
 */
export function groupAgenda(
  rows: readonly AgendaBooking[],
  window: AgendaWindow,
  timeZone: string,
): AgendaDay[] {
  const byDate = new Map<string, AgendaBooking[]>(window.days.map((d) => [d.toString(), []]));
  const cmp = Temporal.Instant.compare;
  for (const row of rows) {
    if (cmp(row.start, window.from) < 0 || cmp(row.start, window.to) >= 0) continue;
    byDate.get(localDateOf(row.start, timeZone).toString())?.push(row);
  }
  return window.days.map((d) => {
    const items = byDate.get(d.toString()) ?? [];
    const active = items.filter((b) => b.status !== "cancelled").sort(byStart);
    const cancelled = items.filter((b) => b.status === "cancelled").sort(byStart);
    return { date: d.toString(), items: [...active, ...cancelled] };
  });
}

/**
 * What was booked, in the pack's words. For an `appointment` pack it is the Service name;
 * the `table` and `order` units show the Service name too until the sector-packs spec
 * stores party size and items. A Service_Combo is named by its parts ("Corte de hombre +
 * Degradado"). An unknown Service shows its id rather than nothing.
 */
export function agendaWhat(
  b: Pick<AgendaBooking, "serviceId">,
  shop: ShopProfile,
  pack: SectorPack,
  lang: Lang,
): string {
  const name = nameByParts(b.serviceId, shop.services, lang) ?? b.serviceId;
  switch (pack.unit) {
    case "appointment":
    case "table":
    case "order":
      return name;
  }
}

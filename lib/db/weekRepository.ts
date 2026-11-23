/**
 * The rows of the last 7 days for "Últimos 7 días" (lib/owner/weekStats.ts): Calls and Bookings of one shop in
 * a window. Read-only, no personal column is selected (no name, phone or Transcript).
 */
import { and, eq, gte, lt } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { WeekSource } from "@/lib/owner/weekStats";
import type { DbHandle } from "./repository";
import { bookings, calls } from "./schema";

const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());

export function createWeekSource(handle: DbHandle): WeekSource {
  const { db } = handle;
  return {
    async listWeekCalls(shopId, from, to) {
      const rows = await db
        .select({ id: calls.id, status: calls.status, startedAt: calls.startedAt, updatedAt: calls.updatedAt, endedAt: calls.endedAt })
        .from(calls)
        .where(and(eq(calls.shopId, shopId), gte(calls.startedAt, toDate(from)), lt(calls.startedAt, toDate(to))));
      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        startedAt: toInstant(r.startedAt),
        updatedAt: toInstant(r.updatedAt),
        endedAt: r.endedAt ? toInstant(r.endedAt) : null,
      }));
    },
    async listWeekBookings(shopId, from, to) {
      const rows = await db
        .select({
          id: bookings.id,
          serviceId: bookings.serviceId,
          callId: bookings.callId,
          rescheduledFrom: bookings.rescheduledFrom,
          status: bookings.status,
          createdAt: bookings.createdAt,
        })
        .from(bookings)
        .where(and(eq(bookings.shopId, shopId), gte(bookings.createdAt, toDate(from)), lt(bookings.createdAt, toDate(to))));
      return rows.map((r) => ({ ...r, createdAt: toInstant(r.createdAt) }));
    },
  };
}

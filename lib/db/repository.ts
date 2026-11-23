import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Temporal } from "temporal-polyfill";
import type { ExistingBooking } from "@/lib/booking";
import { summarize, usualService } from "@/lib/clients/summary";
import type { ClientRecall } from "@/lib/clients/welcome";
import { buildOwnerMessage, isActionable } from "@/lib/conversation/ownerMessage";
import { messageWrite } from "@/lib/conversation/messageWrite";
import { ShopProfileSchema, type ShopProfile } from "@/lib/conversation/shopProfile";
import type { CallerBooking, Channel, Lang, Repository, StoredCall, Write } from "@/lib/conversation/types";
import { getSectorPack } from "@/lib/sectors";
import * as schema from "./schema";
import { shopIsLive } from "./shopLive";
import { blocksAsBusy } from "@/lib/salon/blocks";
import { bookings, calls, clients, messages, rateLimits, shops, timeBlocks } from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Query = BatchItem<"pg">;

/**
 * A database plus the way it runs several writes atomically: `db.batch` on
 * neon-http (non-interactive transaction), `db.transaction` on PGlite. The
 * queries are built on the handle `atomic` passes in, so they run inside it.
 * It resolves to each query's result, in order (a `.returning()` query gives its rows).
 */
export interface DbHandle {
  db: Db;
  atomic(build: (q: Db) => Query[]): Promise<unknown[]>;
}

const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());

/** SQLSTATE 23P01: exclusion_violation (the bookings_no_overlap constraint). */
export function isOverlapViolation(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 5; depth++) {
    if (e.code === "23P01") return true;
    e = e.cause as typeof e;
  }
  return false;
}

/** The phone shape the `clients` table accepts (its CHECK): "+" and 6 to 15 digits. */
const E164 = /^\+[0-9]{6,15}$/;
const MAX_CLIENT_NAME = 120;

/**
 * Creates or updates the Client of this shop and phone, in the same batch as the Booking or the
 * Message that carried the name and the phone (BACKLOG 14). Nothing for a phone that is not E.164
 * or a blank name. A curated demo client is never overwritten. The language is the Call's.
 */
export function clientUpsert(q: Db, shopId: string, name: string | null, phone: string | null, callId: string | null): Query[] {
  const clean = name?.trim().replace(/\s+/g, " ").slice(0, MAX_CLIENT_NAME) ?? "";
  if (!clean || !phone || !E164.test(phone)) return [];
  // A manual booking has no Call: the default language.
  const language = callId === null ? sql`'es'` : sql`COALESCE((SELECT c.language FROM calls c WHERE c.id = ${callId}::uuid), 'es')`;
  return [
    q
      .insert(clients)
      .values({ shopId, phone, name: clean, language })
      .onConflictDoUpdate({
        target: [clients.shopId, clients.phone],
        set: { name: clean, language, updatedAt: sql`now()` },
        setWhere: eq(clients.curated, false),
      }),
  ];
}

function buildWrites(q: Db, writes: readonly Write[]): Query[] {
  return writes.flatMap((w): Query[] => {
    switch (w.type) {
      case "insertCall":
        return [q.insert(calls).values({
          id: w.call.id,
          shopId: w.call.shopId,
          channel: w.call.channel,
          language: w.call.language,
          status: w.call.status,
          state: w.call.state,
          transcript: w.call.transcript,
          turnCount: w.call.turnCount,
        })];
      case "updateCall":
        return [q
          .update(calls)
          .set({
            state: w.state,
            language: w.state.language,
            transcript: w.transcript,
            turnCount: w.turnCount,
            updatedAt: sql`now()`,
            ...(w.status ? { status: w.status } : {}),
            ...(w.status && w.status !== "open" ? { endedAt: sql`now()` } : {}),
          })
          .where(eq(calls.id, w.callId))];
      case "insertBooking":
        return [q.insert(bookings).values({
          id: w.booking.id,
          shopId: w.booking.shopId,
          resourceId: w.booking.resourceId,
          serviceId: w.booking.serviceId,
          startsAt: toDate(w.booking.start),
          endsAt: toDate(w.booking.end),
          customerName: w.booking.customerName,
          customerPhone: w.booking.customerPhone,
          channel: w.booking.channel,
          callId: w.booking.callId,
          rescheduledFrom: w.booking.rescheduledFrom ?? null,
        }),
        ...clientUpsert(q, w.booking.shopId, w.booking.customerName, w.booking.customerPhone, w.booking.callId)];
      case "cancelBooking":
        // A cancel from a Call is the caller's (11.5); the Owner's goes through ownerRepository.
        return [q
          .update(bookings)
          .set({ status: "cancelled", cancelledAt: sql`now()`, cancelledBy: "caller" })
          .where(and(eq(bookings.id, w.bookingId), eq(bookings.status, "confirmed")))];
      case "insertMessage": {
        // One Message per Call: a repeated hang-up or a late sweep inserts nothing.
        return [q
          .insert(messages)
          .values({
            shopId: w.message.shopId,
            callId: w.message.callId,
            channel: w.message.channel,
            callerName: w.message.callerName,
            callerPhone: w.message.callerPhone,
            reason: w.message.reason,
            urgency: w.message.urgency,
            // The Suggested_Urgency and the Urgency_Rules' basis, next to the Final_Urgency (4.3).
            urgencySuggested: w.message.urgencySuggested,
            urgencyBasis: w.message.urgencyBasis,
            agreed: w.message.agreed,
            suggestedReply: w.message.suggestedReply,
            outcome: w.message.outcome,
            modelFailed: w.message.modelFailed,
            bookingId: w.message.bookingId ?? null,
          })
          .onConflictDoNothing({ target: messages.callId }),
        ...clientUpsert(q, w.message.shopId, w.message.callerName, w.message.callerPhone, w.message.callId)];
      }
    }
  });
}

type CallRow = typeof calls.$inferSelect;
function toStoredCall(row: CallRow): StoredCall {
  return {
    id: row.id,
    shopId: row.shopId,
    channel: row.channel as Channel,
    language: row.language as Lang,
    status: row.status as StoredCall["status"],
    state: row.state,
    transcript: row.transcript,
    turnCount: row.turnCount,
    updatedAt: toInstant(row.updatedAt),
  };
}

export interface RateWindow {
  visitorWindow: Temporal.Instant;
  globalWindow: Temporal.Instant;
}

/** Fixed windows in UTC: the minute and the hour that contain `now`. */
export function rateWindows(now: Temporal.Instant): RateWindow {
  const ms = now.epochMilliseconds;
  return {
    visitorWindow: Temporal.Instant.fromEpochMilliseconds(ms - (ms % 60_000)),
    globalWindow: Temporal.Instant.fromEpochMilliseconds(ms - (ms % 3_600_000)),
  };
}

export const GLOBAL_RATE_KEY = "global";

export function createRepository(handle: DbHandle): Repository {
  const { db } = handle;

  async function commit(writes: readonly Write[]) {
    if (writes.length === 0) return { ok: true as const };
    try {
      await handle.atomic((q) => buildWrites(q, writes));
      return { ok: true as const };
    } catch (err) {
      if (isOverlapViolation(err)) return { ok: false as const, conflict: "booking_overlap" as const };
      throw err;
    }
  }

  async function getShop(id: string): Promise<ShopProfile | null> {
    const rows = await db.select({ profile: shops.profile }).from(shops).where(and(eq(shops.id, id), shopIsLive())).limit(1);
    if (rows.length === 0) return null;
    // Validated on every read: a broken profile must never reach the receptionist.
    const parsed = ShopProfileSchema.safeParse(rows[0].profile);
    if (!parsed.success) throw new Error(`Shop "${id}" has an invalid profile`);
    return parsed.data;
  }

  return {
    getShop,

    async getCall(id, shopId) {
      const rows = await db
        .select()
        .from(calls)
        .where(and(eq(calls.id, id), eq(calls.shopId, shopId)))
        .limit(1);
      return rows.length === 0 ? null : toStoredCall(rows[0]);
    },

    /**
     * The busy list of the booking rules: confirmed bookings plus the time blocks that overlap
     * the window, expanded per resource here because this is where the shop's resources are known.
     * Block entries carry `block:` ids, so callers never mistake one for a booking.
     */
    async listBookings(shopId, from, to): Promise<ExistingBooking[]> {
      const [rows, blockRows, shopRows] = await Promise.all([
        db
          .select({ id: bookings.id, resourceId: bookings.resourceId, startsAt: bookings.startsAt, endsAt: bookings.endsAt })
          .from(bookings)
          .where(
            and(
              eq(bookings.shopId, shopId),
              eq(bookings.status, "confirmed"),
              lt(bookings.startsAt, toDate(to)),
              gt(bookings.endsAt, toDate(from)),
            ),
          )
          .orderBy(asc(bookings.startsAt), asc(bookings.id)),
        db
          .select()
          .from(timeBlocks)
          .where(and(eq(timeBlocks.shopId, shopId), lt(timeBlocks.startsAt, toDate(to)), gt(timeBlocks.endsAt, toDate(from))))
          .orderBy(asc(timeBlocks.startsAt), asc(timeBlocks.id)),
        // Only needed when a block exists.
        db.select({ profile: shops.profile }).from(shops).where(eq(shops.id, shopId)).limit(1),
      ]);
      const booked = rows.map((r) => ({ id: r.id, resourceId: r.resourceId, start: toInstant(r.startsAt), end: toInstant(r.endsAt) }));
      if (blockRows.length === 0) return booked;
      const raw = (shopRows[0]?.profile as { resources?: unknown } | undefined)?.resources;
      const resources = Array.isArray(raw)
        ? raw.flatMap((x) => (x && typeof (x as { id?: unknown }).id === "string" ? [{ id: (x as { id: string }).id }] : []))
        : [];
      const busy = blocksAsBusy(
        blockRows.map((b) => ({ id: b.id, resourceId: b.resourceId, start: toInstant(b.startsAt), end: toInstant(b.endsAt), reason: b.reason })),
        resources,
      );
      return [...booked, ...busy];
    },

    async findCallerBookings(shopId, phone, now): Promise<CallerBooking[]> {
      const rows = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, shopId),
            eq(bookings.status, "confirmed"),
            eq(bookings.customerPhone, phone),
            gte(bookings.startsAt, toDate(now)),
          ),
        )
        .orderBy(asc(bookings.startsAt));
      return rows.map((r) => ({
        id: r.id,
        resourceId: r.resourceId,
        serviceId: r.serviceId,
        start: toInstant(r.startsAt),
        end: toInstant(r.endsAt),
        customerName: r.customerName,
        customerPhone: r.customerPhone,
      }));
    },

    async findClient(shopId, phone, now): Promise<ClientRecall | null> {
      // Scoped to the shop and the exact phone; the caller still has to pass the name rule.
      const rows = await db
        .select({ name: clients.name, phone: clients.phone })
        .from(clients)
        .where(and(eq(clients.shopId, shopId), eq(clients.phone, phone)))
        .limit(1);
      const c = rows[0];
      if (!c) return null;
      const bs = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.shopId, shopId), eq(bookings.customerPhone, phone)));
      const summary = summarize(
        bs.map((b) => ({
          id: b.id,
          serviceId: b.serviceId,
          start: toInstant(b.startsAt),
          end: toInstant(b.endsAt),
          status: b.status as "confirmed" | "cancelled",
          noShow: b.noShowAt !== null,
          paidCents: null,
          visitNote: "",
        })),
        now,
      );
      return { name: c.name, phone: c.phone, usualServiceId: usualService(summary) };
    },

    commit,

    async hitRateLimits(visitorKey, now) {
      const w = rateWindows(now);
      const rows = await db
        .insert(rateLimits)
        .values([
          { key: visitorKey, windowStart: toDate(w.visitorWindow), count: 1 },
          { key: `${visitorKey}:h`, windowStart: toDate(w.globalWindow), count: 1 },
          { key: GLOBAL_RATE_KEY, windowStart: toDate(w.globalWindow), count: 1 },
        ])
        .onConflictDoUpdate({
          target: [rateLimits.key, rateLimits.windowStart],
          set: { count: sql`${rateLimits.count} + 1` },
        })
        .returning({ key: rateLimits.key, count: rateLimits.count });
      const count = (key: string) => rows.find((r) => r.key === key)?.count ?? 0;
      return { visitor: count(visitorKey), visitorHour: count(`${visitorKey}:h`), global: count(GLOBAL_RATE_KEY) };
    },

    async pruneRateLimits(before) {
      const rows = await db
        .delete(rateLimits)
        .where(lt(rateLimits.windowStart, toDate(before)))
        .returning({ key: rateLimits.key });
      return rows.length;
    },

    async closeStaleCalls(shopId, idleBefore, now = Temporal.Now.instant()) {
      const stale = await db
        .select()
        .from(calls)
        .where(and(eq(calls.shopId, shopId), eq(calls.status, "open"), lt(calls.updatedAt, toDate(idleBefore))));
      if (stale.length === 0) return 0;
      const shop = await getShop(shopId);
      if (!shop) return 0;
      const pack = getSectorPack(shop.sectorPackId);
      let closed = 0;
      for (const row of stale) {
        const call = toStoredCall(row);
        const state = { ...call.state, stage: "done" as const, pending: undefined };
        const message = isActionable(state, "abandoned") ? buildOwnerMessage(state, "abandoned", shop, pack) : null;
        // Only a Call that is still open is closed; a Message that already exists is kept.
        await handle.atomic((q) => [
          q
            .update(calls)
            .set({ status: "abandoned", state, updatedAt: sql`now()`, endedAt: sql`now()` })
            .where(and(eq(calls.id, call.id), eq(calls.status, "open"))),
          ...buildWrites(q, message ? [messageWrite(message, { call, shop, pack, transcript: call.transcript, now })] : []),
        ]);
        closed++;
      }
      return closed;
    },
  };
}

/**
 * The OwnerRepository port on Drizzle (owner-machine design, "OwnerRepository port").
 *
 * - Every Owner_Action is ONE statement: a data-modifying CTE that changes the row and writes
 *   its Audit_Record together, with the before and after values read from the row itself
 *   (11.1, 11.2). On Neon HTTP that is one autocommit request; on PGlite the same.
 * - The Machine_Version and the Booking revision are kept by the triggers of
 *   drizzle/0004_machine_triggers.sql, never here (12.4).
 * - The Demo_Retention methods take no shop id: they act on DEMO_SHOP_ID only (16.1).
 */
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { ShopProfileSchema } from "@/lib/conversation/shopProfile";
import { initialCallState, type Channel, type Lang, type Outcome, type Urgency } from "@/lib/conversation/types";
import type { AgendaBooking, OwnerBookingAction } from "@/lib/owner/agenda";
import type { SampleKey } from "@/lib/owner/api";
import { DEMO_RETENTION_EVERY_MIN, DEMO_SHOP_ID, type DemoCutoffs, type DemoSample } from "@/lib/owner/demo";
import type { ClientBooking } from "@/lib/clients/summary";
import type { ClientRecord, OwnerCommand, OwnerCommandResult, OwnerRepository, TapeRow } from "@/lib/owner/types";
import { isOverlapViolation, type Db, type DbHandle } from "./repository";
import { shopIsLive } from "./shopLive";
import { bookings, calls, clients, expenses, messages, outbox, ownerActions, payments, rateLimits, shops, timeBlocks } from "./schema";

const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());
const toInstantOrNull = (d: Date | null) => (d === null ? null : toInstant(d));
const iso = (i: Temporal.Instant) => i.toString();

/** Ids in URLs are untrusted text; a non-UUID can match no row, and must not reach a `uuid` cast (22P02). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

/** An instant inside jsonb, in the same ISO form as `Temporal.Instant#toString` up to milliseconds. */
const isoSql = (column: string) => sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** Writes the PIN hash and when it changed (2.1). Shared by the seed and the port. */
export async function setOwnerPin(db: Db, shopId: string, hash: string, at: Temporal.Instant): Promise<void> {
  await db.update(shops).set({ ownerPinHash: hash, ownerPinSetAt: toDate(at) }).where(eq(shops.id, shopId));
}

type BookingRow = typeof bookings.$inferSelect;
type LastAction = AgendaBooking["lastOwnerAction"];

function toAgendaBooking(r: BookingRow, last: LastAction, paidCents: number | null): AgendaBooking {
  return {
    id: r.id,
    revision: r.revision,
    resourceId: r.resourceId,
    serviceId: r.serviceId,
    start: toInstant(r.startsAt),
    end: toInstant(r.endsAt),
    status: r.status as AgendaBooking["status"],
    ownerConfirmedAt: toInstantOrNull(r.ownerConfirmedAt),
    cancelledBy: (r.cancelledBy as AgendaBooking["cancelledBy"]) ?? null,
    customerName: r.customerName,
    channel: r.channel as AgendaBooking["channel"],
    noShowAt: toInstantOrNull(r.noShowAt),
    paidCents,
    priceCents: r.priceCents,
    visitNote: r.visitNote,
    lastOwnerAction: last,
  };
}

export function createOwnerRepository(handle: DbHandle): OwnerRepository {
  const { db } = handle;

  /** The latest confirm, move or cancel of each Booking (9.5). */
  async function lastActions(ids: readonly string[]): Promise<Map<string, NonNullable<LastAction>>> {
    const out = new Map<string, NonNullable<LastAction>>();
    if (ids.length === 0) return out;
    const rows = await db
      .select({
        bookingId: ownerActions.bookingId,
        action: ownerActions.action,
        label: ownerActions.actorLabel,
        at: ownerActions.createdAt,
      })
      .from(ownerActions)
      .where(and(inArray(ownerActions.bookingId, [...ids]), inArray(ownerActions.action, ["confirm", "move", "cancel"])))
      .orderBy(desc(ownerActions.createdAt), desc(ownerActions.id));
    for (const r of rows) {
      if (r.bookingId && !out.has(r.bookingId)) {
        out.set(r.bookingId, { action: r.action as OwnerBookingAction, label: r.label, at: toInstant(r.at) });
      }
    }
    return out;
  }

  async function versionOf(shopId: string): Promise<number> {
    const rows = await db.select({ v: shops.machineVersion }).from(shops).where(eq(shops.id, shopId)).limit(1);
    return rows[0]?.v ?? 0;
  }

  /** Runs one command statement; `applied` when it returned a row, else asks `why`. */
  async function run(
    shopId: string,
    statement: SQL,
    why: () => Promise<OwnerCommandResult["status"]>,
  ): Promise<OwnerCommandResult> {
    let status: OwnerCommandResult["status"];
    try {
      status = rowsOf(await db.execute(statement)).length > 0 ? "applied" : await why();
    } catch (err) {
      if (!isOverlapViolation(err)) throw err;
      status = "overlap";
    }
    return { status, version: await versionOf(shopId) };
  }

  async function messageCommand(cmd: Extract<OwnerCommand, { kind: "play" | "erase" }>): Promise<OwnerCommandResult> {
    if (!isUuid(cmd.messageId)) return { status: "not_found", version: await versionOf(cmd.shopId) };
    const now = iso(cmd.now);
    const change =
      cmd.kind === "play"
        ? // Only the first play is recorded; an erased Message has read_at set already.
          sql`UPDATE messages m SET read_at = ${now}::timestamptz
                FROM messages o
               WHERE o.id = m.id AND m.id = ${cmd.messageId}::uuid AND m.shop_id = ${cmd.shopId}
                 AND m.read_at IS NULL AND m.erased_at IS NULL`
        : // Erase is idempotent (8.2) and never touches the Booking (8.4).
          sql`UPDATE messages m SET erased_at = ${now}::timestamptz, read_at = COALESCE(m.read_at, ${now}::timestamptz)
                FROM messages o
               WHERE o.id = m.id AND m.id = ${cmd.messageId}::uuid AND m.shop_id = ${cmd.shopId}
                 AND m.erased_at IS NULL`;
    const statement = sql`
      WITH changed AS (
        ${change}
        RETURNING m.id, (o.read_at IS NOT NULL) AS was_heard, (o.erased_at IS NOT NULL) AS was_erased,
                  (m.read_at IS NOT NULL) AS is_heard, (m.erased_at IS NOT NULL) AS is_erased
      )
      INSERT INTO owner_actions (shop_id, action, message_id, actor_session, actor_label, before, after, created_at)
      SELECT ${cmd.shopId}, ${cmd.kind}, id, ${cmd.actor.sessionId}, ${cmd.actor.label},
             jsonb_build_object('heard', was_heard, 'erased', was_erased),
             jsonb_build_object('heard', is_heard, 'erased', is_erased), ${now}::timestamptz
        FROM changed
      RETURNING id`;
    return run(cmd.shopId, statement, async () => {
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.id, cmd.messageId), eq(messages.shopId, cmd.shopId)))
        .limit(1);
      return rows.length === 0 ? "not_found" : "noop";
    });
  }

  async function bookingCommand(cmd: Extract<OwnerCommand, { kind: "confirm" | "cancel" | "move" }>): Promise<OwnerCommandResult> {
    if (!isUuid(cmd.bookingId)) return { status: "not_found", version: await versionOf(cmd.shopId) };
    const now = iso(cmd.now);
    const set =
      cmd.kind === "move"
        ? // A move keeps id, customer, Service, Channel and links, and drops the confirmation (10.6).
          sql`starts_at = ${iso(cmd.to.start)}::timestamptz, ends_at = ${iso(cmd.to.end)}::timestamptz,
              resource_id = ${cmd.to.resourceId}, owner_confirmed_at = NULL`
        : cmd.kind === "confirm"
          ? sql`owner_confirmed_at = ${now}::timestamptz`
          : sql`status = 'cancelled', cancelled_at = ${now}::timestamptz, cancelled_by = 'owner'`;
    const onlyUnconfirmed = cmd.kind === "confirm" ? sql`AND b.owner_confirmed_at IS NULL` : sql``;
    const state = (alias: string) =>
      sql`jsonb_build_object(
            'start', ${isoSql(`${alias}.starts_at`)}, 'end', ${isoSql(`${alias}.ends_at`)},
            'resourceId', ${sql.raw(`${alias}.resource_id`)}, 'status', ${sql.raw(`${alias}.status`)},
            'ownerConfirmed', ${sql.raw(`${alias}.owner_confirmed_at`)} IS NOT NULL)`;
    // Only an active Booking that has not started, at the revision the Owner saw (10.1, 10.7).
    const statement = sql`
      WITH changed AS (
        UPDATE bookings b SET ${set}
          FROM bookings o
         WHERE o.id = b.id AND b.id = ${cmd.bookingId}::uuid AND b.shop_id = ${cmd.shopId}
           AND b.status = 'confirmed' AND b.revision = ${cmd.revision} AND b.starts_at > ${now}::timestamptz
           ${onlyUnconfirmed}
        RETURNING b.id, ${state("o")} AS before_state, ${state("b")} AS after_state
      )
      INSERT INTO owner_actions (shop_id, action, booking_id, actor_session, actor_label, before, after, created_at)
      SELECT ${cmd.shopId}, ${cmd.kind}, id, ${cmd.actor.sessionId}, ${cmd.actor.label}, before_state, after_state, ${now}::timestamptz
        FROM changed
      RETURNING id`;
    return run(cmd.shopId, statement, async () => {
      const rows = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, cmd.bookingId), eq(bookings.shopId, cmd.shopId)))
        .limit(1);
      const b = rows[0];
      if (!b) return "not_found";
      // Confirming a confirmed, unchanged Booking changes nothing (10.2).
      const unchangedConfirmed =
        cmd.kind === "confirm" &&
        b.revision === cmd.revision &&
        b.status === "confirmed" &&
        b.ownerConfirmedAt !== null &&
        b.startsAt.getTime() > cmd.now.epochMilliseconds;
      return unchangedConfirmed ? "noop" : "stale";
    });
  }

  /** "No vino" or its undo, on a finished booking of the client with this phone, with its Audit_Record. */
  async function noShowCommand(cmd: Extract<OwnerCommand, { kind: "no_show" }>): Promise<OwnerCommandResult> {
    if (!isUuid(cmd.bookingId)) return { status: "not_found", version: await versionOf(cmd.shopId) };
    const now = iso(cmd.now);
    const statement = sql`
      WITH changed AS (
        UPDATE bookings b SET no_show_at = ${cmd.noShow ? sql`${now}::timestamptz` : sql`NULL`}
          FROM bookings o
         WHERE o.id = b.id AND b.id = ${cmd.bookingId}::uuid AND b.shop_id = ${cmd.shopId}
           AND b.customer_phone = ${cmd.phone}
           AND b.status = 'confirmed' AND b.ends_at <= ${now}::timestamptz
           AND (b.no_show_at IS NOT NULL) <> ${cmd.noShow}::boolean
        RETURNING b.id, (o.no_show_at IS NOT NULL) AS was, (b.no_show_at IS NOT NULL) AS is_now
      )
      INSERT INTO owner_actions (shop_id, action, booking_id, actor_session, actor_label, before, after, created_at)
      SELECT ${cmd.shopId}, 'no_show', id, ${cmd.actor.sessionId}, ${cmd.actor.label},
             jsonb_build_object('noShow', was), jsonb_build_object('noShow', is_now), ${now}::timestamptz
        FROM changed
      RETURNING id`;
    return run(cmd.shopId, statement, async () => {
      const rows = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, cmd.bookingId), eq(bookings.shopId, cmd.shopId), eq(bookings.customerPhone, cmd.phone)))
        .limit(1);
      const b = rows[0];
      if (!b) return "not_found";
      // Already in the asked state: nothing to change. Not finished or cancelled: not allowed (stale).
      if (b.status !== "confirmed" || b.endsAt.getTime() > cmd.now.epochMilliseconds) return "stale";
      return "noop";
    });
  }

  type ClientRow = typeof clients.$inferSelect;
  /** Clients with their bookings: one read of the clients, one of the bookings of the same shop and those phones. */
  async function withBookings(shopId: string, rows: ClientRow[]): Promise<ClientRecord[]> {
    if (rows.length === 0) return [];
    // The client's bookings are those of the same shop and phone (the history's rule); the payment is
    // joined by booking id, at most one per booking.
    const found = await db
      .select({ b: bookings, paid: payments.amountCents })
      .from(bookings)
      .leftJoin(payments, and(eq(payments.bookingId, bookings.id), eq(payments.shopId, shopId)))
      .where(and(eq(bookings.shopId, shopId), inArray(bookings.customerPhone, rows.map((r) => r.phone))))
      .orderBy(asc(bookings.startsAt), asc(bookings.id));
    const byPhone = new Map<string, ClientBooking[]>();
    for (const { b, paid } of found) {
      const list = byPhone.get(b.customerPhone) ?? [];
      list.push({
        id: b.id,
        serviceId: b.serviceId,
        start: toInstant(b.startsAt),
        end: toInstant(b.endsAt),
        status: b.status as ClientBooking["status"],
        noShow: b.noShowAt !== null,
        paidCents: paid,
        visitNote: b.visitNote,
      });
      byPhone.set(b.customerPhone, list);
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      language: r.language as Lang,
      note: r.note,
      birthday: r.birthday,
      promoConsentAt: r.promoConsentAt ? toInstant(r.promoConsentAt) : null,
      fields: r.fields,
      spentCents: (byPhone.get(r.phone) ?? []).reduce((n, b) => n + (b.paidCents ?? 0), 0),
      createdAt: toInstant(r.createdAt),
      bookings: byPhone.get(r.phone) ?? [],
    }));
  }

  const D = DEMO_SHOP_ID;
  /** Statements of applyDemoCutoffs that run before the original eight. */
  const SALON_STATEMENTS = 4;
  const oldCalls = (deleteBefore: Date) =>
    db.select({ id: calls.id }).from(calls).where(and(eq(calls.shopId, D), eq(calls.curated, false), lt(calls.startedAt, deleteBefore)));
  const oldBookings = (deleteBefore: Date) =>
    db.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.shopId, D), eq(bookings.curated, false), lt(bookings.endsAt, deleteBefore)));

  return {
    async getShopAccess(shopId) {
      const rows = await db
        .select({ profile: shops.profile, pinHash: shops.ownerPinHash, pinSetAt: shops.ownerPinSetAt, trial: shops.trial })
        .from(shops)
        .where(and(eq(shops.id, shopId), shopIsLive()))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      const parsed = ShopProfileSchema.safeParse(r.profile);
      if (!parsed.success) throw new Error(`Shop "${shopId}" has an invalid profile`);
      return { profile: parsed.data, pinHash: r.pinHash, pinSetAt: toInstantOrNull(r.pinSetAt), trial: r.trial };
    },

    async hitCounters(keys) {
      if (keys.length === 0) return [];
      const rows = await db
        .insert(rateLimits)
        .values(keys.map((k) => ({ key: k.key, windowStart: toDate(k.windowStart), count: 1 })))
        .onConflictDoUpdate({
          target: [rateLimits.key, rateLimits.windowStart],
          set: { count: sql`${rateLimits.count} + 1` },
        })
        .returning({ key: rateLimits.key, windowStart: rateLimits.windowStart, count: rateLimits.count });
      return keys.map(
        (k) =>
          rows.find((r) => r.key === k.key && r.windowStart.getTime() === k.windowStart.epochMilliseconds)?.count ?? 0,
      );
    },

    async pollHead(shopId) {
      const rows = await db
        .select({
          version: shops.machineVersion,
          pinSetAt: shops.ownerPinSetAt,
          newCount: sql<number>`(SELECT count(*) FROM messages m WHERE m.shop_id = "shops"."id" AND m.erased_at IS NULL)`.mapWith(Number),
          unheard: sql<number>`(SELECT count(*) FROM messages m WHERE m.shop_id = "shops"."id" AND m.erased_at IS NULL AND m.read_at IS NULL)`.mapWith(Number),
        })
        .from(shops)
        .where(eq(shops.id, shopId))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { version: r.version, counts: { new: r.newCount, unheard: r.unheard }, pinSetAt: toInstantOrNull(r.pinSetAt) };
    },

    async listTape(shopId, limit) {
      // Qualified by hand: Drizzle leaves a column inside sql`` unqualified in a single-table
      // query (pollHead failed on that, "text = uuid"), and inside this subquery a bare
      // "booking_id" would be owner_actions' own column.
      const movedAt = sql<Date | null>`(SELECT max(oa.created_at) FROM owner_actions oa WHERE oa.booking_id = "messages"."booking_id" AND oa.action = 'move')`.mapWith(
        ownerActions.createdAt,
      );
      const rows = await db
        .select({ m: messages, callLang: calls.language, b: bookings, movedAt })
        .from(messages)
        .innerJoin(calls, eq(calls.id, messages.callId))
        .leftJoin(bookings, eq(bookings.id, messages.bookingId))
        .where(and(eq(messages.shopId, shopId), isNull(messages.erasedAt)))
        .orderBy(desc(messages.createdAt), asc(messages.id))
        .limit(limit);
      return rows.map(
        ({ m, callLang, b, movedAt: moved }): TapeRow => ({
          id: m.id,
          channel: m.channel as Channel,
          createdAt: toInstant(m.createdAt),
          heard: m.readAt !== null,
          callerName: m.callerName,
          callerPhone: m.callerPhone,
          reason: m.reason,
          urgency: m.urgency as Urgency,
          urgencyBasis: m.urgencyBasis ?? null,
          agreed: m.agreed,
          suggestedReply: m.suggestedReply,
          outcome: m.outcome as Outcome,
          modelFailed: m.modelFailed,
          sample: (m.sampleKey as SampleKey | null) ?? null,
          callLang: callLang as Lang,
          booking: b
            ? {
                serviceId: b.serviceId,
                resourceId: b.resourceId,
                start: toInstant(b.startsAt),
                status: b.status as "confirmed" | "cancelled",
                cancelledBy: (b.cancelledBy as "caller" | "owner" | null) ?? null,
                ownerMovedAt: moved ? toInstant(moved) : null,
              }
            : null,
        }),
      );
    },

    async getTranscript(shopId, messageId) {
      if (!isUuid(messageId)) return null;
      const rows = await db
        .select({ lines: calls.transcript, lang: calls.language })
        .from(messages)
        .innerJoin(calls, eq(calls.id, messages.callId))
        .where(and(eq(messages.id, messageId), eq(messages.shopId, shopId), isNull(messages.erasedAt)))
        .limit(1);
      const r = rows[0];
      return r ? { lines: r.lines, lang: r.lang as Lang } : null;
    },

    async listAgenda(shopId, from, to) {
      const rows = await db
        .select({ b: bookings, paid: payments.amountCents })
        .from(bookings)
        .leftJoin(payments, eq(payments.bookingId, bookings.id))
        .where(and(eq(bookings.shopId, shopId), gte(bookings.startsAt, toDate(from)), lt(bookings.startsAt, toDate(to))))
        .orderBy(asc(bookings.startsAt), asc(bookings.id));
      const last = await lastActions(rows.map((r) => r.b.id));
      return rows.map((r) => toAgendaBooking(r.b, last.get(r.b.id) ?? null, r.paid));
    },

    async getBooking(shopId, bookingId) {
      if (!isUuid(bookingId)) return null;
      const rows = await db
        .select({ b: bookings, paid: payments.amountCents })
        .from(bookings)
        .leftJoin(payments, eq(payments.bookingId, bookings.id))
        .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
        .limit(1);
      if (!rows[0]) return null;
      const last = await lastActions([bookingId]);
      return toAgendaBooking(rows[0].b, last.get(bookingId) ?? null, rows[0].paid);
    },

    applyOwnerCommand(cmd) {
      if (cmd.kind === "no_show") return noShowCommand(cmd);
      return "messageId" in cmd ? messageCommand(cmd) : bookingCommand(cmd);
    },

    async listClients(shopId, limit) {
      const rows = await db
        .select()
        .from(clients)
        .where(eq(clients.shopId, shopId))
        .orderBy(desc(clients.updatedAt), asc(clients.id))
        .limit(limit);
      return withBookings(shopId, rows);
    },

    async getClient(shopId, clientId) {
      if (!isUuid(clientId)) return null;
      const rows = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.shopId, shopId)))
        .limit(1);
      return (await withBookings(shopId, rows))[0] ?? null;
    },

    async updateClient(shopId, clientId, patch) {
      if (!isUuid(clientId)) return false;
      const rows = await db
        .update(clients)
        .set({
          updatedAt: sql`now()`,
          ...(patch.note !== undefined && { note: patch.note }),
          ...(patch.birthday !== undefined && { birthday: patch.birthday }),
          ...(patch.promoConsentAt !== undefined && { promoConsentAt: patch.promoConsentAt ? toDate(patch.promoConsentAt) : null }),
          ...(patch.fields !== undefined && { fields: patch.fields }),
        })
        .where(and(eq(clients.id, clientId), eq(clients.shopId, shopId)))
        .returning({ id: clients.id });
      // Consent withdrawn: the promotions waiting for this client are dismissed with it.
      if (rows.length > 0 && patch.promoConsentAt === null) {
        await db
          .update(outbox)
          .set({ status: "dismissed", actedAt: sql`now()` })
          .where(
            and(
              eq(outbox.shopId, shopId),
              eq(outbox.clientId, clientId),
              eq(outbox.status, "prepared"),
              inArray(outbox.kind, ["gap", "winback", "birthday"]),
            ),
          );
      }
      return rows.length > 0;
    },

    setOwnerPin: (shopId, hash, at) => setOwnerPin(db, shopId, hash, at),

    async claimDemoRetention(now) {
      // The row lock makes concurrent claims return one row in total (16.6).
      const rows = await db
        .update(shops)
        .set({ demoSweptAt: toDate(now) })
        .where(
          and(
            eq(shops.id, D),
            or(isNull(shops.demoSweptAt), lte(shops.demoSweptAt, toDate(now.subtract({ minutes: DEMO_RETENTION_EVERY_MIN })))),
          ),
        )
        .returning({ id: shops.id });
      return rows.length > 0;
    },

    async applyDemoCutoffs(c: DemoCutoffs) {
      const now = toDate(c.now);
      const eraseBefore = toDate(c.eraseBefore);
      const deleteBefore = toDate(c.deleteBefore);
      // One transaction, in foreign-key order (design, "Demo_Retention", step 2). Every
      // statement names the Demo_Shop, so no Real_Shop row can match (16.1).
      const results = await handle.atomic((q) => [
        // 0. Salon rows of visitors (salon 0009), first so a payment never outlives its booking:
        // payments by paid_at or because their booking goes, then outbox, blocks and expenses.
        q
          .delete(payments)
          .where(
            and(
              eq(payments.shopId, D),
              eq(payments.curated, false),
              or(lt(payments.paidAt, deleteBefore), inArray(payments.bookingId, oldBookings(deleteBefore))),
            ),
          )
          .returning({ id: payments.id }),
        q
          .delete(outbox)
          .where(and(eq(outbox.shopId, D), eq(outbox.curated, false), lt(outbox.createdAt, deleteBefore)))
          .returning({ id: outbox.id }),
        q
          .delete(timeBlocks)
          .where(and(eq(timeBlocks.shopId, D), eq(timeBlocks.curated, false), lt(timeBlocks.endsAt, deleteBefore)))
          .returning({ id: timeBlocks.id }),
        q
          .delete(expenses)
          .where(and(eq(expenses.shopId, D), eq(expenses.curated, false), lt(expenses.createdAt, deleteBefore)))
          .returning({ id: expenses.id }),
        // 1. Erase New_Messages older than 24 h (16.2). Not an Owner_Action: no Audit_Record.
        q
          .update(messages)
          .set({ erasedAt: now, readAt: sql`COALESCE(${messages.readAt}, ${now})` })
          .where(
            and(eq(messages.shopId, D), eq(messages.curated, false), isNull(messages.erasedAt), lt(messages.createdAt, eraseBefore)),
          )
          .returning({ id: messages.id }),
        // 2. Audit_Records of the Messages and Bookings about to go (16.3).
        q
          .delete(ownerActions)
          .where(
            and(
              eq(ownerActions.shopId, D),
              or(
                inArray(
                  ownerActions.messageId,
                  q
                    .select({ id: messages.id })
                    .from(messages)
                    .where(and(eq(messages.shopId, D), inArray(messages.callId, oldCalls(deleteBefore)))),
                ),
                inArray(ownerActions.bookingId, oldBookings(deleteBefore)),
              ),
            ),
          )
          .returning({ id: ownerActions.id }),
        // 3. A Message that stays loses its link to a Booking that goes.
        q
          .update(messages)
          .set({ bookingId: null })
          .where(
            and(
              eq(messages.shopId, D),
              isNotNull(messages.bookingId),
              inArray(messages.bookingId, oldBookings(deleteBefore)),
              notInArray(messages.callId, oldCalls(deleteBefore)),
            ),
          )
          .returning({ id: messages.id }),
        // 4. Messages of old Calls, old Bookings, the links of Bookings that stay, then the Calls.
        q
          .delete(messages)
          .where(and(eq(messages.shopId, D), eq(messages.curated, false), inArray(messages.callId, oldCalls(deleteBefore))))
          .returning({ id: messages.id }),
        q
          .delete(bookings)
          .where(and(eq(bookings.shopId, D), eq(bookings.curated, false), lt(bookings.endsAt, deleteBefore)))
          .returning({ id: bookings.id }),
        q
          .update(bookings)
          .set({ callId: null })
          .where(and(eq(bookings.shopId, D), inArray(bookings.callId, oldCalls(deleteBefore))))
          .returning({ id: bookings.id }),
        q
          .delete(calls)
          .where(and(eq(calls.shopId, D), eq(calls.curated, false), lt(calls.startedAt, deleteBefore)))
          .returning({ id: calls.id }),
        // 5. Clients the demo's visitors made (a name and a phone), as old as the Calls that made them.
        q
          .delete(clients)
          .where(and(eq(clients.shopId, D), eq(clients.curated, false), lt(clients.updatedAt, deleteBefore)))
          .returning({ id: clients.id }),
      ]);
      const n = (k: number) => rowsOf(results[k + SALON_STATEMENTS]).length;
      return { erased: n(0), deletedAuditRecords: n(1), deletedMessages: n(3), deletedBookings: n(4), deletedCalls: n(6), deletedClients: n(7) };
    },

    async demoTapeState() {
      const [{ n }] = await db
        .select({ n: count() })
        .from(messages)
        .where(and(eq(messages.shopId, D), isNull(messages.erasedAt)));
      const keys = await db
        .selectDistinct({ key: messages.sampleKey })
        .from(messages)
        .where(and(eq(messages.shopId, D), isNull(messages.erasedAt), isNotNull(messages.sampleKey)));
      return { newCount: n, activeSampleKeys: keys.map((k) => k.key as SampleKey) };
    },

    async insertDemoSamples(samples: readonly DemoSample[]) {
      if (samples.length === 0) return 0;
      // No Booking row, ever, even for the booking sample (16.5). A duplicate active sample
      // fails messages_sample_uq and the whole insert rolls back.
      await handle.atomic((q) =>
        samples.flatMap((s) => {
          const at = toDate(s.call.startedAt);
          return [
            q.insert(calls).values({
              id: s.call.id,
              shopId: D,
              channel: s.call.channel,
              language: s.call.language,
              status: "completed",
              state: { ...initialCallState(s.call.language), stage: "done" },
              transcript: s.call.transcript,
              turnCount: Math.max(0, s.call.transcript.length - 1),
              startedAt: at,
              updatedAt: at,
              endedAt: at,
            }),
            q.insert(messages).values({
              shopId: D,
              callId: s.call.id,
              channel: s.call.channel,
              callerName: s.message.callerName,
              callerPhone: s.message.callerPhone,
              reason: s.message.reason,
              urgency: s.message.urgency,
              urgencySuggested: s.message.urgencySuggested,
              urgencyBasis: s.message.urgencyBasis,
              agreed: s.message.agreed,
              suggestedReply: s.message.suggestedReply,
              outcome: s.message.outcome,
              modelFailed: s.message.modelFailed,
              sampleKey: s.key,
              createdAt: at,
            }),
          ];
        }),
      );
      return samples.length;
    },
  };
}

/**
 * The SalonRepository port on Drizzle (lib/salon/types.ts).
 *
 * - A manual booking is one atomic batch: the client upsert, the booking and its `book`
 *   Audit_Record. The no-overlap constraint still guards the race (23P01 becomes `overlap`).
 * - A payment is ONE statement, a data-modifying CTE: the payment and its `pay` Audit_Record
 *   exist together or not at all, and a booking that is missing, cancelled, too far ahead or
 *   already paid writes nothing. It also touches the booking row, so the Machine_Version
 *   moves and every open machine sees "done" at its next Poll.
 */
import { and, asc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { ExpenseCategory, ExpenseRow } from "@/lib/salon/month";
import type { ManualBooking, NewExpense, NewBlock, NewPayment, PaymentMethod, PaymentRow, SalonRepository, TimeBlock } from "@/lib/salon/types";
import { clientUpsert, isOverlapViolation, type DbHandle } from "./repository";
import { isUuid } from "./ownerRepository";
import { bookings, calls, expenses, outbox, ownerActions, payments, shopSettings, timeBlocks } from "./schema";

const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());
const E164 = /^\+[0-9]{6,15}$/;

/** The most a pay can be made ahead of the start (spec: 12 h). */
export const PAY_AHEAD_HOURS = 12;

type BlockRow = typeof timeBlocks.$inferSelect;
const toBlock = (r: BlockRow): TimeBlock => ({
  id: r.id,
  resourceId: r.resourceId,
  start: toInstant(r.startsAt),
  end: toInstant(r.endsAt),
  reason: r.reason,
});

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

export function createSalonRepository(handle: DbHandle): SalonRepository {
  const { db } = handle;

  return {
    async insertManualBooking(b: ManualBooking) {
      const id = crypto.randomUUID();
      const linked = E164.test(b.phone);
      try {
        await handle.atomic((q) => [
          ...clientUpsert(q, b.shopId, b.name, linked ? b.phone : null, null),
          q.insert(bookings).values({
            id,
            shopId: b.shopId,
            resourceId: b.resourceId,
            serviceId: b.serviceId,
            startsAt: toDate(b.start),
            endsAt: toDate(b.end),
            customerName: b.name,
            customerPhone: b.phone,
            channel: "manual",
            callId: null,
            ownerConfirmedAt: toDate(b.now),
            priceCents: b.priceCents,
            clientId: linked
              ? sql`(SELECT c.id FROM clients c WHERE c.shop_id = ${b.shopId} AND c.phone = ${b.phone})`
              : null,
          }),
          q.insert(ownerActions).values({
            shopId: b.shopId,
            action: "book",
            bookingId: id,
            actorSession: b.actor.sessionId,
            actorLabel: b.actor.label,
            before: {},
            after: {
              start: b.start.toString(),
              end: b.end.toString(),
              resourceId: b.resourceId,
              status: "confirmed",
              ownerConfirmed: true,
            },
            createdAt: toDate(b.now),
          }),
        ]);
      } catch (err) {
        if (isOverlapViolation(err)) return { ok: false as const, reason: "overlap" as const };
        throw err;
      }
      return { ok: true as const, id };
    },

    async listBlocks(shopId, from, to) {
      const rows = await db
        .select()
        .from(timeBlocks)
        .where(and(eq(timeBlocks.shopId, shopId), lt(timeBlocks.startsAt, toDate(to)), sql`${timeBlocks.endsAt} > ${toDate(from)}`))
        .orderBy(asc(timeBlocks.startsAt), asc(timeBlocks.id));
      return rows.map(toBlock);
    },

    async insertBlock(b: NewBlock) {
      const [row] = await db
        .insert(timeBlocks)
        .values({ shopId: b.shopId, resourceId: b.resourceId, startsAt: toDate(b.start), endsAt: toDate(b.end), reason: b.reason })
        .returning();
      return toBlock(row);
    },

    async deleteBlock(shopId, id) {
      if (!isUuid(id)) return false;
      const rows = await db
        .delete(timeBlocks)
        .where(and(eq(timeBlocks.id, id), eq(timeBlocks.shopId, shopId)))
        .returning({ id: timeBlocks.id });
      return rows.length > 0;
    },

    async insertPayment(p: NewPayment) {
      const now = p.now.toString();
      if (p.bookingId === null) {
        // A product-only sale writes no audit row on purpose: owner_actions needs a booking or a message as its target.
        const [row] = await db
          .insert(payments)
          .values({
            shopId: p.shopId,
            bookingId: null,
            amountCents: p.amountCents,
            productCents: p.productCents,
            productLabel: p.productLabel,
            method: p.method,
            paidAt: toDate(p.now),
          })
          .returning({ id: payments.id });
        return { ok: true as const, id: row.id };
      }
      if (!isUuid(p.bookingId)) return { ok: false as const };
      const limit = p.now.add({ hours: PAY_AHEAD_HOURS }).toString();
      const statement = sql`
        WITH target AS (
          SELECT b.id FROM bookings b
           WHERE b.id = ${p.bookingId}::uuid AND b.shop_id = ${p.shopId}
             AND b.status = 'confirmed' AND b.starts_at <= ${limit}::timestamptz
             FOR UPDATE
        ),
        paid AS (
          INSERT INTO payments (shop_id, booking_id, amount_cents, product_cents, product_label, method, paid_at)
          SELECT ${p.shopId}, target.id, ${p.amountCents}, ${p.productCents}, ${p.productLabel}, ${p.method}, ${now}::timestamptz
            FROM target
          ON CONFLICT (booking_id) DO NOTHING
          RETURNING id, booking_id
        ),
        touched AS (
          UPDATE bookings b SET visit_note = b.visit_note FROM paid WHERE b.id = paid.booking_id RETURNING b.id
        ),
        audit AS (
          INSERT INTO owner_actions (shop_id, action, booking_id, actor_session, actor_label, before, after, created_at)
          SELECT ${p.shopId}, 'pay', paid.booking_id, ${p.actor.sessionId}, ${p.actor.label},
                 '{}'::jsonb, jsonb_build_object('paidCents', ${p.amountCents}::int, 'method', ${p.method}::text), ${now}::timestamptz
            FROM paid
          RETURNING id
        )
        SELECT paid.id FROM paid`;
      const rows = rowsOf(await db.execute(statement));
      const id = rows[0]?.id;
      return typeof id === "string" ? { ok: true as const, id } : { ok: false as const };
    },

    async setVisitNote(shopId, bookingId, note) {
      if (!isUuid(bookingId)) return false;
      const rows = await db
        .update(bookings)
        .set({ visitNote: note })
        .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
        .returning({ id: bookings.id });
      return rows.length > 0;
    },

    async listPayments(shopId, from, to) {
      const rows = await db
        .select({ p: payments, serviceId: bookings.serviceId, resourceId: bookings.resourceId })
        .from(payments)
        .leftJoin(bookings, and(eq(bookings.id, payments.bookingId), eq(bookings.shopId, shopId)))
        .where(and(eq(payments.shopId, shopId), gte(payments.paidAt, toDate(from)), lt(payments.paidAt, toDate(to))))
        .orderBy(asc(payments.paidAt), asc(payments.id));
      return rows.map(
        ({ p: r, serviceId, resourceId }): PaymentRow => ({
          id: r.id,
          bookingId: r.bookingId,
          amountCents: r.amountCents,
          productCents: r.productCents,
          productLabel: r.productLabel,
          method: r.method as PaymentMethod,
          paidAt: toInstant(r.paidAt),
          serviceId,
          resourceId,
        }),
      );
    },

    async listExpenses(shopId, month) {
      const rows = await db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.shopId, shopId),
            or(
              and(eq(expenses.recurring, false), sql`${expenses.day} >= ${`${month}-01`}::date`, sql`${expenses.day} < (${`${month}-01`}::date + interval '1 month')`),
              and(eq(expenses.recurring, true), sql`${expenses.startMonth} <= ${month}`, or(isNull(expenses.endMonth), sql`${expenses.endMonth} >= ${month}`)),
            ),
          ),
        )
        .orderBy(asc(expenses.createdAt), asc(expenses.id));
      return rows.map(
        (r): ExpenseRow => ({
          id: r.id,
          concept: r.concept,
          category: r.category as ExpenseCategory,
          amountCents: r.amountCents,
          day: r.day,
          recurring: r.recurring,
          startMonth: r.startMonth,
          endMonth: r.endMonth,
        }),
      );
    },

    async insertExpense(e: NewExpense) {
      const [row] = await db
        .insert(expenses)
        .values({
          shopId: e.shopId,
          concept: e.concept,
          category: e.category,
          amountCents: e.amountCents,
          day: e.recurring ? null : e.day,
          recurring: e.recurring,
          startMonth: e.recurring ? e.day.slice(0, 7) : null,
        })
        .returning({ id: expenses.id });
      return row.id;
    },

    async countExpenses(shopId) {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(expenses).where(eq(expenses.shopId, shopId));
      return row.n;
    },

    async countBlocks(shopId) {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(timeBlocks).where(eq(timeBlocks.shopId, shopId));
      return row.n;
    },

    async endRecurring(shopId, id, lastMonth) {
      if (!isUuid(id)) return false;
      const mine = and(eq(expenses.id, id), eq(expenses.shopId, shopId), eq(expenses.recurring, true));
      const found = await db.select({ start: expenses.startMonth }).from(expenses).where(mine).limit(1);
      if (found.length === 0) return false;
      // Never active up to `lastMonth` (it began after it): nothing of it belongs to a past month, so it goes.
      if ((found[0].start ?? "") > lastMonth) {
        await db.delete(expenses).where(mine);
        return true;
      }
      await db
        .update(expenses)
        .set({ endMonth: lastMonth })
        .where(and(mine, or(isNull(expenses.endMonth), sql`${expenses.endMonth} > ${lastMonth}`)));
      return true;
    },

    async deleteExpense(shopId, id) {
      if (!isUuid(id)) return false;
      const rows = await db
        .delete(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.shopId, shopId)))
        .returning({ id: expenses.id });
      return rows.length > 0;
    },

    async listMonthBookings(shopId, from, to) {
      const rows = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, shopId),
            or(
              and(gte(bookings.createdAt, toDate(from)), lt(bookings.createdAt, toDate(to))),
              and(gte(bookings.startsAt, toDate(from)), lt(bookings.startsAt, toDate(to)), sql`${bookings.noShowAt} IS NOT NULL`),
            ),
          ),
        );
      return rows.map((r) => ({
        id: r.id,
        serviceId: r.serviceId,
        resourceId: r.resourceId,
        channel: r.channel,
        status: r.status,
        createdAt: toInstant(r.createdAt),
        start: toInstant(r.startsAt),
        noShow: r.noShowAt !== null,
        priceCents: r.priceCents,
        rescheduledFrom: r.rescheduledFrom,
        phone: r.customerPhone,
      }));
    },

    async listMonthCalls(shopId, from, to) {
      const rows = await db
        .select({ status: calls.status, startedAt: calls.startedAt, endedAt: calls.endedAt })
        .from(calls)
        .where(and(eq(calls.shopId, shopId), gte(calls.startedAt, toDate(from)), lt(calls.startedAt, toDate(to))));
      return rows.map((r) => ({ status: r.status, startedAt: toInstant(r.startedAt), endedAt: r.endedAt ? toInstant(r.endedAt) : null }));
    },

    async listGapSends(shopId, from, to) {
      const rows = await db
        .select({ phone: outbox.phone, actedAt: outbox.actedAt, createdAt: outbox.createdAt })
        .from(outbox)
        .where(
          and(
            eq(outbox.shopId, shopId),
            eq(outbox.kind, "gap"),
            eq(outbox.status, "sent"),
            sql`coalesce(${outbox.actedAt}, ${outbox.createdAt}) >= ${toDate(from).toISOString()}::timestamptz`,
            sql`coalesce(${outbox.actedAt}, ${outbox.createdAt}) < ${toDate(to).toISOString()}::timestamptz`,
          ),
        );
      return rows.map((r) => ({ phone: r.phone, sentAt: toInstant(r.actedAt ?? r.createdAt) }));
    },

    async vatRatePct(shopId) {
      const rows = await db.select({ v: shopSettings.vatRatePct }).from(shopSettings).where(eq(shopSettings.shopId, shopId)).limit(1);
      return rows[0]?.v ?? 21;
    },
  };
}

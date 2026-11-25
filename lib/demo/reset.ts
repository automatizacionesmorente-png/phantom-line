/**
 * `npm run demo:reset`: wipes the Demo_Shop's Calls, Messages and Bookings (and the Audit_Records
 * that point at them) and loads the curated set, in one atomic write. Every statement names the
 * Demo_Shop, so no other shop's row can be touched. It also rebuilds the salon month (payments,
 * expenses, blocks, settings, outbox), all `curated`, so Demo_Retention keeps them. Running it twice leaves the same set
 * (the ids differ, the content does not).
 */
import { and, count, eq, inArray } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { initialCallState } from "@/lib/conversation/types";
import {
  bookings,
  calls,
  clients,
  expenses,
  messages,
  outbox,
  ownerActions,
  payments,
  shopSettings,
  shops,
  timeBlocks,
} from "@/lib/db/schema";
import type { DbHandle } from "@/lib/db/repository";
import { DEMO_SHOP_ID } from "@/lib/owner/demo";
import { buildCuratedSet, TEST_BOOKING_NAMES, type CuratedSet } from "./curated";

export interface ResetResult {
  deleted: { calls: number; messages: number; bookings: number; testBookings: number };
  loaded: { calls: number; messages: number; bookings: number };
  set: CuratedSet;
}

const D = DEMO_SHOP_ID;
const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);

export async function resetDemo(
  handle: DbHandle,
  opts: { now: Temporal.Instant; newId: () => string },
): Promise<ResetResult> {
  const { db } = handle;
  const rows = await db.select({ profile: shops.profile }).from(shops).where(eq(shops.id, D)).limit(1);
  if (!rows[0]) throw new Error(`the demo shop "${D}" does not exist; run npm run db:seed first`);
  const set = buildCuratedSet({ now: opts.now, shop: rows[0].profile, newId: opts.newId });

  const n = async (table: typeof calls | typeof messages | typeof bookings) => {
    const [r] = await db.select({ n: count() }).from(table).where(eq(table.shopId, D));
    return r.n;
  };
  const [oldCalls, oldMessages, oldBookings] = [await n(calls), await n(messages), await n(bookings)];
  const [testRow] = await db
    .select({ n: count() })
    .from(bookings)
    .where(and(eq(bookings.shopId, D), inArray(bookings.customerName, [...TEST_BOOKING_NAMES])));

  const at = toDate(opts.now);
  await handle.atomic((q) => [
    // Foreign-key order: audit records, salon rows, messages, bookings, clients, calls.
    q.delete(ownerActions).where(eq(ownerActions.shopId, D)),
    q.delete(outbox).where(eq(outbox.shopId, D)),
    q.delete(payments).where(eq(payments.shopId, D)),
    q.delete(timeBlocks).where(eq(timeBlocks.shopId, D)),
    q.delete(expenses).where(eq(expenses.shopId, D)),
    q.delete(shopSettings).where(eq(shopSettings.shopId, D)),
    q.delete(messages).where(eq(messages.shopId, D)),
    q.delete(bookings).where(eq(bookings.shopId, D)),
    q.delete(clients).where(eq(clients.shopId, D)),
    q.delete(calls).where(eq(calls.shopId, D)),
    q.insert(calls).values(
      set.calls.map((c) => ({
        id: c.id,
        shopId: D,
        channel: "voice",
        language: c.language,
        status: "completed",
        state: { ...initialCallState(c.language), stage: "done" as const },
        transcript: c.transcript,
        turnCount: Math.max(0, c.transcript.length - 1),
        startedAt: toDate(c.startedAt),
        updatedAt: toDate(c.endedAt),
        endedAt: toDate(c.endedAt),
        curated: true,
      })),
    ),
    q.insert(clients).values(
      set.clients.map((c) => ({
        id: c.id,
        shopId: D,
        phone: c.phone,
        name: c.name,
        language: c.language,
        note: c.note,
        birthday: c.birthday,
        promoConsentAt: c.promoConsent ? at : null,
        createdAt: at,
        updatedAt: at,
        curated: true,
      })),
    ),
    q.insert(bookings).values(
      set.bookings.map((b) => ({
        id: b.id,
        shopId: D,
        resourceId: b.resourceId,
        serviceId: b.serviceId,
        startsAt: toDate(b.startsAt),
        endsAt: toDate(b.endsAt),
        status: "confirmed",
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        channel: "voice",
        callId: b.callId,
        createdAt: b.createdAt ? toDate(b.createdAt) : at,
        ownerConfirmedAt: b.ownerConfirmed ? at : null,
        clientId: b.clientId ?? null,
        priceCents: b.priceCents ?? null,
        curated: true,
      })),
    ),
    // The clients tab: past bookings (with the Owner's "No vino" where it applies) and the clients.
    q.insert(bookings).values(
      set.history.map((b) => ({
        id: b.id,
        shopId: D,
        resourceId: b.resourceId,
        serviceId: b.serviceId,
        startsAt: toDate(b.startsAt),
        endsAt: toDate(b.endsAt),
        status: "confirmed",
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        channel: "voice",
        callId: null,
        createdAt: toDate(b.startsAt.subtract({ hours: 48 })),
        ownerConfirmedAt: toDate(b.startsAt.subtract({ hours: 24 })),
        noShowAt: b.noShow ? toDate(b.endsAt) : null,
        clientId: b.clientId ?? null,
        priceCents: b.priceCents ?? null,
        curated: true,
      })),
    ),
    // The past month: receptionist and manual bookings, some cancelled or "No vino".
    q.insert(bookings).values(
      set.salon.month.map((b) => ({
        id: b.id,
        shopId: D,
        resourceId: b.resourceId,
        serviceId: b.serviceId,
        startsAt: toDate(b.startsAt),
        endsAt: toDate(b.endsAt),
        status: b.status,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        channel: b.channel,
        callId: b.callId,
        createdAt: toDate(b.createdAt),
        cancelledAt: b.cancelledAt ? toDate(b.cancelledAt) : null,
        cancelledBy: b.cancelledBy,
        ownerConfirmedAt: b.ownerConfirmed ? toDate(b.createdAt) : null,
        noShowAt: b.noShow ? toDate(b.endsAt) : null,
        clientId: b.clientId,
        priceCents: b.priceCents,
        visitNote: b.visitNote,
        curated: true,
      })),
    ),
    q.insert(payments).values(
      set.salon.payments.map((p) => ({
        shopId: D,
        bookingId: p.bookingId,
        amountCents: p.amountCents,
        productCents: p.productCents,
        productLabel: p.productLabel,
        method: p.method,
        paidAt: toDate(p.paidAt),
        curated: true,
      })),
    ),
    q.insert(expenses).values(
      set.salon.expenses.map((x) => ({ shopId: D, ...x, createdAt: at, curated: true })),
    ),
    q.insert(timeBlocks).values(
      set.salon.blocks.map((x) => ({
        shopId: D,
        resourceId: x.resourceId,
        startsAt: toDate(x.startsAt),
        endsAt: toDate(x.endsAt),
        reason: x.reason,
        createdAt: at,
        curated: true,
      })),
    ),
    q.insert(shopSettings).values({
      shopId: D,
      automations: set.salon.settings.automations,
      googleReviewUrl: set.salon.settings.googleReviewUrl,
      vatRatePct: set.salon.settings.vatRatePct,
      updatedAt: at,
    }),
    q.insert(messages).values(
      set.messages.map((m) => ({
        shopId: D,
        callId: m.callId,
        channel: "voice",
        callerName: m.callerName,
        callerPhone: m.callerPhone,
        reason: m.reason,
        urgency: m.urgency,
        urgencySuggested: m.urgencySuggested,
        urgencyBasis: m.urgencyBasis,
        agreed: m.agreed,
        suggestedReply: m.suggestedReply,
        outcome: m.outcome,
        bookingId: m.bookingId,
        createdAt: toDate(m.createdAt),
        curated: true,
      })),
    ),
    ...(set.salon.outbox.length > 0
      ? [
          q.insert(outbox).values(
            set.salon.outbox.map((o) => ({
              shopId: D,
              kind: o.kind,
              dedupeKey: o.dedupeKey,
              clientId: o.clientId,
              bookingId: o.bookingId,
              phone: o.phone,
              language: o.language,
              body: o.body,
              status: o.status,
              createdAt: toDate(o.createdAt),
              actedAt: o.actedAt ? toDate(o.actedAt) : null,
              curated: true,
            })),
          ),
        ]
      : []),
  ]);

  return {
    deleted: { calls: oldCalls, messages: oldMessages, bookings: oldBookings, testBookings: testRow.n },
    loaded: { calls: set.calls.length, messages: set.messages.length, bookings: set.bookings.length },
    set,
  };
}

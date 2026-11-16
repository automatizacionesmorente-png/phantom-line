import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { initialCallState, type Line } from "@/lib/conversation/types";
import { createOwnerRepository } from "@/lib/db/ownerRepository";
import { bookings, calls, messages, ownerActions, shops } from "@/lib/db/schema";
import type { SampleKey } from "@/lib/owner/api";
import type { Actor, OwnerRepository } from "@/lib/owner/types";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "./pglite";

/** A Real_Shop next to the Demo_Shop: same hours and chairs, another id and name. */
export const realProfile: ShopProfile = { ...lolaProfile, id: "barberia-real", name: "Barbería Real" };

export const ACTOR: Actor = { sessionId: "c2Vzc2lvbi1pZC0xMjM0", label: "Lola" };

export const ownerRepoOf = (t: TestDb): OwnerRepository => createOwnerRepository(t.handle);

const d = (i: Temporal.Instant | string) => new Date(typeof i === "string" ? i : i.epochMilliseconds);

export async function addCall(
  t: TestDb,
  shopId: string,
  o: { id?: string; startedAt?: Temporal.Instant | string; status?: "open" | "completed" | "abandoned"; transcript?: Line[] } = {},
): Promise<string> {
  const id = o.id ?? randomUUID();
  const at = d(o.startedAt ?? "2026-11-10T07:00:00Z");
  await t.handle.db.insert(calls).values({
    id,
    shopId,
    channel: "voice",
    language: "es",
    status: o.status ?? "completed",
    state: { ...initialCallState("es"), stage: o.status === "open" ? "collecting" : "done" },
    transcript: o.transcript ?? [],
    turnCount: o.transcript?.length ?? 0,
    startedAt: at,
    updatedAt: at,
    endedAt: o.status === "open" ? null : at,
  });
  return id;
}

export async function addMessage(
  t: TestDb,
  shopId: string,
  callId: string,
  o: {
    createdAt?: Temporal.Instant | string;
    bookingId?: string;
    name?: string;
    phone?: string;
    reason?: string;
    heard?: boolean;
    erasedAt?: Temporal.Instant | string;
    sampleKey?: SampleKey;
  } = {},
): Promise<string> {
  const createdAt = d(o.createdAt ?? "2026-11-10T07:05:00Z");
  const [row] = await t.handle.db
    .insert(messages)
    .values({
      shopId,
      callId,
      channel: "voice",
      callerName: o.name ?? "Ana",
      callerPhone: o.phone ?? "+34612345678",
      reason: o.reason ?? "Quiere una cita de corte",
      urgency: "normal",
      agreed: "Cita de corte",
      suggestedReply: "Hola",
      outcome: o.bookingId ? "booked" : "message",
      modelFailed: false,
      bookingId: o.bookingId ?? null,
      readAt: o.heard || o.erasedAt ? createdAt : null,
      erasedAt: o.erasedAt ? d(o.erasedAt) : null,
      sampleKey: o.sampleKey ?? null,
      createdAt,
    })
    .returning({ id: messages.id });
  return row.id;
}

export async function addBooking(
  t: TestDb,
  shopId: string,
  o: {
    start: Temporal.Instant | string;
    minutes?: number;
    resourceId?: string;
    callId?: string | null;
    name?: string;
    phone?: string;
    status?: "confirmed" | "cancelled";
  },
): Promise<string> {
  const start = typeof o.start === "string" ? Temporal.Instant.from(o.start) : o.start;
  const [row] = await t.handle.db
    .insert(bookings)
    .values({
      shopId,
      resourceId: o.resourceId ?? "chair-1",
      serviceId: "haircut",
      startsAt: d(start),
      endsAt: d(start.add({ minutes: o.minutes ?? 30 })),
      status: o.status ?? "confirmed",
      customerName: o.name ?? "Ana",
      customerPhone: o.phone ?? "+34612345678",
      channel: "voice",
      callId: o.callId ?? null,
      cancelledAt: o.status === "cancelled" ? d(start) : null,
    })
    .returning({ id: bookings.id });
  return row.id;
}

export async function versionOf(t: TestDb, shopId: string): Promise<number> {
  const rows = await t.handle.db.select({ v: shops.machineVersion }).from(shops).where(eq(shops.id, shopId));
  return rows[0]?.v ?? -1;
}

export async function bookingRow(t: TestDb, id: string) {
  const [row] = await t.handle.db.select().from(bookings).where(eq(bookings.id, id));
  return row;
}

export async function messageRow(t: TestDb, id: string) {
  const [row] = await t.handle.db.select().from(messages).where(eq(messages.id, id));
  return row;
}

export const auditRows = (t: TestDb) => t.handle.db.select().from(ownerActions).orderBy(asc(ownerActions.createdAt), asc(ownerActions.id));

/** Every Message and Booking row of a shop, as stable JSON: the oracle for "this shop changed". */
export async function shopSnapshot(t: TestDb, shopId: string): Promise<string> {
  const ms = await t.handle.db.select().from(messages).where(eq(messages.shopId, shopId)).orderBy(asc(messages.id));
  const bs = await t.handle.db.select().from(bookings).where(eq(bookings.shopId, shopId)).orderBy(asc(bookings.id));
  return JSON.stringify({ ms, bs });
}

/** Every row of a shop in calls, messages, bookings and owner_actions, plus its shop row without the retention throttle. */
export async function fullSnapshot(t: TestDb, shopId: string): Promise<string> {
  const q = (table: string) =>
    t.handle.db.execute(sql.raw(`SELECT to_jsonb(x) AS j FROM ${table} x WHERE shop_id = '${shopId}' ORDER BY id`));
  const rowsOf = (r: unknown) => ((r as { rows: { j: unknown }[] }).rows ?? []).map((x) => x.j);
  const shop = await t.handle.db.execute(
    sql.raw(`SELECT to_jsonb(s) - 'demo_swept_at' AS j FROM shops s WHERE id = '${shopId}'`),
  );
  return JSON.stringify({
    shop: rowsOf(shop),
    calls: rowsOf(await q("calls")),
    messages: rowsOf(await q("messages")),
    bookings: rowsOf(await q("bookings")),
    ownerActions: rowsOf(await q("owner_actions")),
  });
}

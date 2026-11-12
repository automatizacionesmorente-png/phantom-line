import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { initialCallState, type NewBooking, type Write } from "@/lib/conversation/types";
import { shops } from "@/lib/db/schema";
import type { TestDb } from "./pglite";

export async function insertShop(t: TestDb, profile: ShopProfile): Promise<void> {
  await t.handle.db.insert(shops).values({
    id: profile.id,
    name: profile.name,
    sectorPackId: profile.sectorPackId,
    timeZone: profile.timeZone,
    profile,
  });
}

export function callWrite(shopId: string, id = randomUUID()): Extract<Write, { type: "insertCall" }> {
  return {
    type: "insertCall",
    call: {
      id,
      shopId,
      channel: "voice",
      language: "es",
      status: "open",
      state: initialCallState("es"),
      transcript: [],
      turnCount: 0,
    },
  };
}

export function bookingWrite(
  over: Partial<Omit<NewBooking, "start">> & { shopId: string; callId: string; start: string; minutes?: number },
): Extract<Write, { type: "insertBooking" }> {
  const start = Temporal.Instant.from(over.start);
  return {
    type: "insertBooking",
    booking: {
      id: over.id ?? randomUUID(),
      shopId: over.shopId,
      resourceId: over.resourceId ?? "chair-1",
      serviceId: over.serviceId ?? "haircut",
      start,
      end: over.end ?? start.add({ minutes: over.minutes ?? 30 }),
      customerName: over.customerName ?? "Ana",
      customerPhone: over.customerPhone ?? "+34612345678",
      channel: over.channel ?? "voice",
      callId: over.callId,
      rescheduledFrom: over.rescheduledFrom,
    },
  };
}

export function messageWrite(shopId: string, callId: string, bookingId?: string): Extract<Write, { type: "insertMessage" }> {
  return {
    type: "insertMessage",
    message: {
      shopId,
      callId,
      channel: "voice",
      bookingId,
      callerName: "Ana",
      callerPhone: "+34612345678",
      reason: "Quiere una cita de corte",
      urgency: "normal",
      agreed: "Cita de corte",
      suggestedReply: "Hola Ana",
      outcome: bookingId ? "booked" : "message",
      modelFailed: false,
    },
  };
}

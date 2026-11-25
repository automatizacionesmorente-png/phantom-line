import type { BlocksResponse, PaymentsDayResponse, VisitNoteResponse, VisitNoteTextResponse } from "@/lib/salon/api";
import { read, type ApiAnswer } from "../bookingApi";

/** The Today screen's reads and the visit note, over the existing Machine_API routes. A network failure is status 0. */
const root = (shopId: string) => `/api/machine/${encodeURIComponent(shopId)}`;

async function get<T>(url: string): Promise<ApiAnswer<T>> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    return await read<T>(res);
  } catch {
    return { status: 0, ok: false, body: null };
  }
}

export const getBlocks = (shopId: string, from: string, to: string) =>
  get<BlocksResponse>(`${root(shopId)}/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

export const getPaymentsDay = (shopId: string, day: string) =>
  get<PaymentsDayResponse>(`${root(shopId)}/payments?day=${encodeURIComponent(day)}`);

export const getVisitNote = (shopId: string, bookingId: string) =>
  get<VisitNoteTextResponse>(`${root(shopId)}/bookings/${encodeURIComponent(bookingId)}/note`);

export async function postVisitNote(shopId: string, bookingId: string, note: string): Promise<ApiAnswer<VisitNoteResponse>> {
  try {
    const res = await fetch(`${root(shopId)}/bookings/${encodeURIComponent(bookingId)}/note`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return await read<VisitNoteResponse>(res);
  } catch {
    return { status: 0, ok: false, body: null };
  }
}

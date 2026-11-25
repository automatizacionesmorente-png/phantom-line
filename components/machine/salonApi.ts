import type { BlockRequest, CreateBlockResponse, CreateBookingResponse, ManualBookingRequest, PayRequest, PayResponse } from "@/lib/salon/api";
import { read, type ApiAnswer } from "./bookingApi";

/**
 * The salon's three writes from the Today screen, in the style of `bookingApi.ts`: a manual
 * booking, a time block and a payment. Every answer is `{ status, body }`; a network failure
 * is status 0.
 */
const root = (shopId: string) => `/api/machine/${encodeURIComponent(shopId)}`;

async function post<T>(url: string, body: unknown): Promise<ApiAnswer<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return await read<T>(res);
  } catch {
    return { status: 0, ok: false, body: null };
  }
}

export const postManualBooking = (shopId: string, req: ManualBookingRequest) =>
  post<CreateBookingResponse>(`${root(shopId)}/bookings`, req);

export const postBlock = (shopId: string, req: BlockRequest) => post<CreateBlockResponse>(`${root(shopId)}/blocks`, req);

export const postPay = (shopId: string, bookingId: string, req: PayRequest) =>
  post<PayResponse>(`${root(shopId)}/bookings/${encodeURIComponent(bookingId)}/pay`, req);

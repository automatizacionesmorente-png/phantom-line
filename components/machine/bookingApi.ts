import type { BookingActionRequest, BookingActionResponse, MachineErrorBody, SlotsResponse } from "@/lib/owner/api";

/**
 * The two Agenda requests of the Machine_Page (design, "Machine_API"). Every answer comes
 * back as `{ status, body }`, so the dialogs decide what to show from the stable error
 * codes; a network failure is status 0.
 */
export type ApiAnswer<T> = { status: number; ok: true; body: T } | { status: number; ok: false; body: MachineErrorBody | null };

const base = (shopId: string, bookingId: string) =>
  `/api/machine/${encodeURIComponent(shopId)}/bookings/${encodeURIComponent(bookingId)}`;

async function read<T>(res: Response): Promise<ApiAnswer<T>> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return res.ok ? { status: res.status, ok: true, body: body as T } : { status: res.status, ok: false, body: body as MachineErrorBody | null };
}

export async function postBookingAction(
  shopId: string,
  bookingId: string,
  req: BookingActionRequest,
): Promise<ApiAnswer<BookingActionResponse>> {
  try {
    const res = await fetch(base(shopId, bookingId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return await read<BookingActionResponse>(res);
  } catch {
    return { status: 0, ok: false, body: null };
  }
}

export async function getMoveSlots(shopId: string, bookingId: string, date: string): Promise<ApiAnswer<SlotsResponse>> {
  try {
    const res = await fetch(`${base(shopId, bookingId)}/slots?date=${encodeURIComponent(date)}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return await read<SlotsResponse>(res);
  } catch {
    return { status: 0, ok: false, body: null };
  }
}

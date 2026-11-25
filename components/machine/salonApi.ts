import type { BlockRequest, CreateBlockResponse, CreateBookingResponse, CreateExpenseResponse, ExpenseRequest, ExpensesResponse, ManualBookingRequest, MonthResponse, PayRequest, PayResponse, OutboxResponse, SettingsRequest, SettingsResponse } from "@/lib/salon/api";
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

async function get<T>(url: string): Promise<ApiAnswer<T>> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    return await read<T>(res);
  } catch {
    return { status: 0, ok: false, body: null };
  }
}

/** My business: the month report, the month's expenses, and the expense writes. */
export const getMonth = (shopId: string, month: string) =>
  get<MonthResponse>(`${root(shopId)}/month?month=${encodeURIComponent(month)}`);

export const getExpenses = (shopId: string, month: string) =>
  get<ExpensesResponse>(`${root(shopId)}/expenses?month=${encodeURIComponent(month)}`);

export const postExpense = (shopId: string, req: ExpenseRequest) => post<CreateExpenseResponse>(`${root(shopId)}/expenses`, req);

export async function deleteExpense(shopId: string, expenseId: string): Promise<ApiAnswer<{ ok: true }>> {
  try {
    const res = await fetch(`${root(shopId)}/expenses/${encodeURIComponent(expenseId)}`, {
      method: "DELETE",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return await read<{ ok: true }>(res);
  } catch {
    return { status: 0, ok: false, body: null };
  }
}

/** The accountant's CSV for a month; the route sends it as a download. */
export const exportUrl = (shopId: string, month: string, lang: "es" | "en") =>
  `${root(shopId)}/export?month=${encodeURIComponent(month)}&format=csv&lang=${lang}`;

/** Settings and the outbox (salon spec 2.4, 9.7, 9.8). */
export const getSettings = (shopId: string) => get<SettingsResponse>(`${root(shopId)}/settings`);
export const postSettings = (shopId: string, req: SettingsRequest) => post<SettingsResponse>(`${root(shopId)}/settings`, req);
export const getOutbox = (shopId: string) => get<OutboxResponse>(`${root(shopId)}/outbox`);
export const postOutboxAction = (shopId: string, outboxId: string, action: "sent" | "dismissed") =>
  post<{ ok: true }>(`${root(shopId)}/outbox/${encodeURIComponent(outboxId)}`, { action });

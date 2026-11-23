import type { ClientActionRequest, ClientsResponse } from "@/lib/clients/api";
import { read, type ApiAnswer } from "./bookingApi";

/** The customer book's two requests of the Machine_Page. A network failure is status 0. */
const base = (shopId: string) => `/api/machine/${encodeURIComponent(shopId)}/clients`;

export async function getClients(shopId: string): Promise<ApiAnswer<ClientsResponse>> {
  try {
    const res = await fetch(base(shopId), { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    return await read<ClientsResponse>(res);
  } catch {
    return { status: 0, ok: false, body: null };
  }
}

export async function postClientAction(
  shopId: string,
  clientId: string,
  req: ClientActionRequest,
): Promise<ApiAnswer<ClientsResponse>> {
  try {
    const res = await fetch(`${base(shopId)}/${encodeURIComponent(clientId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return await read<ClientsResponse>(res);
  } catch {
    return { status: 0, ok: false, body: null };
  }
}

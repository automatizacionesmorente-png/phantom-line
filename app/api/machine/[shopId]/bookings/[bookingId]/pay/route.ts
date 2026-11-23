import { machineHandlers } from "../../../../production";

/** POST {amountCents, method, productCents?, productLabel?}: the cash desk for one booking. */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/bookings/[bookingId]/pay">) {
  return machineHandlers.pay(request, await ctx.params);
}

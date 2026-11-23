import { machineHandlers } from "../../production";

/** GET ?day=YYYY-MM-DD: the day's payments by method (the cash strip). */
export async function GET(request: Request, ctx: RouteContext<"/api/machine/[shopId]/payments">) {
  return machineHandlers.payments(request, await ctx.params);
}

/** POST {amountCents, method, productLabel?}: a product sale with no booking. */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/payments">) {
  return machineHandlers.sale(request, await ctx.params);
}

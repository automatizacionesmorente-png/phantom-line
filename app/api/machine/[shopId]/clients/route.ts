import { machineHandlers } from "../../production";

/** GET: the customer book (clients and the ones who have not come back). Owner session required. */
export async function GET(request: Request, ctx: RouteContext<"/api/machine/[shopId]/clients">) {
  return machineHandlers.clients(request, await ctx.params);
}

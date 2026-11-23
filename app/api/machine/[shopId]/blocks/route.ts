import { machineHandlers } from "../../production";

/** GET ?from=&to=: the time blocks of the window. */
export async function GET(request: Request, ctx: RouteContext<"/api/machine/[shopId]/blocks">) {
  return machineHandlers.blocks(request, await ctx.params);
}

/** POST {resourceId | null, start, end, reason}: a block of time; the answer lists the bookings under it. */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/blocks">) {
  return machineHandlers.createBlock(request, await ctx.params);
}

import { machineHandlers } from "../../production";

/** GET: prepares the messages that are due (once each), then lists the outbox. */
export async function GET(request: Request, ctx: RouteContext<"/api/machine/[shopId]/outbox">) {
  return machineHandlers.outbox(request, await ctx.params);
}

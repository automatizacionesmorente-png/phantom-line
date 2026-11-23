import { machineHandlers } from "../../../production";

/** POST {action: "note" | "no_show", ...}: the private note, or "No vino" on a past booking. */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/clients/[clientId]">) {
  return machineHandlers.client(request, await ctx.params);
}

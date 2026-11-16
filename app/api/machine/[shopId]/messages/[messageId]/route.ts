import { machineHandlers } from "../../../production";

/** POST {action: "play" | "erase"}: plays a Message back or erases it from the Tape. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/machine/[shopId]/messages/[messageId]">,
) {
  return machineHandlers.message(request, await ctx.params);
}

import { machineHandlers } from "../../../production";

/** POST {action:'sent'|'dismissed'}: only a prepared message can be moved. */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/outbox/[outboxId]">) {
  return machineHandlers.outboxAction(request, await ctx.params);
}

import { machineHandlers } from "../../../production";

/** DELETE: removes a time block. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/machine/[shopId]/blocks/[blockId]">) {
  return machineHandlers.deleteBlock(request, await ctx.params);
}

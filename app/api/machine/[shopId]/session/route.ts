import { machineHandlers } from "../../production";

/** POST: the PIN login, which sets the session cookie. DELETE: locks the machine on this browser. */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/session">) {
  return machineHandlers.login(request, await ctx.params);
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/machine/[shopId]/session">) {
  return machineHandlers.logout(request, await ctx.params);
}

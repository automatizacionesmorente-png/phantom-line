import { machineHandlers } from "../../production";

/** GET /api/machine/[shopId]/week: "Esta semana". Request time, `Cache-Control: no-store`. */
export async function GET(request: Request, ctx: RouteContext<"/api/machine/[shopId]/week">) {
  return machineHandlers.week(request, await ctx.params);
}

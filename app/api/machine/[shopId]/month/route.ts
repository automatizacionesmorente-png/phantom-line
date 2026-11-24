import { machineHandlers } from "../../production";

/** GET ?month=YYYY-MM: the month report (default: the current month). */
export async function GET(request: Request, ctx: RouteContext<"/api/machine/[shopId]/month">) {
  return machineHandlers.month(request, await ctx.params);
}

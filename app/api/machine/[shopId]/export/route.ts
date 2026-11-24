import { machineHandlers } from "../../production";

/** GET ?month=YYYY-MM&format=csv: the month's takings and expenses for the accountant. */
export async function GET(request: Request, ctx: RouteContext<"/api/machine/[shopId]/export">) {
  return machineHandlers.exportMonth(request, await ctx.params);
}

import { machineHandlers } from "../../../production";

/** DELETE: removes an expense (a monthly one disappears from every month). */
export async function DELETE(request: Request, ctx: RouteContext<"/api/machine/[shopId]/expenses/[expenseId]">) {
  return machineHandlers.deleteExpense(request, await ctx.params);
}

/** POST {action:'end', lastMonth}: a monthly expense stops after that month (to change its amount, then POST a new one). */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/expenses/[expenseId]">) {
  return machineHandlers.endExpense(request, await ctx.params);
}

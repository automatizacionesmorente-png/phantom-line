import { machineHandlers } from "../../production";

/** GET ?month=YYYY-MM: the expenses that count in the month, monthly ones included. */
export async function GET(request: Request, ctx: RouteContext<"/api/machine/[shopId]/expenses">) {
  return machineHandlers.expenses(request, await ctx.params);
}

/** POST {concept, amountCents, category, day, recurring?}: adds an expense. */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/expenses">) {
  return machineHandlers.createExpense(request, await ctx.params);
}

import { machineHandlers } from "../../production";

/** GET: the switches, the review link and the VAT rate (defaults when none are saved). */
export async function GET(request: Request, ctx: RouteContext<"/api/machine/[shopId]/settings">) {
  return machineHandlers.settings(request, await ctx.params);
}

/** POST {automations, googleReviewUrl, vatRatePct}: saves them; a switch turned off dismisses its waiting messages. */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/settings">) {
  return machineHandlers.saveSettings(request, await ctx.params);
}

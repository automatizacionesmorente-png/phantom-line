import { machineHandlers } from "../../../../production";

/** GET: the visit note text. */
export async function GET(request: Request, ctx: RouteContext<"/api/machine/[shopId]/bookings/[bookingId]/note">) {
  return machineHandlers.getNote(request, await ctx.params);
}

/** POST {note}: the visit note of one booking (at most 500 characters). */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/bookings/[bookingId]/note">) {
  return machineHandlers.note(request, await ctx.params);
}

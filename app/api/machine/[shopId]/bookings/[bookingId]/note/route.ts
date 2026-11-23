import { machineHandlers } from "../../../../production";

/** POST {note}: the visit note of one booking (at most 500 characters). */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/bookings/[bookingId]/note">) {
  return machineHandlers.note(request, await ctx.params);
}

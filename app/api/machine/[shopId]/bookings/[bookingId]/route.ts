import { machineHandlers } from "../../../production";

/** POST {action: "confirm" | "move" | "cancel", revision, start?}: one Owner_Action on a Booking. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/machine/[shopId]/bookings/[bookingId]">,
) {
  return machineHandlers.booking(request, await ctx.params);
}

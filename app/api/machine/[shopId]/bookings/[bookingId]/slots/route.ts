import { machineHandlers } from "../../../../production";

/** GET ?date=YYYY-MM-DD: the Move_Slots of one day, from the same Booking_Rules as a caller. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/machine/[shopId]/bookings/[bookingId]/slots">,
) {
  return machineHandlers.slots(request, await ctx.params);
}

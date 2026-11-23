import { machineHandlers } from "../../production";

/** POST {resourceId, serviceId, start, name, phone?}: a booking the Owner writes by hand. */
export async function POST(request: Request, ctx: RouteContext<"/api/machine/[shopId]/bookings">) {
  return machineHandlers.createBooking(request, await ctx.params);
}

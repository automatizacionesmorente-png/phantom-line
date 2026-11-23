import { computeWeekStats, weekBounds, type WeekStats } from "./weekStats";
import { LOCKED, fail, sessionFor, type OwnerDeps, type OwnerResult } from "./handleOwner";

/**
 * GET /api/machine/[shopId]/week: the week's numbers. The session is checked first, as in
 * every Machine_API read, and every row is read by this shop's id only.
 */
export async function handleWeek(
  i: { shopId: string; token: string | undefined },
  d: OwnerDeps,
): Promise<OwnerResult<WeekStats>> {
  const head = await d.repo.pollHead(i.shopId);
  if (!head) return fail(404, { error: "shop_not_found" });
  if (!sessionFor(i.token, i.shopId, head.pinSetAt, d)) return LOCKED;
  if (!d.week) throw new Error("The week source is not configured");
  const access = await d.repo.getShopAccess(i.shopId);
  if (!access) return fail(404, { error: "shop_not_found" });
  const shop = access.profile;
  const { start, end } = weekBounds(d.clock(), shop.timeZone);
  const [calls, bookings] = await Promise.all([
    d.week.listWeekCalls(i.shopId, start, end),
    d.week.listWeekBookings(i.shopId, start, end),
  ]);
  return { ok: true, body: computeWeekStats({ now: d.clock(), shop, calls, bookings }) };
}

import "server-only";
import { cacheTag } from "next/cache";
import { getDb, getRepository } from "@/lib/db/client";
import { createTrialStore } from "@/lib/db/trialRepository";
import { toPublicShop, type PublicShop } from "@/lib/voice/publicShop";

const MAX_SHOP_ID = 100;

/**
 * The public part of a Shop for the Call_Page, cached per shop and tagged
 * `shop:<id>` so an edit to the profile can purge it with `revalidateTag`.
 * A database error is thrown (and not cached), so `error.tsx` shows it.
 */
export async function loadPublicShop(shopId: string): Promise<PublicShop | null> {
  "use cache";
  cacheTag(`shop:${shopId}`);
  if (shopId.length === 0 || shopId.length > MAX_SHOP_ID) return null;
  const shop = await getRepository().getShop(shopId);
  if (!shop) return null;
  const trial = await createTrialStore(getDb()).isTrial(shopId);
  return trial ? { ...toPublicShop(shop), trial } : toPublicShop(shop);
}

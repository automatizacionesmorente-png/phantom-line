import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getRepository } from "@/lib/db/client";

const MAX_SHOP_ID = 100;

/**
 * An unknown shop answers HTTP 404 (BACKLOG 28). The pages check the shop inside <Suspense>,
 * after the response has started with 200, so the status is decided here, before anything
 * streams: an unknown `/call/<id>` or `/machine/<id>` is rewritten to a path that does not
 * exist, and the app's `not-found.tsx` renders with a real 404. A malformed escape or an id
 * over the limit is an unknown shop too. If the lookup itself fails (database down), the
 * request goes on and the page shows its own error (`error.tsx`).
 */
export async function proxy(request: NextRequest) {
  const segment = request.nextUrl.pathname.split("/")[2] ?? "";
  let id: string | null;
  try {
    id = decodeURIComponent(segment);
  } catch {
    id = null;
  }
  let known = false;
  if (id !== null && id.length > 0 && id.length <= MAX_SHOP_ID) {
    try {
      known = (await getRepository().getShop(id)) !== null;
    } catch {
      return NextResponse.next();
    }
  }
  if (known) return NextResponse.next();
  return NextResponse.rewrite(new URL("/shop-not-found", request.url));
}

export const config = {
  matcher: ["/call/:shopId", "/machine/:shopId"],
};

import { machineHandlers } from "../production";

/**
 * GET /api/machine/[shopId]?since=<version>: the Poll. Default Node.js runtime and no
 * `runtime` export (cacheComponents forbids it). It reads the request and the database, so it
 * runs at request time, and every response is `Cache-Control: no-store`.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/machine/[shopId]">) {
  return machineHandlers.poll(request, await ctx.params);
}

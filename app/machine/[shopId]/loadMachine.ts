import "server-only";
import { productionOwnerDeps } from "@/app/api/machine/production";
import { summarizeError } from "@/lib/conversation/fallbackLog";
import { loadMachineView, type MachineView } from "@/lib/owner/machineView";
import { consoleOwnerLogger } from "@/lib/owner/types";

/**
 * The Machine_Page's server read with the production dependencies. Not cached: it reads the
 * session cookie and caller data (14.6).
 *
 * A failure (the database is down) is logged once as `owner_error` with the error's summary
 * only, which drops Drizzle's query parameters, and rethrown as a plain error, so Next's own
 * error log never prints a caller's name or phone either (14.4). `error.tsx` shows it.
 */
export async function loadMachine(shopId: string, token: string | undefined): Promise<MachineView> {
  const deps = productionOwnerDeps();
  try {
    return await loadMachineView(shopId, token, deps);
  } catch (err) {
    try {
      (deps.log ?? consoleOwnerLogger)({
        event: "owner_error",
        route: "machine_page",
        shopId: shopId.slice(0, 100),
        error: summarizeError(err),
      });
    } catch {
      // Logging must never change what the page shows.
    }
    throw new Error("The machine could not be loaded");
  }
}

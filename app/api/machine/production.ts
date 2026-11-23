import { randomUUID } from "node:crypto";
import { getDb, getRepository } from "@/lib/db/client";
import { createOwnerRepository } from "@/lib/db/ownerRepository";
import { createWeekSource } from "@/lib/db/weekRepository";
import { pinLimitsFromEnv } from "@/lib/owner/limits";
import type { OwnerDeps } from "@/lib/owner/handleOwner";
import { Temporal } from "temporal-polyfill";
import { makeMachineHandlers } from "./handlers";

/**
 * The Machine_API with its production dependencies, shared by the route files. Built on
 * first use, so `next build` needs no DATABASE_URL or secret. The session secret and the
 * limits are read from the environment on every use of `secret()`, and once for the limits.
 */
let deps: OwnerDeps | undefined;

export function productionOwnerDeps(): OwnerDeps {
  deps ??= {
    repo: createOwnerRepository(getDb()),
    week: createWeekSource(getDb()),
    core: getRepository(),
    clock: () => Temporal.Now.instant(),
    newId: () => randomUUID(),
    secret: () => process.env.OWNER_SESSION_SECRET,
    pinLimits: pinLimitsFromEnv(process.env),
  };
  return deps;
}

export const machineHandlers = makeMachineHandlers({
  owner: productionOwnerDeps,
  salt: () => process.env.RATE_LIMIT_SALT ?? "",
});

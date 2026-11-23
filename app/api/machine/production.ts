import { rateLimitSalt } from "@/app/api/visitorKey";
import { randomUUID } from "node:crypto";
import { getDb, getRepository } from "@/lib/db/client";
import { createOwnerRepository } from "@/lib/db/ownerRepository";
import { createWeekSource } from "@/lib/db/weekRepository";
import { pinLimitsFromEnv } from "@/lib/owner/limits";
import type { SalonDeps } from "@/lib/salon/types";
import { createSalonRepository } from "@/lib/db/salonRepository";
import { Temporal } from "temporal-polyfill";
import { makeMachineHandlers } from "./handlers";

/**
 * The Machine_API with its production dependencies, shared by the route files. Built on
 * first use, so `next build` needs no DATABASE_URL or secret. The session secret and the
 * limits are read from the environment on every use of `secret()`, and once for the limits.
 */
let deps: SalonDeps | undefined;

export function productionOwnerDeps(): SalonDeps {
  deps ??= {
    repo: createOwnerRepository(getDb()),
    salon: createSalonRepository(getDb()),
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
  salt: () => rateLimitSalt(),
});

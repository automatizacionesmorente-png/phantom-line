/**
 * What `/machine/[shopId]` shows (owner-machine 1.1, 1.2, 1.6, 1.7, 16.6), decided on the
 * server with I/O only through `OwnerDeps`: an unknown shop, a shop with no PIN, the PIN_Gate,
 * or the machine with its first snapshot. `app/machine/[shopId]/loadMachine.ts` passes the
 * production deps; tests pass PGlite.
 *
 * The session is checked before anything personal is read (14.1). The first snapshot goes
 * through `handlePoll` with no `since`, the same path as every later Poll, so the Demo_Shop's
 * retention runs before it (16.6) and the page and the Poll can never disagree on its shape.
 */
import { getSectorPack } from "@/lib/sectors";
import type { PollChanged } from "./api";
import { handlePoll, type OwnerDeps } from "./handleOwner";
import { toGateShop, toMachineShop, type GateShop, type MachineShop } from "./machineShop";
import { isUsableSessionSecret, verifySession } from "./session";

export type MachineView =
  | { kind: "not_found" }
  | { kind: "no_pin"; shop: GateShop }
  | { kind: "gate"; shop: GateShop }
  | { kind: "machine"; shop: MachineShop; initial: PollChanged; label: string };

/** The longest shop id the page looks up, as on the Call_Page. */
const MAX_SHOP_ID = 100;

export async function loadMachineView(shopId: string, token: string | undefined, d: OwnerDeps): Promise<MachineView> {
  if (shopId.length === 0 || shopId.length > MAX_SHOP_ID) return { kind: "not_found" };
  const access = await d.repo.getShopAccess(shopId);
  if (!access) return { kind: "not_found" };
  const gate = toGateShop(access.profile, access.trial === true);
  if (access.pinHash === null || access.pinSetAt === null) return { kind: "no_pin", shop: gate };

  const secret = d.secret();
  if (!isUsableSessionSecret(secret)) return { kind: "gate", shop: gate };
  const check = verifySession(token, secret, { shopId, now: d.clock(), pinSetAt: access.pinSetAt });
  if (!check.ok) return { kind: "gate", shop: gate };

  const poll = await handlePoll({ shopId, since: null, token }, d);
  // A PIN changed between the two reads: the session is no longer valid.
  if (!poll.ok || !poll.body.changed) return { kind: "gate", shop: gate };
  return {
    kind: "machine",
    shop: toMachineShop(access.profile, getSectorPack(access.profile.sectorPackId), access.trial === true),
    initial: poll.body,
    label: check.session.label,
  };
}

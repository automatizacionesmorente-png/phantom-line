import { describe, expect, it } from "vitest";
import { getSectorPack } from "@/lib/sectors";
import { serviceName, toMachineShop } from "@/lib/owner/machineShop";
import { lolaProfile } from "../fixtures/lola";

/** front-desk-brain 4.4 (Requirement 7.6): the Owner's screens name a Service_Combo by its parts. */
describe("serviceName", () => {
  const shop = toMachineShop(lolaProfile, getSectorPack("hair-salon"));

  it("names a catalog Service as before", () => {
    expect(serviceName(shop, "haircut", "es")).toBe("corte");
    expect(serviceName(shop, "colour", "en")).toBe("colour");
  });

  it("names a Combo_Id of 2 and 3 parts by its parts, joined with ' + '", () => {
    expect(serviceName(shop, "haircut+beard", "es")).toBe("corte + barba");
    expect(serviceName(shop, "haircut+colour+beard", "en")).toBe("haircut + colour + beard");
  });

  it("shows the id when the Service or any part left the profile, so a row is never empty", () => {
    expect(serviceName(shop, "perm", "es")).toBe("perm");
    expect(serviceName(shop, "haircut+perm", "es")).toBe("haircut+perm");
    expect(serviceName(shop, "haircut+", "es")).toBe("haircut+");
  });

  it("the Machine_Page's shop still carries names only, no durations or prices", () => {
    expect(shop.services[0]).toEqual({ id: "haircut", name: { es: "corte", en: "haircut" } });
  });
});

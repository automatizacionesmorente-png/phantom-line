import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { evaluateBooking, preferResource, toInstant, type ShopRules } from "@/lib/booking";
import { lolaPack, lolaRules } from "../fixtures/lola";

const shop: ShopRules = { ...lolaRules, resources: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] };

describe("preferResource", () => {
  it("puts the resource first and keeps the others in their order", () => {
    expect(preferResource(shop, "c").resources.map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
    expect(preferResource(shop, "a").resources.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(preferResource(shop, "d").resources.map((r) => r.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("changes only the order: zone, hours and services are the same, and the input is untouched", () => {
    const p = preferResource(shop, "b");
    expect(p.timeZone).toBe(shop.timeZone);
    expect(p.hours).toBe(shop.hours);
    expect(p.services).toBe(shop.services);
    expect([...p.resources].sort((x, y) => x.id.localeCompare(y.id))).toEqual(shop.resources);
    expect(shop.resources.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("an unknown resource leaves the order as it is", () => {
    expect(preferResource(shop, "zz").resources.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("evaluateBooking takes the preferred chair when it is free", () => {
    const tz = "Europe/Madrid";
    const start = toInstant(Temporal.PlainDate.from("2026-11-14"), Temporal.PlainTime.from("10:00"), tz);
    const now = toInstant(Temporal.PlainDate.from("2026-11-13"), Temporal.PlainTime.from("09:00"), tz);
    const ctx = { now, pack: lolaPack, existing: [] };
    const plain = evaluateBooking({ serviceId: "haircut", start }, { ...ctx, shop: lolaRules });
    const preferred = evaluateBooking({ serviceId: "haircut", start }, { ...ctx, shop: preferResource(lolaRules, "chair-2") });
    expect(plain.ok && plain.resourceId).toBe("chair-1");
    expect(preferred.ok && preferred.resourceId).toBe("chair-2");
  });
});

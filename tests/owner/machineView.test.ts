import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { loadMachineView } from "@/lib/owner/machineView";
import { insertShop } from "../db/helpers";
import { addBooking, addCall, addMessage, ownerRepoOf } from "../db/ownerFixtures";
import { createTestDb, type TestDb } from "../db/pglite";
import { DEMO, REAL, createMachineEnv, pinHash, seedShops, tokenFor, type MachineEnv } from "../api/machineHarness";
import { lolaProfile } from "../fixtures/lola";

/**
 * Owner-machine task 11.1: what `/machine/[shopId]` renders, decided on the server through
 * `OwnerDeps` on PGlite (Requirements 1.1, 1.2, 1.6, 1.7, 14.1, 16.6).
 */
let t: TestDb;
let env: MachineEnv;

beforeAll(async () => {
  t = await createTestDb();
  await pinHash();
}, 120_000);
beforeEach(async () => {
  await t.reset();
  await seedShops(t);
  env = createMachineEnv(t);
});
afterAll(async () => {
  await t?.close();
});

describe("loadMachineView", () => {
  it("an unknown shop, an empty id and an over-long id are not found (1.6)", async () => {
    expect(await loadMachineView("no-such-shop", undefined, env.deps)).toEqual({ kind: "not_found" });
    expect(await loadMachineView("", undefined, env.deps)).toEqual({ kind: "not_found" });
    expect(await loadMachineView("x".repeat(101), undefined, env.deps)).toEqual({ kind: "not_found" });
  });

  it("a shop with no PIN says it is not set up, with no form data (1.7)", async () => {
    await insertShop(t, { ...lolaProfile, id: "sin-pin", name: "Sin PIN" });
    const v = await loadMachineView("sin-pin", tokenFor("sin-pin"), env.deps);
    expect(v).toEqual({ kind: "no_pin", shop: { id: "sin-pin", name: "Sin PIN", languages: ["es", "en"], demo: false } });
  });

  it("without a valid session: the PIN_Gate with the shop name only, nothing read from the Tape (1.1, 1.2, 14.1)", async () => {
    const call = await addCall(t, DEMO);
    await addMessage(t, DEMO, call, { name: "Ana Secreta", phone: "+34611111111" });
    for (const token of [undefined, "garbage", tokenFor(REAL), tokenFor(DEMO, { exp: 1 }), tokenFor(DEMO, {}, "another-secret-of-enough-length-000000")]) {
      const v = await loadMachineView(DEMO, token, env.deps);
      expect(v).toEqual({ kind: "gate", shop: { id: DEMO, name: "Peluquería Lola", languages: ["es", "en"], demo: true } });
      expect(JSON.stringify(v)).not.toMatch(/Ana Secreta|611111111/);
    }
    // The Demo_Retention never runs from the gate (design, "Demo_Retention").
    expect(env.spy.claims).toBe(0);
  });

  it("a missing or short session secret shows the gate, never the machine", async () => {
    env.setSecret(undefined);
    expect((await loadMachineView(DEMO, tokenFor(DEMO), env.deps)).kind).toBe("gate");
    env.setSecret("short");
    expect((await loadMachineView(DEMO, tokenFor(DEMO), env.deps)).kind).toBe("gate");
  });

  it("with a valid session: the machine with the first snapshot, the label, and the public shop data only", async () => {
    const call = await addCall(t, REAL);
    const booking = await addBooking(t, REAL, { start: "2026-11-10T15:00:00Z", callId: call });
    await addMessage(t, REAL, call, { bookingId: booking, name: "Ana", createdAt: "2026-11-10T07:05:00Z" });
    const v = await loadMachineView(REAL, tokenFor(REAL), env.deps);
    expect(v.kind).toBe("machine");
    if (v.kind !== "machine") return;
    expect(v.label).toBe("Lola");
    expect(v.initial.changed).toBe(true);
    expect(v.initial.tape.map((m) => m.callerName)).toEqual(["Ana"]);
    expect(v.initial.agenda).toHaveLength(8);
    expect(v.initial.agenda[0].items.map((b) => b.id)).toEqual([booking]);
    expect(v.shop.demo).toBe(false);
    expect(v.shop.timeZone).toBe("Europe/Madrid");
    // Prices, the address and the PIN hash stay on the server. The opening hours (which the receptionist
    // tells every caller) and the slot step travel for the booking book's grid.
    const json = JSON.stringify(v.shop);
    expect(json).not.toMatch(/address|scrypt|ownerPin|durationMin/);
    expect(json).not.toContain(lolaProfile.address);
    expect(v.shop?.hours[2]).toEqual([{ open: "10:00", close: "14:00" }, { open: "17:00", close: "20:00" }]);
    // A Real_Shop never runs the Demo_Retention.
    expect(env.spy.claims).toBe(0);
  });

  it("for the Demo_Shop, the Demo_Retention runs before the first snapshot (16.6)", async () => {
    // A 3-day-old Message: the 24-hour rule erases it, and the samples refill the Tape.
    const old = env.now().subtract({ hours: 72 });
    const call = await addCall(t, DEMO, { startedAt: old });
    await addMessage(t, DEMO, call, { name: "Vieja", createdAt: old });
    const v = await loadMachineView(DEMO, tokenFor(DEMO), env.deps);
    expect(v.kind).toBe("machine");
    if (v.kind !== "machine") return;
    expect(env.spy.claims).toBe(1);
    expect(v.shop.demo).toBe(true);
    expect(v.initial.tape.map((m) => m.callerName)).not.toContain("Vieja");
    expect(v.initial.tape.filter((m) => m.sample !== null)).toHaveLength(3);
    const head = await ownerRepoOf(t).pollHead(DEMO);
    expect(v.initial.version).toBe(head?.version);
  });

  it("a PIN changed after the session was issued shows the gate", async () => {
    await ownerRepoOf(t).setOwnerPin(DEMO, await pinHash(), Temporal.Instant.from("2026-11-09T00:00:00Z"));
    expect((await loadMachineView(DEMO, tokenFor(DEMO), env.deps)).kind).toBe("gate");
  });
});

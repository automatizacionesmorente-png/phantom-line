import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { makeCreateHandler } from "@/app/api/nacer/create/handler";
import { rateLimits, shops } from "@/lib/db/schema";
import { createTrialStore, createWizardLimiter } from "@/lib/db/trialRepository";
import { createOwnerRepository } from "@/lib/db/ownerRepository";
import { ShopProfileSchema } from "@/lib/conversation/shopProfile";
import { verifyPin } from "@/lib/owner/pin";
import { LIMITS, TRIAL_DAYS } from "@/lib/rebirth/draft";
import { createTestDb, type TestDb } from "../db/pglite";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import { createBody, validDraft } from "../rebirth/fixtures";

const NOW = Temporal.Instant.from("2026-12-01T10:00:00Z");
let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
beforeEach(async () => {
  await t.reset();
});
afterAll(async () => t?.close());

let n = 0;
const handler = (over: { hash?: (pin: string) => Promise<string>; clock?: () => Temporal.Instant } = {}) =>
  makeCreateHandler({
    store: () => createTrialStore(t.handle),
    limiter: () => createWizardLimiter(t.handle),
    clock: over.clock ?? (() => NOW),
    salt: () => "salt-1234",
    random: () => Uint8Array.from([++n, n + 1, n + 2, n + 3]),
    ...(over.hash ? { hash: over.hash } : {}),
  });
const post = (body: unknown, ip = "1.1.1.1") =>
  new Request("http://x/api/nacer/create", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const rows = () => t.handle.db.select().from(shops);

describe("POST /api/nacer/create", () => {
  it("creates a trial shop: unique slug, valid profile, links, expiry in 7 days", async () => {
    const res = await handler()(post(createBody()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, shopId: "barberia-paco", callPath: "/call/barberia-paco", machinePath: "/machine/barberia-paco" });
    const [row] = await rows();
    expect(row).toMatchObject({ id: "barberia-paco", name: "Barbería Paco", sectorPackId: "hair-salon", trial: true, timeZone: "Europe/Madrid" });
    expect(row.expiresAt?.getTime()).toBe(NOW.add({ hours: TRIAL_DAYS * 24 }).epochMilliseconds);
    expect(body.expiresAt).toBe(NOW.add({ hours: TRIAL_DAYS * 24 }).toString());
    expect(ShopProfileSchema.safeParse(row.profile).success).toBe(true);
    // The shop is read like any other.
    expect((await t.repo.getShop("barberia-paco"))?.name).toBe("Barbería Paco");
  });

  it("hashes the PIN with the machine's scrypt and never stores or returns it", async () => {
    const res = await handler()(post(createBody({ pin: "135790" })));
    const text = await res.text();
    expect(text).not.toContain("135790");
    const [row] = await rows();
    expect(row.ownerPinHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(row.ownerPinHash).not.toContain("135790");
    expect(await verifyPin("135790", row.ownerPinHash!)).toBe(true);
    expect(await verifyPin("135791", row.ownerPinHash!)).toBe(false);
    expect(row.ownerPinSetAt).not.toBeNull();
    expect(JSON.stringify(row.profile)).not.toContain("135790");
    // The machine reads access with that hash, and marks the shop as a trial.
    const access = await createOwnerRepository(t.handle).getShopAccess("barberia-paco");
    expect(access?.trial).toBe(true);
    expect(access?.pinHash).toBe(row.ownerPinHash);
  });

  it("never overwrites: the same name is refused and the first shop is untouched", async () => {
    await handler()(post(createBody()));
    const before = JSON.stringify(await rows());
    const other = validDraft();
    other.services = [{ name: "Otra cosa", nameEn: undefined, durationMin: 20, priceEur: 1, from: false }];
    const res = await handler()(post(createBody({ pin: "999999" }, other), "2.2.2.2"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("name_taken");
    expect(JSON.stringify(await rows())).toBe(before);
  });

  it("never overwrites the demo shop, and a slug taken by another name gets a suffix", async () => {
    await insertShop(t, { ...lolaProfile, id: "barberia-paco", name: "Otra Barbería" });
    const before = (await t.handle.db.select().from(shops).where(eq(shops.id, "barberia-paco")))[0];
    const res = await handler()(post(createBody()));
    expect(res.status).toBe(201);
    const { shopId } = await res.json();
    expect(shopId).toMatch(/^barberia-paco-[a-z0-9]{4}$/);
    const after = (await t.handle.db.select().from(shops).where(eq(shops.id, "barberia-paco")))[0];
    expect(after).toEqual(before);
    expect(await rows()).toHaveLength(2);
    // The demo's name cannot be taken either.
    const d = validDraft();
    d.business.name = lolaProfile.name;
    await insertShop(t, { ...lolaProfile, id: "peluqueria-lola" }).catch(() => {});
    expect((await handler()(post(createBody({}, d), "3.3.3.3"))).status).toBe(409);
  });

  it("refuses an invalid draft with codes per field, and creates nothing", async () => {
    const d = validDraft();
    d.business.name = "<script>x</script>";
    d.team.concurrent = 5;
    const res = await handler()(post(createBody({}, d)));
    expect(res.status).toBe(400);
    const { issues } = await res.json();
    expect(issues).toEqual(expect.arrayContaining([{ path: "draft.business.name", code: "invalid_chars" }, { path: "draft.team.concurrent", code: "concurrent_too_high" }]));
    expect(await rows()).toHaveLength(0);
  });

  it("refuses unknown keys, no terms, a bad PIN, a bad sector, bad JSON, and an oversized body", async () => {
    const h = handler();
    expect((await h(post({ ...createBody(), admin: true }))).status).toBe(400);
    expect((await h(post({ ...createBody(), acceptTerms: false }))).status).toBe(400);
    expect((await h(post(createBody({ pin: "12345" })))).status).toBe(400);
    expect((await h(post(createBody({}, validDraft({ sectorId: "nuclear-plant" }))))).status).toBe(400);
    expect((await h(post("{nope"))).status).toBe(400);
    expect((await h(post(JSON.stringify({ pad: "x".repeat(70_000) })))).status).toBe(413);
    // A draft carrying a trial flag or expiry of its own is refused as an unknown key.
    expect((await h(post({ ...createBody(), trial: false, expiresAt: "2099-01-01" }))).status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it("an HTML-looking name or answer can never be stored", async () => {
    const d = validDraft();
    d.faq[0].answer = "Visita <b>nuestra web</b>";
    expect((await handler()(post(createBody({}, d)))).status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it(`rate limits ${LIMITS.create.perVisitorPerDay} creations per visitor per day`, async () => {
    for (let i = 0; i < LIMITS.create.perVisitorPerDay; i++) {
      const d = validDraft();
      d.business.name = `Negocio ${i}`;
      expect((await handler()(post(createBody({}, d), "5.5.5.5"))).status).toBe(201);
    }
    const d = validDraft();
    d.business.name = "Negocio extra";
    expect((await handler()(post(createBody({}, d), "5.5.5.5"))).status).toBe(429);
    expect(await rows()).toHaveLength(LIMITS.create.perVisitorPerDay);
    // A different visitor still can; the next day the same visitor can again.
    expect((await handler()(post(createBody({}, d), "6.6.6.6"))).status).toBe(201);
    const tomorrow = NOW.add({ hours: 24 });
    d.business.name = "Negocio mañana";
    expect((await handler({ clock: () => tomorrow })(post(createBody({}, d), "5.5.5.5"))).status).toBe(201);
  });

  it(`rate limits ${LIMITS.create.globalPerDay} creations per day overall, before hashing the PIN`, async () => {
    const day = new Date(NOW.epochMilliseconds - (NOW.epochMilliseconds % 86_400_000));
    await t.handle.db.insert(rateLimits).values({ key: "nacer:create:global", windowStart: day, count: LIMITS.create.globalPerDay });
    let hashed = 0;
    const res = await handler({ hash: async () => (hashed++, "x") })(post(createBody(), "7.7.7.7"));
    expect(res.status).toBe(429);
    expect(hashed).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it("an expired trial shop is not found by the readers, before the cron deletes it", async () => {
    await handler()(post(createBody()));
    expect(await t.repo.getShop("barberia-paco")).not.toBeNull();
    await t.handle.db.update(shops).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await t.repo.getShop("barberia-paco")).toBeNull();
    expect(await createOwnerRepository(t.handle).getShopAccess("barberia-paco")).toBeNull();
  });
});

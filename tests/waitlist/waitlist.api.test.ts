import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { makeWaitlistHandler } from "@/app/api/waitlist/handler";
import { createWaitlistRepository } from "@/lib/db/waitlistRepository";
import { waitlist } from "@/lib/db/schema";
import type { WaitlistStore } from "@/lib/waitlist/schema";
import { createTestDb, type TestDb } from "../db/pglite";

const NOW = Temporal.Instant.from("2026-12-01T10:30:00Z");
const valid = { shopName: "  Peluquería   Lola ", city: "Madrid", email: " Lola@Example.COM ", language: "es", consent: true };

// PGlite starts slowly when the machine is busy.
const SLOW = 60_000;
let t: TestDb;
afterAll(async () => t?.close());
beforeEach(async () => {
  t ??= await createTestDb();
  await t.reset();
}, SLOW);

const handler = (store?: () => WaitlistStore, limits?: { perVisitorPerHour: number; globalPerDay: number }) =>
  makeWaitlistHandler({ store: store ?? (() => createWaitlistRepository(t.handle)), clock: () => NOW, salt: () => "s", limits });
const post = (body: unknown, ip = "1.1.1.1") =>
  new Request("http://x/api/waitlist", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const rows = () => t.handle.db.select().from(waitlist);

describe("POST /api/waitlist", () => {
  it("stores a valid entry, normalised", async () => {
    const res = await handler()(post(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [row] = await rows();
    expect(row).toMatchObject({ shopName: "Peluquería Lola", email: "lola@example.com" });
  });

  it("answers 200 for a repeated email and keeps one row", async () => {
    await handler()(post(valid));
    expect((await handler()(post(valid))).status).toBe(200);
    expect(await rows()).toHaveLength(1);
  });

  it.each([
    ["bad email", { ...valid, email: "nope" }],
    ["empty shop", { ...valid, shopName: " " }],
    ["unknown language", { ...valid, language: "fr" }],
    ["extra key", { ...valid, admin: true }],
    ["not an object", "[]"],
    ["not JSON", "{oops"],
  ])("rejects %s with 400 and stores nothing", async (_n, body) => {
    const res = await handler()(post(body));
    expect(res.status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it.each([["missing", undefined], ["false", false], ["string", "true"]])("rejects consent %s", async (_n, consent) => {
    const body: Record<string, unknown> = { ...valid };
    if (consent === undefined) delete body.consent;
    else body.consent = consent;
    const res = await handler()(post(body));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("consent");
    expect(await rows()).toHaveLength(0);
  });

  it("rate limits a visitor after 5 sign-ups an hour, but not another visitor", async () => {
    for (let i = 0; i < 5; i++) expect((await handler()(post({ ...valid, email: `a${i}@example.com` }))).status).toBe(200);
    const blocked = await handler()(post({ ...valid, email: "a9@example.com" }));
    expect(blocked.status).toBe(429);
    expect(await rows()).toHaveLength(5);
    expect((await handler()(post({ ...valid, email: "b@example.com" }, "2.2.2.2"))).status).toBe(200);
  });

  it("rate limits everyone after the daily cap", async () => {
    const h = handler(undefined, { perVisitorPerHour: 99, globalPerDay: 2 });
    expect((await h(post({ ...valid, email: "a@example.com" }, "1.1.1.1"))).status).toBe(200);
    expect((await h(post({ ...valid, email: "b@example.com" }, "2.2.2.2"))).status).toBe(200);
    expect((await h(post({ ...valid, email: "c@example.com" }, "3.3.3.3"))).status).toBe(429);
  });

  it("answers 503 when the store fails, without leaking details", async () => {
    const res = await handler(() => {
      throw new Error("postgres://secret");
    })(post(valid));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

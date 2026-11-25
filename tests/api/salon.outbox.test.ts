import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { bookings, clients, outbox, payments, shopSettings } from "@/lib/db/schema";
import { addBooking } from "../db/ownerFixtures";
import { createTestDb, type TestDb } from "../db/pglite";
import { DEMO, REAL, client, createMachineEnv, seedShops, tokenFor, type MachineEnv } from "./machineHarness";

/**
 * Salon task 8: the settings and the outbox through real `Request` objects on PGlite.
 * Clock: Tuesday 10 November 2026, 09:00 in Madrid (08:00 UTC).
 */
let t: TestDb;
let env: MachineEnv;
let api: ReturnType<typeof client>;
let token: string;

beforeAll(async () => {
  t = await createTestDb();
}, 120_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await seedShops(t);
  env = createMachineEnv(t);
  api = client(env.handlers);
  token = tokenFor(REAL);
});

const open = () => ({ token });
const off = { reminder: false, review: false, gap: false, winback: false, birthday: false };
const settings = (on: Partial<typeof off> = {}, o: object = {}) => ({
  automations: { ...off, ...on },
  googleReviewUrl: "https://g.page/r/lola/review",
  vatRatePct: 21,
  ...o,
});
const person = (shopId: string, phone: string, name: string, o: Partial<typeof clients.$inferInsert> = {}) =>
  t.handle.db.insert(clients).values({ shopId, phone, name, ...o }).returning({ id: clients.id }).then((r) => r[0].id);
const rows = (shopId = REAL) => t.handle.db.select().from(outbox).where(eq(outbox.shopId, shopId));
type Item = { id: string; kind: string; status: string; body: string; waUrl: string; phone: string };
const items = (a: { json: Record<string, unknown> | null }) => (a.json as { items: Item[] }).items;
const waiting = (a: { json: Record<string, unknown> | null }) => items(a).filter((i) => i.status === "prepared");
const CONSENT = new Date("2026-01-01T00:00:00Z");

/** Tomorrow's booking (reminder), yesterday's paid one (review), a freed slot (gap), a lapsed client (winback), a birthday. */
async function seedDay() {
  await person(REAL, "+34611000001", "Ana Pérez", { language: "es" });
  const tomorrow = await addBooking(t, REAL, { start: "2026-11-11T09:00:00Z", name: "Ana Pérez", phone: "+34611000001" });
  await person(REAL, "+34611000002", "Bea Gil");
  const paid = await addBooking(t, REAL, { start: "2026-11-09T09:00:00Z", name: "Bea Gil", phone: "+34611000002" });
  await t.handle.db.insert(payments).values({ shopId: REAL, bookingId: paid, amountCents: 1500, method: "cash", paidAt: new Date("2026-11-09T10:00:00Z") });
  await person(REAL, "+34611000003", "Cris Sanz", { promoConsentAt: CONSENT, birthday: "11-10" });
  await addBooking(t, REAL, { start: "2026-08-01T09:00:00Z", name: "Cris Sanz", phone: "+34611000003" });
  await person(REAL, "+34611000004", "Dani Roca"); // no consent
  await addBooking(t, REAL, { start: "2026-08-02T09:00:00Z", name: "Dani Roca", phone: "+34611000004" });
  const freed = await addBooking(t, REAL, { start: "2026-11-12T15:00:00Z", name: "Eva Mir", phone: "+34611000005", status: "cancelled" });
  await t.handle.db.update(bookings).set({ cancelledAt: new Date("2026-11-10T07:00:00Z") }).where(eq(bookings.id, freed));
  return { tomorrow, paid, freed };
}

describe("settings", () => {
  it("answers the defaults when nothing is saved, then what was saved", async () => {
    expect((await api.settings(REAL, open())).json).toEqual({ automations: off, googleReviewUrl: null, vatRatePct: 21 });
    const saved = await api.saveSettings(REAL, settings({ reminder: true, gap: true }, { vatRatePct: 10 }), open());
    expect(saved.status).toBe(200);
    expect(saved.json).toEqual({ automations: { ...off, reminder: true, gap: true }, googleReviewUrl: "https://g.page/r/lola/review", vatRatePct: 10 });
    expect((await api.settings(REAL, open())).json).toEqual(saved.json);
    expect(await t.handle.db.select().from(shopSettings)).toHaveLength(1);
    // The other shop keeps its defaults.
    expect((await api.settings(DEMO, { token: tokenFor(DEMO) })).json).toMatchObject({ automations: off });
  });

  it("review needs link", async () => {
    const a = await api.saveSettings(REAL, settings({ review: true }, { googleReviewUrl: null }), open());
    expect(a.status).toBe(422);
    expect(a.json).toEqual({ error: "review_needs_link" });
    expect(await t.handle.db.select().from(shopSettings)).toHaveLength(0);
    expect((await api.saveSettings(REAL, settings({ review: false }, { googleReviewUrl: null }), open())).status).toBe(200);
  });

  it("only takes a Google link and strict bodies", async () => {
    for (const bad of [
      settings({}, { googleReviewUrl: "https://evil.example/r" }),
      settings({}, { googleReviewUrl: "http://g.page/r/x" }),
      settings({}, { googleReviewUrl: "https://g.page/" + "a".repeat(300) }),
      settings({}, { vatRatePct: 31 }),
      settings({}, { vatRatePct: 10.5 }),
      { ...settings(), extra: 1 },
      { ...settings(), automations: { ...off, extra: true } },
      { automations: off, googleReviewUrl: null },
    ]) {
      expect((await api.saveSettings(REAL, bad, open())).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await t.handle.db.select().from(shopSettings)).toHaveLength(0);
  });

  it("switch off dismisses", async () => {
    await seedDay();
    await api.saveSettings(REAL, settings({ reminder: true, review: true, birthday: true }), open());
    const first = items(await api.outbox(REAL, open()));
    expect(first.map((i) => i.kind).sort()).toEqual(["birthday", "reminder", "review"]);
    // One is sent already; turning reminders off dismisses only the prepared reminder, never the others or a sent one.
    const review = first.find((i) => i.kind === "review")!;
    expect((await api.outboxAction(REAL, review.id, { action: "sent" }, open())).status).toBe(200);
    await api.saveSettings(REAL, settings({ reminder: false, review: false, birthday: true }), open());
    const status = Object.fromEntries((await rows()).map((r) => [r.kind, r.status]));
    expect(status).toEqual({ reminder: "dismissed", review: "sent", birthday: "prepared" });
    // Another shop's prepared messages are untouched.
    await api.saveSettings(DEMO, settings({}), { token: tokenFor(DEMO) });
    expect((await rows()).filter((r) => r.status === "prepared")).toHaveLength(1);
  });
});

describe("generation", () => {
  it("generation is idempotent", async () => {
    await seedDay();
    await api.saveSettings(REAL, settings({ reminder: true, review: true, gap: true, winback: true, birthday: true }), open());
    const a = await api.outbox(REAL, open());
    const b = await api.outbox(REAL, open());
    const c = await Promise.all([api.outbox(REAL, open()), api.outbox(REAL, open())]);
    expect(a.status).toBe(200);
    expect(items(b).map((i) => i.id)).toEqual(items(a).map((i) => i.id));
    // Two GETs at once: both answer the same rows (same ids), and the table holds one row per key.
    expect(c.map((x) => x.status)).toEqual([200, 200]);
    expect(items(c[0]).map((i) => i.id).sort()).toEqual(items(a).map((i) => i.id).sort());
    expect(items(c[1]).map((i) => i.id).sort()).toEqual(items(c[0]).map((i) => i.id).sort());
    const keys = (await rows()).map((r) => r.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(items(a).length);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    // A message that was sent or dismissed is not made again.
    const id = items(a)[0].id;
    await api.outboxAction(REAL, id, { action: "dismissed" }, open());
    await api.outbox(REAL, open());
    expect(await rows()).toHaveLength(keys.length);
  });

  it("writes each kind for the right people, in the shop's words", async () => {
    const { tomorrow, paid, freed } = await seedDay();
    await api.saveSettings(REAL, settings({ reminder: true, review: true, gap: true, winback: true, birthday: true }), open());
    const list = items(await api.outbox(REAL, open()));
    const all = await rows();
    const byKind = (k: string) => all.filter((r) => r.kind === k);
    expect(byKind("reminder").map((r) => [r.bookingId, r.phone])).toEqual([[tomorrow, "+34611000001"]]);
    expect(byKind("review").map((r) => r.bookingId)).toEqual([paid]);
    expect(byKind("gap").map((r) => r.bookingId)).toEqual([freed]);
    expect(byKind("birthday")).toHaveLength(1);
    expect(byKind("winback")).toHaveLength(1);
    // Reminder and review go to clients without consent; promotions do not.
    const promoPhones = all.filter((r) => ["gap", "winback", "birthday"].includes(r.kind)).map((r) => r.phone);
    expect(promoPhones).not.toContain("+34611000004");
    expect(promoPhones).not.toContain("+34611000001");
    for (const r of all.filter((r) => ["gap", "winback", "birthday"].includes(r.kind))) expect(r.body.endsWith("Responde BAJA si no quieres más mensajes.")).toBe(true);
    const reminder = list.find((i) => i.kind === "reminder")!;
    expect(reminder.body).toBe("Barbería Real: Hola Ana, te recordamos tu cita de mañana a las 10:00. Responde 1 para confirmar.");
    expect(reminder.waUrl).toBe(`https://wa.me/34611000001?text=${encodeURIComponent(reminder.body)}`);
    expect(list.find((i) => i.kind === "review")!.body).toContain("https://g.page/r/lola/review");
    expect(byKind("gap")[0].body).toContain("el jueves 12 a las 16:00");
  });

  it("no promotion without consent", async () => {
    await person(REAL, "+34611000004", "Dani Roca", { birthday: "11-10" });
    await addBooking(t, REAL, { start: "2026-08-02T09:00:00Z", name: "Dani Roca", phone: "+34611000004" });
    const freed = await addBooking(t, REAL, { start: "2026-11-12T15:00:00Z", name: "Eva Mir", phone: "+34611000005", status: "cancelled" });
    await t.handle.db.update(bookings).set({ cancelledAt: new Date("2026-11-10T07:00:00Z") }).where(eq(bookings.id, freed));
    await api.saveSettings(REAL, settings({ gap: true, winback: true, birthday: true }), open());
    expect(items(await api.outbox(REAL, open()))).toEqual([]);
    expect(await rows()).toHaveLength(0);
  });

  it("writes nothing while every switch is off, and lists the last 30 days of history after the prepared ones", async () => {
    await seedDay();
    expect(items(await api.outbox(REAL, open()))).toEqual([]);
    const [old, recent, waiting] = await t.handle.db
      .insert(outbox)
      .values([
        { shopId: REAL, kind: "winback", dedupeKey: "k:old", phone: "+34611000009", language: "es", body: "a", status: "sent", actedAt: new Date("2026-10-01T10:00:00Z") },
        { shopId: REAL, kind: "winback", dedupeKey: "k:recent", phone: "+34611000009", language: "es", body: "b", status: "dismissed", actedAt: new Date("2026-11-05T10:00:00Z") },
        { shopId: REAL, kind: "winback", dedupeKey: "k:waiting", phone: "+34611000009", language: "es", body: "c" },
      ])
      .returning({ id: outbox.id });
    expect(old.id).toBeTruthy();
    const list = items(await api.outbox(REAL, open()));
    expect(list.map((i) => i.id)).toEqual([waiting.id, recent.id]);
  });
});

describe("acting on a message", () => {
  const prepared = async (shopId = REAL, key = "k1") => {
    // A winback with a consenting client, its switch on: nothing stale about it.
    const clientId = await person(shopId, `+3461100${key.length}${Math.random().toString().slice(2, 7)}`, "Ana", { promoConsentAt: CONSENT });
    await t.handle.db
      .insert(shopSettings)
      .values({ shopId, automations: { winback: true } })
      .onConflictDoNothing();
    return (await t.handle.db.insert(outbox).values({ shopId, kind: "winback", clientId, dedupeKey: key, phone: "+34611000009", language: "es", body: "Hola" }).returning({ id: outbox.id }))[0].id;
  };

  it("moves a prepared message to sent or dismissed, once", async () => {
    const a = await prepared();
    const b = await prepared(REAL, "k2");
    const sent = await api.outboxAction(REAL, a, { action: "sent" }, open());
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({ id: a, status: "sent", waUrl: "https://wa.me/34611000009?text=Hola" });
    expect((await api.outboxAction(REAL, a, { action: "dismissed" }, open())).status).toBe(409);
    expect((await api.outboxAction(REAL, a, { action: "sent" }, open())).status).toBe(409);
    expect((await api.outboxAction(REAL, b, { action: "dismissed" }, open())).status).toBe(200);
    expect((await rows()).map((r) => r.status).sort()).toEqual(["dismissed", "sent"]);
    expect((await api.outboxAction(REAL, b, { action: "erase" }, open())).status).toBe(400);
  });

  it("cross-shop outbox id is not_found", async () => {
    const theirs = await prepared(DEMO, "k9");
    const before = JSON.stringify(await rows(DEMO));
    for (const id of [theirs, "00000000-0000-4000-8000-000000000001", "not-a-uuid"]) {
      const a = await api.outboxAction(REAL, id, { action: "sent" }, open());
      expect(a.status).toBe(404);
    }
    expect(JSON.stringify(await rows(DEMO))).toBe(before);
    // The other shop's message never shows in this shop's list either.
    await api.saveSettings(REAL, settings({ reminder: true }), open());
    expect(items(await api.outbox(REAL, open()))).toEqual([]);
  });

  it("needs the session", async () => {
    const id = await prepared();
    for (const o of [{}, { token: tokenFor(DEMO) }, { token: "garbage" }]) {
      for (const a of [await api.outbox(REAL, o), await api.settings(REAL, o), await api.saveSettings(REAL, settings(), o), await api.outboxAction(REAL, id, { action: "sent" }, o)]) {
        expect(a.status).toBe(401);
        expect(a.text).toBe("");
      }
    }
    expect((await rows())[0].status).toBe("prepared");
    expect(Temporal.Instant.from("2026-11-10T08:00:00Z").epochMilliseconds).toBe(env.now().epochMilliseconds);
  });
});

describe("stale messages at list time", () => {
  const prepared = async (o: Partial<typeof outbox.$inferInsert>) =>
    (await t.handle.db
      .insert(outbox)
      .values({ shopId: REAL, kind: "winback", dedupeKey: `k${Math.random()}`, phone: "+34611000009", language: "es", body: "Hola", ...o })
      .returning({ id: outbox.id }))[0].id;
  const statusOf = async (id: string) => (await t.handle.db.select().from(outbox).where(eq(outbox.id, id)))[0].status;

  it("race: a GET that generated while the switch went off shows and sells nothing of that kind", async () => {
    await seedDay();
    await api.saveSettings(REAL, settings({ reminder: true }), open());
    const first = items(await api.outbox(REAL, open()));
    expect(first.map((i) => i.kind)).toEqual(["reminder"]);
    // The switch goes off, then a late writer inserts a row of that kind (what a GET in flight does).
    await api.saveSettings(REAL, settings({ reminder: false }), open());
    const late = await prepared({ kind: "reminder", dedupeKey: "reminder:late" });
    const a = await api.outbox(REAL, open());
    expect(waiting(a)).toEqual([]);
    expect(await statusOf(late)).toBe("dismissed");
    const send = await api.outboxAction(REAL, late, { action: "sent" }, open());
    expect(send.status).toBe(409);
    expect(send.json).toEqual({ error: "not_prepared" });
    // Even without a GET in between: a prepared row of an off kind cannot be sent.
    const another = await prepared({ kind: "reminder", dedupeKey: "reminder:later" });
    expect((await api.outboxAction(REAL, another, { action: "sent" }, open())).status).toBe(409);
    expect(await statusOf(another)).toBe("dismissed");
  });

  it("consent withdrawn: promotions without consent or without a client row are dismissed at list time", async () => {
    await api.saveSettings(REAL, settings({ winback: true, gap: true, birthday: true }), open());
    const yes = await person(REAL, "+34611000001", "Ana", { promoConsentAt: CONSENT });
    const no = await person(REAL, "+34611000002", "Bea");
    const kept = await prepared({ clientId: yes, dedupeKey: "w1" });
    const withdrawn = await prepared({ clientId: no, dedupeKey: "w2", kind: "birthday" });
    const orphan = await prepared({ clientId: null, dedupeKey: "w3", kind: "gap" });
    expect(waiting(await api.outbox(REAL, open())).map((i) => i.id)).toEqual([kept]);
    expect(await statusOf(withdrawn)).toBe("dismissed");
    expect(await statusOf(orphan)).toBe("dismissed");
  });

  it("consent withdrawn on the client card dismisses that client's waiting promotions at once", async () => {
    const id = await person(REAL, "+34611000001", "Ana", { promoConsentAt: CONSENT });
    const other = await person(REAL, "+34611000002", "Bea", { promoConsentAt: CONSENT });
    const mine = await prepared({ clientId: id, dedupeKey: "a" });
    const theirs = await prepared({ clientId: other, dedupeKey: "b" });
    const reminder = await prepared({ clientId: id, kind: "reminder", dedupeKey: "c" });
    expect((await api.clientAction(REAL, id, { action: "consent", consent: false }, open())).status).toBe(200);
    expect(await statusOf(mine)).toBe("dismissed");
    expect(await statusOf(theirs)).toBe("prepared");
    expect(await statusOf(reminder)).toBe("prepared");
  });

  it("a reminder or review whose booking was cancelled is dismissed", async () => {
    await api.saveSettings(REAL, settings({ reminder: true, review: true }), open());
    const b1 = await addBooking(t, REAL, { start: "2026-11-11T09:00:00Z", phone: "+34611000001" });
    const b2 = await addBooking(t, REAL, { start: "2026-11-12T09:00:00Z", phone: "+34611000002" });
    const reminder = await prepared({ kind: "reminder", bookingId: b1, dedupeKey: `reminder:${b1}` });
    const review = await prepared({ kind: "review", bookingId: b2, dedupeKey: `review:${b2}` });
    const fine = await prepared({ kind: "review", bookingId: null, dedupeKey: "review:none" });
    await t.handle.db.update(bookings).set({ status: "cancelled", cancelledAt: new Date("2026-11-10T07:00:00Z") }).where(eq(bookings.id, b1));
    await t.handle.db.update(bookings).set({ status: "cancelled", cancelledAt: new Date("2026-11-10T07:00:00Z") }).where(eq(bookings.id, b2));
    expect(waiting(await api.outbox(REAL, open())).map((i) => i.id)).toEqual([fine]);
    expect(await statusOf(reminder)).toBe("dismissed");
    expect(await statusOf(review)).toBe("dismissed");
    expect((await api.outboxAction(REAL, reminder, { action: "sent" }, open())).status).toBe(409);
  });

  it("only takes the review link shapes of Google", async () => {
    for (const bad of ["https://www.google.com/url?q=https://evil.example", "https://search.google.com/search?q=x"]) {
      expect((await api.saveSettings(REAL, settings({}, { googleReviewUrl: bad }), open())).status, bad).toBe(400);
    }
    for (const ok of ["https://g.page/r/abc/review", "https://search.google.com/local/writereview?placeid=x", "https://www.google.com/maps/place/x"]) {
      expect((await api.saveSettings(REAL, settings({}, { googleReviewUrl: ok }), open())).status, ok).toBe(200);
    }
  });
});

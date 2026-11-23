import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { createTestDb, type TestDb } from "../db/pglite";
import { bookingWrite, callWrite, insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import { notSure } from "./notSure";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { CoreDeps, ModelClient, Repository, TurnOutput } from "@/lib/conversation/types";
import { bookings, calls, messages } from "@/lib/db/schema";
import { lolaSeedProfile } from "@/lib/db/seed";
import { createScriptedModel } from "@/lib/receptionist/callModel";
import { SAT_1930 } from "./brainCall";
import { coreConfig, CoreCaller, modelTurn, switchModel } from "./coreCall";
import { memoryRepository } from "./memoryRepository";

/**
 * Task 9.1: the in-memory Repository against the PGlite repository on the same scripted Calls.
 * Both get the same ids, the same clock and the same model, so every reply, every Call row,
 * every booking and every Message must come out the same.
 */
const NOW = Temporal.Instant.from("2026-11-10T08:00:00Z"); // Tuesday 10 November, 09:00 Madrid
const RICH = { ...lolaSeedProfile, id: "peluqueria-lola-rich", name: "Peluquería Lola (rica)" } as ShopProfile;

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
  await insertShop(t, RICH);
});
afterAll(async () => {
  await t.close();
});

function depsFor(repo: Repository, model: ModelClient, now: Temporal.Instant): CoreDeps {
  let n = 0;
  return {
    repo,
    model,
    limiter: { hit: (key, at) => repo.hitRateLimits(key, at) },
    clock: () => now,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    config: coreConfig,
    logFallback: () => {},
  };
}

interface Snapshot {
  outputs: TurnOutput[];
  calls: unknown[];
  bookings: unknown[];
  messages: unknown[];
  callerBookings: unknown[];
}

type Script = (c: CoreCaller) => Promise<TurnOutput[]>;

async function onPglite(shop: ShopProfile, model: () => ModelClient, now: Temporal.Instant, script: Script, phone: string): Promise<Snapshot> {
  const deps = depsFor(t.repo, model(), now);
  const outputs = await script(new CoreCaller(deps, shop));
  const callRows = await t.handle.db.select().from(calls);
  const bookingRows = await t.handle.db.select().from(bookings);
  const messageRows = await t.handle.db.select().from(messages);
  return {
    outputs,
    calls: callRows
      .map((r) => ({ id: r.id, status: r.status, language: r.language, state: r.state, transcript: r.transcript, turnCount: r.turnCount }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    bookings: bookingRows
      .map((r) => ({
        id: r.id,
        resourceId: r.resourceId,
        serviceId: r.serviceId,
        start: r.startsAt.toISOString(),
        end: r.endsAt.toISOString(),
        status: r.status,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        callId: r.callId,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    messages: messageRows.map((m) => ({
      callId: m.callId,
      outcome: m.outcome,
      callerName: m.callerName,
      callerPhone: m.callerPhone,
      reason: m.reason,
      urgency: m.urgency,
      urgencySuggested: m.urgencySuggested,
      urgencyBasis: m.urgencyBasis,
      agreed: m.agreed,
      suggestedReply: m.suggestedReply,
      modelFailed: m.modelFailed,
      bookingId: m.bookingId,
    })),
    callerBookings: await t.repo.findCallerBookings(shop.id, phone, now),
  };
}

async function inMemory(shop: ShopProfile, model: () => ModelClient, now: Temporal.Instant, script: Script, phone: string): Promise<Snapshot> {
  const repo = memoryRepository({ shops: [lolaProfile, RICH], clock: () => now });
  const deps = depsFor(repo, model(), now);
  const outputs = await script(new CoreCaller(deps, shop));
  return {
    outputs,
    calls: repo
      .calls()
      .map((r) => ({ id: r.id, status: r.status, language: r.language, state: r.state, transcript: r.transcript, turnCount: r.turnCount }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    bookings: repo
      .bookings()
      .map((r) => ({
        id: r.id,
        resourceId: r.resourceId,
        serviceId: r.serviceId,
        start: new Date(r.start.epochMilliseconds).toISOString(),
        end: new Date(r.end.epochMilliseconds).toISOString(),
        status: r.status,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        callId: r.callId,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    messages: repo.messages().map((m) => ({
      callId: m.callId,
      outcome: m.outcome,
      callerName: m.callerName,
      callerPhone: m.callerPhone,
      reason: m.reason,
      urgency: m.urgency,
      urgencySuggested: m.urgencySuggested,
      urgencyBasis: m.urgencyBasis,
      agreed: m.agreed,
      suggestedReply: m.suggestedReply,
      modelFailed: m.modelFailed,
      bookingId: m.bookingId ?? null,
    })),
    callerBookings: await repo.findCallerBookings(shop.id, phone, now),
  };
}

const says = (lines: string[]): Script => async (c) => {
  const out = [await c.start()];
  for (const l of lines) {
    const r = await c.say(l);
    out.push(r);
    if (r.complete) break;
  }
  return out;
};

describe("memoryRepository behaves like the PGlite repository on the same scripted Calls", () => {
  it("a model-path booking: Ana books Wednesday 19:30 and the Message links to it", async () => {
    const all = { service: "corte", date: "2026-11-11", time: "19:30", name: "Ana", phone: "612345678", reason: "Quiere un corte" };
    const model = () => createScriptedModel([modelTurn({ ...all, reply: "Te lo confirmo." }), modelTurn({ ...all, reply: "¡Genial!", callerConfirmed: true })]);
    const script = says(["Un corte mañana a las 19:30, soy Ana, 612345678", "Sí"]);
    const mem = await inMemory(lolaProfile, model, NOW, script, "+34612345678");
    const pg = await onPglite(lolaProfile, model, NOW, script, "+34612345678");
    expect(mem).toEqual(pg);
    expect(pg.outputs.at(-1)).toMatchObject({ complete: true, outcome: "booked" });
    expect(pg.bookings).toHaveLength(1);
    expect(pg.callerBookings).toHaveLength(1);
  });

  it("a brain-only booking with a failing model: the Combo_Id booking and a model_failed Message", async () => {
    const model = () => switchModel({ kind: "503" });
    // front-desk-brain 17.5: every line of the real call is now a Sure_Reading, which never calls the
    // model (that Call is pinned by task 10's regression). The first line carries the not-sure tail,
    // so the failing model is still reached once and the Message still says model_failed.
    const script = says([notSure("Hola Lola quería cortarme el pelo y hacerme un degradado", "es"), "sí", "Me llamo Ana", "612 345 678", "sí"]);
    const mem = await inMemory(RICH, model, SAT_1930, script, "+34612345678");
    const pg = await onPglite(RICH, model, SAT_1930, script, "+34612345678");
    expect(mem).toEqual(pg);
    expect(pg.outputs.at(-1)).toMatchObject({ complete: true, outcome: "booked" });
    expect(pg.bookings).toMatchObject([{ serviceId: "corte-hombre+degradado", status: "confirmed" }]);
    expect(pg.messages).toMatchObject([{ outcome: "booked", modelFailed: true }]);
  });

  it("a hang-up mid-call, then a late say: one abandoned Message, the Call left as it is", async () => {
    const model = () => switchModel({ kind: "hang" });
    const script: Script = async (c) => {
      const out = [await c.start(), await c.say("quería un corte de mujer"), await c.say("Me llamo Ana")];
      out.push(await c.hangup(), await c.hangup(), await c.say("¿Hola?"));
      return out;
    };
    const mem = await inMemory(RICH, model, SAT_1930, script, "+34612345678");
    const pg = await onPglite(RICH, model, SAT_1930, script, "+34612345678");
    expect(mem).toEqual(pg);
    expect(pg.messages).toMatchObject([{ outcome: "abandoned" }]);
    expect(pg.calls).toMatchObject([{ status: "abandoned" }]);
  });

  it("the visitor rate limit: the Fallback_Message, a failed Call and a fallback Message", async () => {
    const model = () => switchModel({ kind: "503" });
    const limited = (repo: Repository, now: Temporal.Instant): CoreDeps => ({
      ...depsFor(repo, model(), now),
      config: { ...coreConfig, perVisitorPerMinute: 2 },
    });
    const run = async (repo: Repository) => {
      const c = new CoreCaller(limited(repo, SAT_1930), RICH);
      return [await c.start(), await c.say("quería un corte de mujer"), await c.say("Me llamo Ana")];
    };
    const memRepo = memoryRepository({ shops: [lolaProfile, RICH], clock: () => SAT_1930 });
    const memOut = await run(memRepo);
    const pgOut = await run(t.repo);
    expect(memOut).toEqual(pgOut);
    expect(pgOut.at(-1)).toMatchObject({ complete: true, outcome: "fallback" });
    expect(memRepo.calls().map((c) => c.status)).toEqual(["failed"]);
    expect(memRepo.messages().map((m) => m.outcome)).toEqual(["fallback"]);
  });
});

describe("commit: atomic, and an overlap is booking_overlap like the 23P01 constraint", () => {
  const SHOP = lolaProfile.id;
  const AT = "2026-11-11T18:30:00Z";

  async function both(steps: ((r: Repository) => Promise<unknown>)[]) {
    const mem = memoryRepository({ shops: [lolaProfile] });
    const a: unknown[] = [];
    const b: unknown[] = [];
    for (const s of steps) {
      a.push(await s(mem));
      b.push(await s(t.repo));
    }
    return { mem: a, pg: b, memRepo: mem };
  }

  it("overlapping, adjacent and other-chair bookings get the same answers, and a refused batch writes nothing", async () => {
    const c1 = callWrite(SHOP, "00000000-0000-4000-8000-000000000001");
    const c2 = callWrite(SHOP, "00000000-0000-4000-8000-000000000002");
    const c3 = callWrite(SHOP, "00000000-0000-4000-8000-000000000003");
    const c4 = callWrite(SHOP, "00000000-0000-4000-8000-000000000004");
    const c5 = callWrite(SHOP, "00000000-0000-4000-8000-000000000005");
    const steps = [
      (r: Repository) => r.commit([c1, bookingWrite({ id: "00000000-0000-4000-9000-000000000001", shopId: SHOP, callId: c1.call.id, start: AT })]),
      // 15 minutes into the first booking, same chair: refused, and the Call of the batch is not written either.
      (r: Repository) =>
        r.commit([c2, bookingWrite({ id: "00000000-0000-4000-9000-000000000002", shopId: SHOP, callId: c2.call.id, start: "2026-11-11T18:45:00Z" })]),
      (r: Repository) => r.getCall(c2.call.id, SHOP).then((c) => c?.id ?? null),
      // Starts exactly when the first ends: half-open ranges, so accepted.
      (r: Repository) =>
        r.commit([c3, bookingWrite({ id: "00000000-0000-4000-9000-000000000003", shopId: SHOP, callId: c3.call.id, start: "2026-11-11T19:00:00Z" })]),
      // Same time, the other chair: accepted.
      (r: Repository) =>
        r.commit([c4, bookingWrite({ id: "00000000-0000-4000-9000-000000000004", shopId: SHOP, callId: c4.call.id, start: AT, resourceId: "chair-2" })]),
      (r: Repository) =>
        r.listBookings(SHOP, Temporal.Instant.from("2026-11-11T00:00:00Z"), Temporal.Instant.from("2026-11-12T00:00:00Z")).then((xs) =>
          xs.map((x) => [x.id, x.resourceId, x.start.toString(), x.end.toString()]),
        ),
      // A cancel then an insert on the freed chair in one batch (a reschedule): accepted.
      (r: Repository) =>
        r.commit([
          c5,
          { type: "cancelBooking", bookingId: "00000000-0000-4000-9000-000000000001" },
          bookingWrite({ id: "00000000-0000-4000-9000-000000000005", shopId: SHOP, callId: c5.call.id, start: AT, rescheduledFrom: "00000000-0000-4000-9000-000000000001" }),
        ]),
      (r: Repository) => r.findCallerBookings(SHOP, "+34612345678", Temporal.Instant.from("2026-11-10T00:00:00Z")).then((xs) => xs.map((x) => x.id)),
    ];
    const { mem, pg } = await both(steps);
    expect(mem).toEqual(pg);
    expect(pg[0]).toEqual({ ok: true });
    expect(pg[1]).toEqual({ ok: false, conflict: "booking_overlap" });
    expect(pg[2]).toBeNull();
    expect(pg[3]).toEqual({ ok: true });
    expect(pg[4]).toEqual({ ok: true });
    expect(pg[6]).toEqual({ ok: true });
    expect((pg[7] as string[]).sort()).toEqual([
      "00000000-0000-4000-9000-000000000003",
      "00000000-0000-4000-9000-000000000004",
      "00000000-0000-4000-9000-000000000005",
    ]);
  });

  it("a booking for a Call that does not exist is an error, not an overlap, in both", async () => {
    const write = bookingWrite({ shopId: SHOP, callId: "00000000-0000-4000-8000-0000000000ff", start: AT });
    await expect(t.repo.commit([write])).rejects.toThrow();
    await expect(memoryRepository({ shops: [lolaProfile] }).commit([write])).rejects.toThrow();
  });

  it("rate limits count the visitor's minute and the global hour the same way", async () => {
    const at = Temporal.Instant.from("2026-11-11T18:30:30Z");
    const steps = [
      (r: Repository) => r.hitRateLimits("v1", at),
      (r: Repository) => r.hitRateLimits("v1", at.add({ seconds: 20 })),
      (r: Repository) => r.hitRateLimits("v2", at.add({ seconds: 31 })), // the next minute, same hour
      (r: Repository) => r.hitRateLimits("v1", at.add({ minutes: 1 })),
      (r: Repository) => r.pruneRateLimits(at.add({ minutes: 1 })),
    ];
    const { mem, pg } = await both(steps);
    expect(mem).toEqual(pg);
    expect(pg.slice(0, 4)).toEqual([
      { visitor: 1, visitorHour: 1, global: 1 },
      { visitor: 2, visitorHour: 2, global: 2 },
      { visitor: 1, visitorHour: 1, global: 3 },
      { visitor: 1, visitorHour: 3, global: 4 }, // 18:31:30 is a new minute for v1, the same hour
    ]);
  });
});

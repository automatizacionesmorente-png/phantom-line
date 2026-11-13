import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { bookingWrite, callWrite, insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import type { ModelClient, TurnOutput } from "@/lib/conversation/types";
import { bookings, calls, messages } from "@/lib/db/schema";
import { createScriptedModel, neverResolves, returnsGarbage, throws429 } from "@/lib/receptionist/callModel";
import { phrases, type Said } from "@/lib/receptionist/phrases";
import { toSpokenReply } from "@/lib/receptionist/speech";
import { getSectorPack } from "@/lib/sectors";
import { Caller, makeDeps, makePost, modelTurn, NOW, request, setupDb, SHOP } from "./harness";

/** Task 8.5: the scripted failure Calls through POST /api/turn, on PGlite. */
const pack = getSectorPack("hair-salon");
const ES = phrases("es", pack, lolaProfile, undefined, NOW);
/** A code-owned line as the caller hears it. */
const spoken = (line: Said) => toSpokenReply(line.text, "es", { maxSentences: 3 });
const WED_1930 = Temporal.Instant.from("2026-11-11T18:30:00Z");

let t: TestDb;
beforeAll(async () => {
  t = await setupDb();
}, 60_000);
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
});
afterAll(async () => {
  await t.close();
});

const allMessages = () => t.handle.db.select().from(messages);
const allBookings = () => t.handle.db.select().from(bookings);
const callRow = async (id: string) => (await t.handle.db.select().from(calls).where(eq(calls.id, id)))[0];

/** A model that answers once with a name heard, then fails the way `failing` does. */
function thenFails(failing: ModelClient): ModelClient & { count: number } {
  const first = createScriptedModel([modelTurn({ reply: "¿Qué día te viene bien?", name: "Ana", service: "corte", reason: "Quiere un corte" })]);
  const m = {
    count: 0,
    generate(req: Parameters<ModelClient["generate"]>[0]) {
      m.count++;
      return m.count === 1 ? first.generate(req) : failing.generate(req);
    },
  };
  return m;
}

async function expectFallbackMessage(callId: string) {
  const ms = await allMessages();
  expect(ms).toHaveLength(1);
  expect(ms[0]).toMatchObject({ callId, outcome: "fallback", modelFailed: true, callerName: "Ana", reason: "Quiere un corte" });
  expect(ms[0].agreed).toBeTruthy();
  expect(ms[0].suggestedReply).toContain("Ana");
  expect(await allBookings()).toHaveLength(0);
  expect((await callRow(callId)).status).toBe("failed");
}

describe("model failures take the end path: Fallback_Message, Call ends, Message with model_failed", () => {
  it("a model timeout", async () => {
    const model = thenFails(neverResolves);
    const { POST } = makePost(makeDeps(t, model, { modelTimeoutMs: 50 }));
    const c = new Caller(POST);
    await c.start();
    expect((await c.say("Quiero un corte, soy Ana")).body.complete).toBe(false);
    const started = Date.now();
    const r = await c.say("El viernes");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reply: spoken(ES.fallbackEnd()), complete: true, outcome: "fallback" });
    await expectFallbackMessage(c.callId);
  });

  it("a 429 from the model (quota)", async () => {
    const model = thenFails(throws429);
    const { POST } = makePost(makeDeps(t, model));
    const c = new Caller(POST);
    await c.start();
    await c.say("Quiero un corte, soy Ana");
    const r = await c.say("El viernes");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reply: spoken(ES.fallbackEnd()), complete: true, outcome: "fallback" });
    await expectFallbackMessage(c.callId);
  });
});

describe("invalid model output takes the retry path", () => {
  it("once: the retry Fallback_Message, and the Call continues", async () => {
    const script = createScriptedModel([
      '{"reply": "hola", "intent": "maybe"',
      modelTurn({ reply: "¿Qué servicio quieres?", reason: "Quiere una cita" }),
    ]);
    const { POST } = makePost(makeDeps(t, script));
    const c = new Caller(POST);
    await c.start();
    const r1 = await c.say("Hola, quería una cita");
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ reply: spoken(ES.fallbackRetry()), complete: false });
    expect(r1.body.outcome).toBeUndefined();
    const r2 = await c.say("Una cita, por favor");
    expect(r2.body).toMatchObject({ reply: "¿Qué servicio quieres?", complete: false });
    expect(await allMessages()).toHaveLength(0);
    expect((await callRow(c.callId)).status).toBe("open");
  });

  it("twice in a row: the Call ends with the end Fallback_Message and a model_failed Message", async () => {
    const { POST } = makePost(makeDeps(t, returnsGarbage));
    const c = new Caller(POST);
    await c.start();
    expect((await c.say("Hola")).body).toMatchObject({ reply: spoken(ES.fallbackRetry()), complete: false });
    const r = await c.say("Hola, ¿me oyes?");
    expect(r.body).toMatchObject({ reply: spoken(ES.fallbackEnd()), complete: true, outcome: "fallback" });
    const ms = await allMessages();
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ outcome: "fallback", modelFailed: true });
  });
});

describe("rate limits", () => {
  it("the visitor limit reached mid-call: 200, the Fallback_Message and a Message; the model is not called", async () => {
    const model = createScriptedModel([modelTurn({ reply: "¿Qué día?", name: "Ana", service: "corte", reason: "Quiere un corte" })]);
    // start = Turn 1, first say = Turn 2, second say = Turn 3: over a limit of 2.
    const { POST } = makePost(makeDeps(t, model, { perVisitorPerMinute: 2 }));
    const c = new Caller(POST);
    await c.start();
    await c.say("Quiero un corte, soy Ana");
    const r = await c.say("El viernes");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reply: spoken(ES.fallbackEnd()), complete: true, outcome: "fallback" });
    expect(model.calls).toHaveLength(1);
    await expectFallbackMessage(c.callId);
  });

  it("the global limit reached mid-call takes the same path, for a different visitor", async () => {
    const model = createScriptedModel([modelTurn({ reply: "¿Qué día?", name: "Ana", service: "corte", reason: "Quiere un corte" })]);
    const { POST } = makePost(makeDeps(t, model, { globalPerHour: 3 }));
    await new Caller(POST, "es", "198.51.100.1").start(); // global Turn 1, another visitor
    const c = new Caller(POST, "es", "198.51.100.2");
    await c.start(); // 2
    await c.say("Quiero un corte, soy Ana"); // 3
    const r = await c.say("El viernes"); // 4: over
    expect(r.body).toMatchObject({ reply: spoken(ES.fallbackEnd()), complete: true, outcome: "fallback" });
    await expectFallbackMessage(c.callId);
  });

  it("the limit on start: the busy line, no Call row and no Message", async () => {
    const { POST } = makePost(makeDeps(t, createScriptedModel([]), { perVisitorPerMinute: 1 }));
    expect((await new Caller(POST).start()).status).toBe(200);
    const r = await new Caller(POST).start();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reply: spoken(ES.rateLimitedStart()), complete: true });
    expect(await t.handle.db.select().from(calls)).toHaveLength(1); // only the first Call
    expect(await allMessages()).toHaveLength(0);
  });
});

describe("hang-up", () => {
  it("mid-call: an abandoned Message with the fields so far, no Booking, idempotent on repeat", async () => {
    const model = createScriptedModel([
      modelTurn({ reply: "¿Y tu nombre?", service: "corte", date: "2026-11-11", time: "19:30", reason: "Quiere un corte" }),
      modelTurn({ reply: "¿Y tu teléfono?", service: "corte", date: "2026-11-11", time: "19:30", name: "Ana", reason: "Quiere un corte" }),
    ]);
    const { POST } = makePost(makeDeps(t, model));
    const c = new Caller(POST);
    await c.start();
    await c.say("Un corte mañana a las siete y media");
    await c.say("Ana");
    const h1 = await c.hangup();
    expect(h1.status).toBe(200);
    expect(h1.body).toMatchObject({ complete: true, outcome: "abandoned" });
    const h2 = await c.hangup();
    expect(h2.status).toBe(200);
    expect(h2.body).toMatchObject({ complete: true });

    const ms = await allMessages();
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ outcome: "abandoned", callerName: "Ana", reason: "Quiere un corte", modelFailed: false });
    expect(await allBookings()).toHaveLength(0);
    expect((await callRow(c.callId)).status).toBe("abandoned");

    // A Turn after the hang-up changes nothing.
    const late = await c.say("Hola?");
    expect(late.body).toMatchObject({ complete: true });
    expect(model.calls).toHaveLength(2);
    expect(await allMessages()).toHaveLength(1);
  });

  it("a hang-up that never arrives: the after() sweep closes the idle Call with its Message", async () => {
    const stale = callWrite(SHOP);
    await t.repo.commit([stale]);
    await t.handle.db.update(calls).set({ updatedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(calls.id, stale.call.id));
    // The sweep compares with the deps' clock; use the real one here, as production does.
    const deps = { ...makeDeps(t, createScriptedModel([])), clock: () => Temporal.Now.instant() };
    const { POST, settle } = makePost(deps);
    await new Caller(POST).start();
    await settle();
    expect((await callRow(stale.call.id)).status).toBe("abandoned");
    const ms = await allMessages();
    expect(ms.map((m) => [m.callId, m.outcome])).toEqual([[stale.call.id, "abandoned"]]);
  });
});

describe("requests the adapter refuses", () => {
  it("an unknown shop: 404", async () => {
    const { POST } = makePost(makeDeps(t, createScriptedModel([])));
    const res = await POST(request({ kind: "start", shopId: "no-such-shop", language: "es" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "shop_not_found" });
  });

  it("an unknown callId on say: 404, and the model is not called", async () => {
    const model = createScriptedModel([]);
    const { POST } = makePost(makeDeps(t, model));
    const res = await POST(
      request({ kind: "say", shopId: SHOP, language: "es", callId: randomUUID(), utterance: "Hola", conversation: [] }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "call_not_found" });
    expect(model.calls).toHaveLength(0);
  });

  it("a forged body with accepted: true: 400 naming the key, and nothing is written", async () => {
    const model = createScriptedModel([]);
    const { POST } = makePost(makeDeps(t, model));
    const c = new Caller(POST);
    await c.start();
    const res = await POST(
      request({ kind: "say", shopId: SHOP, language: "es", callId: c.callId, utterance: "Sí", conversation: [], accepted: true }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: { keys?: string[] }[] };
    expect(body.error).toBe("invalid_request");
    expect(body.issues.flatMap((i) => i.keys ?? [])).toEqual(["accepted"]);
    expect(model.calls).toHaveLength(0);
    expect(await allBookings()).toHaveLength(0);
  });

  it("an utterance over 500 characters or more than 20 Turns: 400 (Requirement 3.3)", async () => {
    const { POST } = makePost(makeDeps(t, createScriptedModel([])));
    const callId = randomUUID();
    const long = await POST(request({ kind: "say", shopId: SHOP, language: "es", callId, utterance: "a".repeat(501), conversation: [] }));
    expect(long.status).toBe(400);
    const line = { caller: "hola", receptionist: "hola" };
    const many = await POST(
      request({ kind: "say", shopId: SHOP, language: "es", callId, utterance: "hola", conversation: Array(21).fill(line) }),
    );
    expect(many.status).toBe(400);
  });

  it("the database down during a Turn: 503 with the Fallback_Message", async () => {
    const deps = makeDeps(t, createScriptedModel([]));
    const broken = { ...deps, repo: { ...deps.repo, commit: () => Promise.reject(new Error("connection refused")) } };
    const { POST } = makePost(broken);
    const res = await POST(request({ kind: "start", shopId: SHOP, language: "es" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable", reply: spoken(ES.fallbackEnd()) });
  });
});

describe("two parallel confirmations for the last free slot", () => {
  it("one gets the booking; the other hears the slot was just taken, with alternatives", async () => {
    // Chair 2 is already taken on Wednesday at 19:30, so chair 1 is the last free one.
    const other = callWrite(SHOP);
    await t.repo.commit([other, bookingWrite({ shopId: SHOP, callId: other.call.id, start: "2026-11-11T18:30:00Z", resourceId: "chair-2", customerName: "Luis" })]);

    const callerScript = (name: string, phone: string) => {
      const all = { service: "corte", date: "2026-11-11", time: "19:30", name, phone, reason: "Quiere un corte" };
      return createScriptedModel([
        modelTurn({ ...all, reply: "Te lo confirmo." }),
        modelTurn({ ...all, reply: "¡Genial!", callerConfirmed: true }),
      ]);
    };
    const ana = new Caller(makePost(makeDeps(t, callerScript("Ana", "612345678"))).POST, "es", "198.51.100.10");
    const bea = new Caller(makePost(makeDeps(t, callerScript("Bea", "622345678"))).POST, "es", "198.51.100.11");
    await Promise.all([ana.start(), bea.start()]);
    const readBack = (name: string, phone: string) => spoken(ES.readBack("haircut", WED_1930, name, phone));
    const [ra, rb] = await Promise.all([ana.say("Un corte mañana a las 19:30, soy Ana, 612345678"), bea.say("Un corte mañana a las 19:30, soy Bea, 622345678")]);
    expect(ra.body.reply).toBe(readBack("Ana", "+34612345678"));
    expect(rb.body.reply).toBe(readBack("Bea", "+34622345678"));

    const results: TurnOutput[] = (await Promise.all([ana.say("Sí"), bea.say("Sí")])).map((r) => r.body);
    const won = results.filter((r) => r.outcome === "booked");
    const lost = results.filter((r) => r.outcome !== "booked");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].complete).toBe(false);
    expect(lost[0].reply).toMatch(/^¡Vaya, justo se acaba de ocupar! ¿Te viene bien /);

    const confirmed = (await allBookings()).filter((b) => b.status === "confirmed");
    expect(confirmed).toHaveLength(2); // Luis on chair 2 and the winner on chair 1
    const winner = confirmed.find((b) => b.customerName !== "Luis");
    expect(winner?.resourceId).toBe("chair-1");
    expect((await allMessages()).filter((m) => m.outcome === "booked")).toHaveLength(1);
  });
});

describe("reschedule and cancel with a name mismatch read back nothing", () => {
  const ANA_BOOKING = "2026-11-17T09:00:00Z"; // Tuesday 17, 10:00 Madrid

  async function seedAnaBooking() {
    const c = callWrite(SHOP);
    await t.repo.commit([c, bookingWrite({ shopId: SHOP, callId: c.call.id, start: ANA_BOOKING, customerName: "Ana", customerPhone: "+34612345678" })]);
  }

  async function attempt(intent: "reschedule" | "cancel", name: string, phone: string) {
    const model = createScriptedModel([
      modelTurn({ intent, reply: "¿Me dices tu teléfono?", reason: "Quiere cambiar su cita" }),
      modelTurn({ intent, reply: "¿Y tu nombre?", phone, reason: "Quiere cambiar su cita" }),
      modelTurn({ intent, reply: "Un momento.", phone, name, reason: "Quiere cambiar su cita" }),
    ]);
    const c = new Caller(makePost(makeDeps(t, model)).POST);
    await c.start();
    await c.say(intent === "cancel" ? "Quiero anular mi cita" : "Quiero cambiar mi cita");
    await c.say(phone);
    return (await c.say(name)).body;
  }

  for (const intent of ["reschedule", "cancel"] as const) {
    it(`${intent}: a wrong name and an unknown phone get the same not-found reply`, async () => {
      await seedAnaBooking();
      const mismatch = await attempt(intent, "Marta", "612 345 678");
      const noBooking = await attempt(intent, "Ana", "699 999 999");
      expect(mismatch.reply).toBe(spoken(ES.bookingNotFound()));
      expect(noBooking.reply).toBe(mismatch.reply);
      for (const r of [mismatch, noBooking]) {
        expect(r.complete).toBe(false);
        expect(r.reply).not.toMatch(/corte|martes|17|10:00/);
      }
      const rows = await allBookings();
      expect(rows.filter((b) => b.status === "confirmed")).toHaveLength(1);
    });
  }
});

describe("commit retries on booking_overlap (23P01)", () => {
  /** Ana at awaiting_confirmation for Wednesday 19:30, then "sí". */
  const anaScript = () => {
    const all = { service: "corte", date: "2026-11-11", time: "19:30", name: "Ana", phone: "612345678", reason: "Quiere un corte" };
    return createScriptedModel([modelTurn({ ...all, reply: "Te lo confirmo." }), modelTurn({ ...all, reply: "¡Genial!", callerConfirmed: true })]);
  };

  /** Before Ana's first booking commit, another Call takes the chairs listed, so her commit hits the constraint. */
  function racingRepo(deps: ReturnType<typeof makeDeps>, steal: string[]) {
    let raced = false;
    const commits: string[] = [];
    const repo = {
      ...deps.repo,
      async commit(writes: Parameters<typeof deps.repo.commit>[0]) {
        const booking = writes.find((w) => w.type === "insertBooking");
        if (booking && !raced) {
          raced = true;
          for (const resourceId of steal) {
            const other = callWrite(SHOP);
            await t.repo.commit([other, bookingWrite({ shopId: SHOP, callId: other.call.id, start: "2026-11-11T18:30:00Z", resourceId, customerName: "Luis" })]);
          }
        }
        const r = await deps.repo.commit(writes);
        commits.push(r.ok ? "ok" : r.conflict);
        return r;
      },
    };
    return { deps: { ...deps, repo }, commits };
  }

  it("the chair is taken just before the commit: re-read, and the booking goes to the other chair", async () => {
    const { deps, commits } = racingRepo(makeDeps(t, anaScript()), ["chair-1"]);
    const c = new Caller(makePost(deps).POST);
    await c.start();
    await c.say("Un corte mañana a las 19:30, soy Ana, 612345678");
    const r = await c.say("Sí");
    // "Sí" is Turn 2 of this Call, so the Variant_Seed is { callId, turn: 2 }.
    const booked = phrases("es", pack, lolaProfile, { callId: c.callId, turn: 2 }, NOW).booked("haircut", WED_1930);
    expect(r.body).toMatchObject({ outcome: "booked", complete: true, reply: spoken(booked) });
    expect(commits.slice(-2)).toEqual(["booking_overlap", "ok"]);
    const mine = (await allBookings()).filter((b) => b.customerName === "Ana");
    expect(mine.map((b) => b.resourceId)).toEqual(["chair-2"]);
    expect((await allMessages()).filter((m) => m.callId === c.callId)).toHaveLength(1);
  });

  it("both chairs are taken just before the commit: re-read, and the caller is offered alternatives", async () => {
    const { deps, commits } = racingRepo(makeDeps(t, anaScript()), ["chair-1", "chair-2"]);
    const c = new Caller(makePost(deps).POST);
    await c.start();
    await c.say("Un corte mañana a las 19:30, soy Ana, 612345678");
    const r = await c.say("Sí");
    expect(r.body.complete).toBe(false);
    expect(r.body.reply).toMatch(/^¡Vaya, justo se acaba de ocupar! ¿Te viene bien /);
    expect(commits.slice(-2)).toEqual(["booking_overlap", "ok"]);
    expect((await allBookings()).filter((b) => b.customerName === "Ana")).toHaveLength(0);
    expect((await callRow(c.callId)).status).toBe("open");
  });

  it("still conflicting after 2 retries: no booking, the Call ends with a Message for the Owner", async () => {
    const deps = makeDeps(t, anaScript());
    let attempts = 0;
    const repo = {
      ...deps.repo,
      async commit(writes: Parameters<typeof deps.repo.commit>[0]) {
        if (writes.some((w) => w.type === "insertBooking")) {
          attempts++;
          return { ok: false as const, conflict: "booking_overlap" as const };
        }
        return deps.repo.commit(writes);
      },
    };
    const c = new Caller(makePost({ ...deps, repo }).POST);
    await c.start();
    await c.say("Un corte mañana a las 19:30, soy Ana, 612345678");
    const r = await c.say("Sí");
    expect(attempts).toBe(3);
    expect(r.body).toMatchObject({ complete: true, outcome: "message", reply: spoken(ES.slotJustTaken(null, [])) });
    expect(await allBookings()).toHaveLength(0);
    const ms = await allMessages();
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ outcome: "message", callerName: "Ana", callerPhone: "+34612345678", modelFailed: false });
  });
});

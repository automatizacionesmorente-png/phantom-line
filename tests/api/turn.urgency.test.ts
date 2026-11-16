import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import type { ModelClient } from "@/lib/conversation/types";
import { calls, messages } from "@/lib/db/schema";
import { createScriptedModel, throws429 } from "@/lib/receptionist/callModel";
import { Caller, makeDeps, makePost, modelTurn, setupDb } from "./harness";

/**
 * Owner-machine task 9.4: code-decided urgency on every end-of-Call path, through POST /api/turn
 * on PGlite with a scripted model. The model always suggests `low`; the Caller says "es urgente".
 */
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

const URGENT_TERM = { rule: "urgent_term", term: "urgente", lang: "es" };
const messageOf = async (callId: string) => {
  const rows = await t.handle.db.select().from(messages).where(eq(messages.callId, callId));
  expect(rows).toHaveLength(1);
  return rows[0];
};
const expectUrgentFromCaller = async (callId: string, outcome: string) => {
  expect(await messageOf(callId)).toMatchObject({ outcome, urgency: "urgent", urgencySuggested: "low", urgencyBasis: URGENT_TERM });
};

/** Ana's booking for Wednesday 19:30, every Turn suggesting `low`. */
const anaBooking = () => {
  const all = { service: "corte", date: "2026-11-11", time: "19:30", name: "Ana", phone: "612345678", reason: "Quiere un corte", urgency: "low" as const };
  return createScriptedModel([modelTurn({ ...all, reply: "Te lo confirmo." }), modelTurn({ ...all, reply: "¡Genial!", callerConfirmed: true })]);
};
const URGENT_REQUEST = "Es urgente, un corte mañana a las 19:30, soy Ana, 612345678";

describe("a Caller line 'es urgente' with a model that says low stores urgent (basis urgent_term) and the suggestion", () => {
  it("completed: the Call books and ends", async () => {
    const c = new Caller(makePost(makeDeps(t, anaBooking())).POST);
    await c.start();
    await c.say(URGENT_REQUEST);
    const r = await c.say("Sí");
    expect(r.body).toMatchObject({ complete: true, outcome: "booked" });
    await expectUrgentFromCaller(c.callId, "booked");
  });

  it("hang-up", async () => {
    const model = createScriptedModel([modelTurn({ reply: "¿Qué día te viene bien?", service: "corte", reason: "Quiere un corte", urgency: "low" })]);
    const c = new Caller(makePost(makeDeps(t, model)).POST);
    await c.start();
    await c.say("Es urgente, quiero un corte");
    expect((await c.hangup()).body).toMatchObject({ outcome: "abandoned" });
    await expectUrgentFromCaller(c.callId, "abandoned");
  });

  it("fallback: the model fails on the Turn after the urgent line", async () => {
    const first = createScriptedModel([modelTurn({ reply: "¿Qué día te viene bien?", name: "Ana", reason: "Quiere un corte", urgency: "low" })]);
    let n = 0;
    const model: ModelClient = { generate: (req) => (++n === 1 ? first.generate(req) : throws429.generate(req)) };
    const c = new Caller(makePost(makeDeps(t, model)).POST);
    await c.start();
    await c.say("Es urgente, soy Ana");
    expect((await c.say("El viernes")).body).toMatchObject({ outcome: "fallback" });
    await expectUrgentFromCaller(c.callId, "fallback");
  });

  it("fallback on the very Turn of the urgent line: the current line counts, and there is no suggestion", async () => {
    const c = new Caller(makePost(makeDeps(t, throws429)).POST);
    await c.start();
    expect((await c.say("Es urgente, llamadme")).body).toMatchObject({ outcome: "fallback" });
    expect(await messageOf(c.callId)).toMatchObject({ urgency: "urgent", urgencySuggested: null, urgencyBasis: URGENT_TERM });
  });

  it("gave up after booking conflicts: the Owner's call-back Message", async () => {
    const deps = makeDeps(t, anaBooking());
    const repo = {
      ...deps.repo,
      commit: (writes: Parameters<typeof deps.repo.commit>[0]) =>
        writes.some((w) => w.type === "insertBooking") ? Promise.resolve({ ok: false as const, conflict: "booking_overlap" as const }) : deps.repo.commit(writes),
    };
    const c = new Caller(makePost({ ...deps, repo }).POST);
    await c.start();
    await c.say(URGENT_REQUEST);
    expect((await c.say("Sí")).body).toMatchObject({ outcome: "message" });
    await expectUrgentFromCaller(c.callId, "message");
  });

  it("stale sweep: a hang-up that never arrived", async () => {
    const model = createScriptedModel([modelTurn({ reply: "¿Qué día te viene bien?", service: "corte", reason: "Quiere un corte", urgency: "low" })]);
    const c = new Caller(makePost(makeDeps(t, model)).POST);
    await c.start();
    await c.say("Es urgente, quiero un corte");
    await t.handle.db.update(calls).set({ updatedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(calls.id, c.callId));
    // The sweep compares with the deps' clock; use the real one here, as production does.
    const { POST, settle } = makePost({ ...makeDeps(t, createScriptedModel([])), clock: () => Temporal.Now.instant() });
    await new Caller(POST).start();
    await settle();
    expect((await t.handle.db.select().from(calls).where(eq(calls.id, c.callId)))[0].status).toBe("abandoned");
    await expectUrgentFromCaller(c.callId, "abandoned");
  });
});

describe("only the Caller's words count", () => {
  it("a Receptionist line with 'hoy' does not raise: the model's low stays low", async () => {
    // No service yet, so the model's own line is said as it is (decideTurn, booking flow).
    const model = createScriptedModel([modelTurn({ reply: "Claro, ¿qué te quieres hacer hoy?", reason: "Quiere una cita", urgency: "low" })]);
    const c = new Caller(makePost(makeDeps(t, model)).POST);
    await c.start();
    await c.say("Quería pedir cita");
    await c.hangup();
    const [row] = await t.handle.db.select().from(calls).where(eq(calls.id, c.callId));
    expect(row.transcript.some((l) => l.receptionist.includes("hoy"))).toBe(true);
    expect(await messageOf(c.callId)).toMatchObject({ urgency: "low", urgencySuggested: "low", urgencyBasis: { rule: "none" } });
  });

  it("a model that says urgent is never lowered by the rule (5.8)", async () => {
    const model = createScriptedModel([modelTurn({ reply: "¿Qué día te viene bien?", service: "corte", reason: "Quiere un corte", urgency: "urgent" })]);
    const c = new Caller(makePost(makeDeps(t, model)).POST);
    await c.start();
    await c.say("Quería pedir cita para un corte");
    await c.hangup();
    expect(await messageOf(c.callId)).toMatchObject({ urgency: "urgent", urgencySuggested: "urgent", urgencyBasis: { rule: "none" } });
  });
});

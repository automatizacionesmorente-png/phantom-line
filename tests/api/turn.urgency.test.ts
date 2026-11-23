import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import { calls, messages } from "@/lib/db/schema";
import { createScriptedModel, throws429 } from "@/lib/receptionist/callModel";
import { Caller, makeDeps, makePost, modelTurn, setupDb } from "./harness";
import { NOT_SURE_TAIL, notSure } from "../conversation/notSure";

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
  return createScriptedModel([
    modelTurn({ reply: "Vale.", reason: "Quiere un corte", urgency: "low" }),
    modelTurn({ ...all, reply: "Te lo confirmo." }),
    modelTurn({ ...all, reply: "¡Genial!", callerConfirmed: true }),
  ]);
};
/**
 * The urgent line is its own Turn. Since front-desk-brain the Reading decides a Sensitive_Hit on
 * the model path too (13.2), and a Sensitive_Hit never takes the utterance's booking facts
 * (design.md, "As built in task 8"), so "Es urgente, un corte mañana…" in one line no longer books.
 *
 * front-desk-brain 17.5: these cases pin the model's Suggested_Urgency next to the code's urgency, so
 * the model must be asked. Each Caller line the model is scripted for carries the not-sure words
 * (tests/conversation/notSure.ts); alone, "Es urgente…" is a Sensitive_Hit and a Sure_Reading, and
 * the model would never suggest anything.
 */
const URGENT_LINE = notSure("Es urgente, por favor", "es");
const URGENT_REQUEST = `Un corte mañana a las 19:30${NOT_SURE_TAIL.es}, soy Ana, 612345678`;
/** "Sí" to the read-back, still answered by the scripted model. */
const YES = notSure("Sí", "es");
/** The urgent line with a service, answered by the scripted model (or, below, failing it). */
const URGENT_CUT = notSure("Es urgente, quiero un corte", "es");

describe("a Caller line 'es urgente' with a model that says low stores urgent (basis urgent_term) and the suggestion", () => {
  it("completed: the Call books and ends", async () => {
    const c = new Caller(makePost(makeDeps(t, anaBooking())).POST);
    await c.start();
    await c.say(URGENT_LINE);
    await c.say(URGENT_REQUEST);
    const r = await c.say(YES);
    expect(r.body).toMatchObject({ complete: true, outcome: "booked" });
    await expectUrgentFromCaller(c.callId, "booked");
  });

  it("hang-up", async () => {
    const model = createScriptedModel([modelTurn({ reply: "¿Qué día te viene bien?", service: "corte", reason: "Quiere un corte", urgency: "low" })]);
    const c = new Caller(makePost(makeDeps(t, model)).POST);
    await c.start();
    await c.say(URGENT_CUT);
    expect((await c.hangup()).body).toMatchObject({ outcome: "abandoned" });
    await expectUrgentFromCaller(c.callId, "abandoned");
  });

  // Since front-desk-brain a model failure never ends a Call (1.2); the fallback path is reached
  // only by the per-visitor rate limit (1.4), so these two cases run through it.
  it("fallback: the per-visitor limit is hit on the Turn after the urgent line", async () => {
    const model = createScriptedModel([modelTurn({ reply: "¿Qué día te viene bien?", name: "Ana", reason: "Quiere un corte", urgency: "low" })]);
    // start = 1, the urgent line = 2, the next say = 3: over a limit of 2.
    const c = new Caller(makePost(makeDeps(t, model, { perVisitorPerMinute: 2 })).POST);
    await c.start();
    await c.say(`Es urgente${NOT_SURE_TAIL.es}, soy Ana`);
    expect((await c.say("El viernes")).body).toMatchObject({ outcome: "fallback" });
    await expectUrgentFromCaller(c.callId, "fallback");
  });

  it("fallback on the very Turn of the urgent line: the current line counts, and there is no suggestion", async () => {
    const model = createScriptedModel([]);
    const c = new Caller(makePost(makeDeps(t, model, { perVisitorPerMinute: 1 })).POST);
    await c.start();
    expect((await c.say("Es urgente, llamadme")).body).toMatchObject({ outcome: "fallback" });
    expect(model.calls).toHaveLength(0);
    expect(await messageOf(c.callId)).toMatchObject({ urgency: "urgent", urgencySuggested: null, urgencyBasis: URGENT_TERM });
  });

  it("a brain-only Call (the model always fails) with 'es urgente', ended by goodbye: urgent, basis urgent_term", async () => {
    const c = new Caller(makePost(makeDeps(t, throws429)).POST);
    await c.start();
    expect((await c.say(URGENT_CUT)).body.complete).toBe(false);
    // "es urgente" leaves an Owner_Note, so the first goodbye asks for the contact (backlog 20).
    expect((await c.say("Adiós, gracias")).body.complete).toBe(false);
    const bye = await c.say("Adiós, gracias");
    expect(bye.body.complete).toBe(true);
    const m = await messageOf(c.callId);
    expect(m).toMatchObject({ urgency: "urgent", urgencySuggested: null, urgencyBasis: URGENT_TERM, modelFailed: true });
    expect(m.outcome).not.toBe("fallback");
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
    await c.say(URGENT_LINE);
    await c.say(URGENT_REQUEST);
    expect((await c.say(YES)).body).toMatchObject({ outcome: "message" });
    await expectUrgentFromCaller(c.callId, "message");
  });

  it("stale sweep: a hang-up that never arrived", async () => {
    const model = createScriptedModel([modelTurn({ reply: "¿Qué día te viene bien?", service: "corte", reason: "Quiere un corte", urgency: "low" })]);
    const c = new Caller(makePost(makeDeps(t, model)).POST);
    await c.start();
    await c.say(URGENT_CUT);
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
    const model = createScriptedModel([modelTurn({ reply: "Claro, ¿qué te quieres hacer hoy?", name: "Ana", reason: "Quiere una cita", urgency: "low" })]);
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
    await c.say(notSure("Quería pedir cita para un corte", "es"));
    await c.hangup();
    expect(await messageOf(c.callId)).toMatchObject({ urgency: "urgent", urgencySuggested: "urgent", urgencyBasis: { rule: "none" } });
  });
});

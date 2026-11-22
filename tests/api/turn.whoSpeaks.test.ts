import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import type { FallbackLogEvent } from "@/lib/conversation/fallbackLog";
import { bookings } from "@/lib/db/schema";
import { createScriptedModel, hangsThen } from "@/lib/receptionist/callModel";
import { phrases, type Said } from "@/lib/receptionist/phrases";
import { toSpokenReply } from "@/lib/receptionist/speech";
import { getSectorPack } from "@/lib/sectors";
import { Caller, makeDeps, makePost, modelTurn, NOW, setupDb } from "./harness";
import { notSure } from "../conversation/notSure";

/**
 * Regressions for the second round of real calls (2026-11-12, `next dev`, real Gemini, real Neon).
 *
 * Call B, turn 1: "Quiero cortarme el pelo mañana a las nueve de la noche" got a 200 with the
 * model's own words about opening hours ("Lo siento, abrimos de diez de la mañana a dos y de cinco
 * a ocho de la tarde. ¿A qué hora te viene bien?") instead of the code's rejection with 19:30
 * offered. Cause: the model judged 21:00 impossible and returned `time: null`, so `decideTurn`
 * had a service but no time and passed the model's line through. The fakes below return exactly
 * what gemini-3.5-flash-lite returned for that line in scripts/check-turn.ts (only the date is
 * moved to the harness's "mañana", Wednesday 11).
 */
const pack = getSectorPack("hair-salon");
const ES = phrases("es", pack, lolaProfile, undefined, NOW);
/** The phrases of Turn n of a Call: the Variant_Seed is the Call id and the Turn number. */
const turnPhrases = (callId: string, n: number) => phrases("es", pack, lolaProfile, { callId, turn: n }, NOW);
const spoken = (line: Said) => toSpokenReply(line.text, "es", { maxSentences: 3 });
const at = (iso: string) => Temporal.Instant.from(iso);
const WED_2100 = at("2026-11-11T20:00:00Z");
const OFFERED = [at("2026-11-11T18:30:00Z"), at("2026-11-11T18:15:00Z"), at("2026-11-11T18:00:00Z")];
/**
 * front-desk-brain 17.5: the real line alone is a Sure_Reading now and never reaches the model, so
 * every Caller line here carries the not-sure tail. The facts are the same, the scripted model is
 * still asked, and these tests keep pinning what the model path does with the model's real answers.
 */
const LINE = notSure("Quiero cortarme el pelo mañana a las nueve de la noche", "es");

/** The real answer (check-turn, 2026-11-12 12:14 Madrid): date kept, time dropped, hours in the reply. */
const REAL_TIME_NULL = modelTurn({
  reply:
    "Hola, a las nueve de la noche estamos cerrados. Nuestro horario es de diez a dos y de cinco a ocho, de martes a sábado. ¿A qué hora prefieres venir?",
  intent: "booking",
  service: "cortarme el pelo",
  date: "2026-11-11",
  time: null,
  reason: "Quiere cortarse el pelo mañana viernes a las 21:00",
});
/** Call B's reply, with neither date nor time (its raw JSON was not logged, so both cases are pinned). */
const CALL_B_NO_DATE = modelTurn({
  reply: "Lo siento, abrimos de diez de la mañana a dos y de cinco a ocho de la tarde. ¿A qué hora te viene bien?",
  intent: "booking",
  service: "cortarme el pelo",
  date: null,
  time: null,
  reason: "Quiere cortarse el pelo mañana por la noche",
});

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

describe("who speaks: a known service with no time is answered by code, never by the model", () => {
  // front-desk-brain 8.1 amends core-call-loop 5.x (requirements.md, "Amendments"): once the service
  // is known and no time was asked for, the code offers the nearest free slot instead of asking
  // "¿Qué día y a qué hora?". Old assertion: the reply was `askDayAndTime(WED)` / `askDayAndTime(null)`.
  // What these tests still protect: the code speaks, and the model's words about hours never do.
  it("time dropped, date kept: the code offers the first free slot on that day; no opening hours from the model", async () => {
    const c = new Caller(makePost(makeDeps(t, createScriptedModel([REAL_TIME_NULL]))).POST);
    await c.start();
    const r = await c.say(LINE);
    expect(r.status).toBe(200);
    const wed1000 = at("2026-11-11T09:00:00Z");
    expect(r.body.reply).toBe(spoken(ES.firstOffer("haircut", wed1000)));
    expect(r.body.reply).toBe("Un corte son media hora y quince euros. ¿Te viene bien mañana a las diez? Si prefieres otro día, dímelo.");
    expect(r.body.reply).not.toMatch(/cerrad|horario|abrimos/);
    expect(r.body.complete).toBe(false);
    expect(r.body.state.fields.service).toBe("corte");
  });

  it("Call B's shape (no date, no time): the code offers the first free slot from now", async () => {
    const c = new Caller(makePost(makeDeps(t, createScriptedModel([CALL_B_NO_DATE]))).POST);
    await c.start();
    const r = await c.say(LINE);
    // NOW is Tuesday 09:00 Madrid: 30 minutes later, the first slot is today at 10:00.
    expect(r.body.reply).toBe(spoken(turnPhrases(c.callId, 1).firstOffer("haircut", at("2026-11-10T09:00:00Z"))));
    expect(r.body.reply).not.toContain("abrimos");
  });

  it("the Call recovers: the time said again is rejected by code with 19:30 offered, and 19:30 is taken", async () => {
    const model = createScriptedModel([
      REAL_TIME_NULL,
      modelTurn({ service: "cortarme el pelo", date: "2026-11-11", time: "21:00", reply: "Lo siento, cerramos a las ocho." }),
      modelTurn({ service: "cortarme el pelo", date: null, time: "19:30", reply: "Perfecto. ¿A nombre de quién?" }),
    ]);
    const c = new Caller(makePost(makeDeps(t, model)).POST);
    await c.start();
    await c.say(LINE);
    const r2 = await c.say(notSure("A las nueve de la noche", "es"));
    expect(r2.body.reply).toBe(spoken(turnPhrases(c.callId, 2).rejected("outside_hours", WED_2100, OFFERED)));
    expect(r2.body.reply).not.toContain("cerramos a las ocho");
    const r3 = await c.say(notSure("Vale, a las siete y media", "es"));
    // The time is accepted, so the code asks for the name; the model's "Perfecto. ¿A nombre de quién?" is not spoken.
    expect(r3.body.reply).toBe(spoken(turnPhrases(c.callId, 3).timeAcceptedAskName(OFFERED[0])));
    expect(r3.body.reply).not.toBe("Perfecto. ¿A nombre de quién?");
    expect(r3.body.state.fields.requestedTime).toBe("2026-11-11T19:30");
    expect(model.calls).toHaveLength(3);
  });
});

describe("a hung model attempt (bugfix 2026-11-12, Call A and Call B turn 2)", () => {
  it("first attempt hangs: the caller still hears the code's 21:00 rejection, nothing is logged as a fallback", async () => {
    const real = modelTurn({ service: "cortarme el pelo", date: "2026-11-11", time: "21:00", reply: "Lo siento." });
    const model = hangsThen(1, createScriptedModel([real]));
    const events: FallbackLogEvent[] = [];
    const deps = { ...makeDeps(t, model), logFallback: (e: FallbackLogEvent) => events.push(e) };
    const c = new Caller(makePost(deps).POST);
    await c.start();
    const r = await c.say(LINE);
    expect(r.body.reply).toBe(spoken(ES.rejected("outside_hours", WED_2100, OFFERED)));
    expect(r.body.complete).toBe(false);
    expect(model.calls).toBe(2);
    expect(events).toEqual([]);
    expect(await t.handle.db.select().from(bookings)).toHaveLength(0);
  }, 10_000);
});

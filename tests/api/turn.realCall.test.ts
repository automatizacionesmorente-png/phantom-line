import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import { bookings, messages } from "@/lib/db/schema";
import { createScriptedModel } from "@/lib/receptionist/callModel";
import { phrases, type Said } from "@/lib/receptionist/phrases";
import { toSpokenReply } from "@/lib/receptionist/speech";
import { getSectorPack } from "@/lib/sectors";
import { Caller, makeDeps, makePost, modelTurn, setupDb } from "./harness";

/**
 * The owner's real voice call of 2026-11-13 (Chrome, before natural-voice landed), replayed through
 * the real route with a fake model that returns what a model plausibly returns for each line. Every
 * line of the call must now behave as the owner asked:
 *
 *   greeting          the honest, warm one, naming the virtual assistant
 *   "las 4:00"        "Mañana a las cuatro estamos cerrados, abrimos a las cinco. ¿Te viene bien a las cinco?…"
 *   "a las cinco no a las 17 Pánfilo"   a spoken time, no "te anoto" before the read-back, the insult never repeated
 *   "pintar el pelo de rosa"            the colour service, with its length and price, the time re-checked
 *   "Mi amor" as the name               one friendly re-ask, then accepted
 *
 * and no digit anywhere in what is spoken or shown.
 */
const pack = getSectorPack("hair-salon");
const at = (iso: string) => Temporal.Instant.from(iso);
/** Friday 13 November 2026, 11:00 in Madrid. "Mañana" is Saturday 14. */
const FRIDAY = at("2026-11-13T10:00:00Z");
const SAT_1700 = at("2026-11-14T16:00:00Z");
const SAT = "2026-11-14";

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

const P = (callId: string, turn: number) => phrases("es", pack, lolaProfile, { callId, turn }, FRIDAY);
const spoken = (line: Said) => toSpokenReply(line.text, "es", { maxSentences: 3 });
const deps = (model: ReturnType<typeof createScriptedModel>) => ({ ...makeDeps(t, model), clock: () => FRIDAY });

/** What the model returns for each line: the fields it heard, in the caller's own words. */
const heard = { intent: "booking" as const, service: "cortarme el pelo", date: SAT, reason: "Quiere una cita" };

describe("the owner's real call of 2026-11-13, replayed", () => {
  it("every line behaves as the owner asked, and no digit is spoken or shown", async () => {
    const model = createScriptedModel([
      // "Quiero ir mañana sábado a las 4:00 de la tarde" (the recognizer writes digits)
      modelTurn({ ...heard, time: "16:00", reply: "Vale, mañana sábado a las 16:00." }),
      // "Vale quiero ir a las cinco no a las 17 Pánfilo": the insult is not a name, so name stays null
      modelTurn({ ...heard, time: "17:00", reply: "Perfecto, te anoto a las 17:00. ¿Cuál es tu nombre?" }),
      // "Vale pero antes me puedo pintar el pelo de rosa"
      modelTurn({
        ...heard,
        service: "pintar el pelo de rosa",
        time: "17:00",
        reason: "Quiere pintarse el pelo de rosa",
        reply: "Lo de pintar el pelo de rosa se lo dejo apuntado a Lola para que te llame.",
      }),
      // "Mi amor" as the name
      modelTurn({ ...heard, service: "pintar el pelo de rosa", time: "17:00", name: "Mi amor", reason: "Quiere pintarse el pelo de rosa", reply: "Encantada, Mi amor." }),
      // the caller insists
      modelTurn({ ...heard, service: "pintar el pelo de rosa", time: "17:00", name: "Mi amor", reason: "Quiere pintarse el pelo de rosa", reply: "Vale." }),
      // the phone
      modelTurn({ ...heard, service: "pintar el pelo de rosa", time: "17:00", name: "Mi amor", phone: "612 34 56 78", reason: "Quiere pintarse el pelo de rosa", reply: "Gracias." }),
      // "sí"
      modelTurn({
        ...heard, service: "pintar el pelo de rosa", time: "17:00", name: "Mi amor", phone: "612 34 56 78",
        reason: "Quiere pintarse el pelo de rosa", callerConfirmed: true, reply: "¡Genial!",
      }),
    ]);
    const { POST, settle } = makePost(deps(model));
    const caller = new Caller(POST, "es");
    const said: string[] = [];

    // The greeting: honest and warm.
    const hello = await caller.start();
    said.push(hello.body.reply);
    expect(hello.body.reply).toBe(P(caller.callId, 0).greeting().text);
    expect(hello.body.reply).toMatch(/asistente virtual/);
    expect(hello.body.reply).not.toMatch(/contestador|no pueden atenderte/i);

    // "las 4:00": no digits, when they open, the nearest times first.
    const r1 = await caller.say("Quiero ir mañana sábado a las 4:00 de la tarde");
    said.push(r1.body.reply);
    expect(r1.body.reply).toBe(
      "Mañana a las cuatro estamos cerrados, abrimos a las cinco. ¿Te viene bien a las cinco? También tengo a las cinco y cuarto o a las cinco y media.",
    );
    expect(r1.body.complete).toBe(false);

    // "a las cinco no a las 17 Pánfilo": a spoken time, no "te anoto" yet, the insult never repeated.
    const r2 = await caller.say("Vale quiero ir a las cinco no a las 17 Pánfilo");
    said.push(r2.body.reply);
    expect(r2.body.reply).toBe(spoken(P(caller.callId, 2).timeAcceptedAskName(SAT_1700)));
    expect(r2.body.reply).toMatch(/mañana a las cinco/);
    expect(r2.body.reply).not.toMatch(/anoto|apunto|Pánfilo|te anot/i);
    expect(r2.body.state.fields.requestedTime).toBe(`${SAT}T17:00`);

    // The colour: yes, with length and price, and the longer service re-checked (17:00 + 90 min fits before 20:00).
    const r3 = await caller.say("Vale pero antes me puedo pintar el pelo de rosa");
    said.push(r3.body.reply);
    expect(r3.body.reply).toBe(
      `Claro, un tinte dura una hora y media y cuesta cuarenta y cinco euros. ${spoken(P(caller.callId, 3).timeAcceptedAskName(SAT_1700))}`,
    );
    expect(r3.body.reply).not.toMatch(/se lo dejo apuntado/);
    expect(r3.body.state.fields.service).toBe("tinte");
    expect(r3.body.complete).toBe(false);

    // "Mi amor": one friendly re-ask, and the endearment is not repeated back.
    const r4 = await caller.say("Mi amor");
    said.push(r4.body.reply);
    expect(r4.body.reply).toBe(spoken(P(caller.callId, 4).askNameAgain()));
    expect(r4.body.reply).not.toMatch(/amor/i);
    expect(r4.body.state.fields.name).toBeNull();

    // They insist: accepted, and the phone is next.
    const r5 = await caller.say("Que sí, que es Mi amor");
    said.push(r5.body.reply);
    expect(r5.body.reply).toBe(spoken(P(caller.callId, 5).askPhone()));
    expect(r5.body.state.fields.name).toBe("Mi amor");

    const r6 = await caller.say("seis uno dos, tres cuatro, cinco seis, siete ocho");
    said.push(r6.body.reply);
    expect(r6.body.reply).toBe(spoken(P(caller.callId, 6).readBack("colour", SAT_1700, "Mi amor", "+34612345678")));
    expect(r6.body.reply).toMatch(/^Te apunto un tinte mañana sábado a las cinco/);
    expect(r6.body.cacheable).toBe(false);

    const r7 = await caller.say("Sí");
    said.push(r7.body.reply);
    expect(r7.body.reply).toBe(spoken(P(caller.callId, 7).booked("colour", SAT_1700)));
    expect(r7.body.outcome).toBe("booked");

    // Not one digit in anything the caller heard or read.
    for (const line of said) expect(line, line).not.toMatch(/\d/);
    // The model's own words were never spoken.
    expect(said.join(" ")).not.toMatch(/te anoto|se lo dejo apuntado a Lola para que|Encantada/);

    // Lola gets the colour booking, 90 minutes at five, and the shade in the Message, without a promise.
    const rows = await t.handle.db.select().from(bookings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serviceId: "colour", customerName: "Mi amor", customerPhone: "+34612345678" });
    expect(rows[0].startsAt.toISOString()).toBe("2026-11-14T16:00:00.000Z");
    expect(rows[0].endsAt.toISOString()).toBe("2026-11-14T17:30:00.000Z");
    const [m] = await t.handle.db.select().from(messages);
    expect(m.reason).toBe("Quiere pintarse el pelo de rosa");
    expect(m.agreed).toContain("tinte");
    expect(m.suggestedReply).not.toMatch(/rosa/i); // nothing promises the result
    await settle();
  });

  it("an insult given as the name is not repeated: the caller is asked for their name once more", async () => {
    const model = createScriptedModel([
      modelTurn({ ...heard, time: "17:00", name: "Pánfilo", reply: "Encantada, Pánfilo." }),
    ]);
    const caller = new Caller(makePost(deps(model)).POST, "es");
    await caller.start();
    const r = await caller.say("Mañana a las cinco, soy Pánfilo");
    expect(r.body.reply).toBe(spoken(P(caller.callId, 1).askNameAgain()));
    expect(r.body.reply).not.toMatch(/Pánfilo|Encantada/);
    expect(r.body.state.fields.name).toBeNull();
  });

  it("a longer service that does not fit is rejected by code: 19:00 + 90 minutes ends after the 20:00 close", async () => {
    const model = createScriptedModel([
      modelTurn({ ...heard, service: "tinte", time: "19:00", reason: "Quiere un tinte" }),
    ]);
    const caller = new Caller(makePost(deps(model)).POST, "es");
    await caller.start();
    const r = await caller.say("Un tinte mañana a las siete");
    expect(r.body.reply).toBe(
      "Mañana a las siete no nos da tiempo antes de cerrar. ¿Te viene bien a las seis y media? También tengo a las seis y cuarto o a las seis.",
    );
  });
});

describe("the same call in English", () => {
  it("greets as the salon's virtual assistant, speaks the times in words and re-asks a non-name once", async () => {
    const model = createScriptedModel([
      modelTurn({ language: "en", intent: "booking", service: "dye my hair pink", date: SAT, time: "16:00", reason: "Wants a pink colour", reply: "OK." }),
      modelTurn({ language: "en", intent: "booking", service: "dye my hair pink", date: SAT, time: "17:00", name: "darling", reason: "Wants a pink colour", reply: "Lovely." }),
    ]);
    const caller = new Caller(makePost(deps(model)).POST, "en");
    const hello = await caller.start();
    expect(hello.body.reply).toMatch(/virtual assistant/);
    expect(hello.body.reply).not.toMatch(/answering machine/i);

    const r1 = await caller.say("A pink colour tomorrow at four in the afternoon");
    expect(r1.body.reply).toBe(
      "Tomorrow at four we're closed, we open at five. Does five work for you? I also have quarter past five or half past five.",
    );
    const r2 = await caller.say("Five, then. Darling.");
    const askAgain = phrases("en", pack, lolaProfile, { callId: caller.callId, turn: 2 }, FRIDAY).askNameAgain();
    expect(r2.body.reply).toBe(toSpokenReply(askAgain.text, "en", { maxSentences: 3 }));
    expect(r2.body.reply).not.toMatch(/\d|darling/i);
    expect(r2.body.state.fields.name).toBeNull();
  });
});

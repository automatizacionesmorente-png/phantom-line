import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import { bookings, calls, messages } from "@/lib/db/schema";
import { createScriptedModel } from "@/lib/receptionist/callModel";
import { phrases, type Said } from "@/lib/receptionist/phrases";
import { toSpokenReply } from "@/lib/receptionist/speech";
import { getSectorPack, type Lang } from "@/lib/sectors";
import { Caller, makeDeps, makePost, modelTurn, NOW, setupDb } from "./harness";
import { notSure } from "../conversation/notSure";

/**
 * Task 8.4: a full booking Call through POST /api/turn with a real Request,
 * PGlite and a scripted model, in Spanish and in English (Requirements 8.1,
 * 4.8, 4.13, 4.15, 6.1, 6.2). Every line about times and bookings must be the
 * code's template, never the model's words.
 *
 * front-desk-brain 17.5: every Caller line carries the not-sure tail, so each Turn still goes
 * through the scripted model (a Sure_Reading would skip it); the brain-only booking is
 * tests/conversation/b12-offer.property.test.ts and the Real_Call regression.
 */
const pack = getSectorPack("hair-salon");
const at = (iso: string) => Temporal.Instant.from(iso);
const WED_2100 = at("2026-11-11T20:00:00Z");
const WED_1930 = at("2026-11-11T18:30:00Z");
const OFFERED = [WED_1930, at("2026-11-11T18:15:00Z"), at("2026-11-11T18:00:00Z")];

interface Script {
  lang: Lang;
  lines: { ask: string; name: string; phone: string; vale: string; yes: string };
  model: { reason: string; askName: string; askPhone: string };
  name: string;
}

const scripts: Script[] = [
  {
    lang: "es",
    lines: {
      ask: notSure("Quiero cortarme el pelo mañana a las nueve de la noche", "es"),
      vale: notSure("Vale, a las siete y media", "es"),
      name: notSure("Ana García", "es"),
      phone: notSure("seis uno dos, tres cuatro cinco, seis siete ocho", "es"),
      yes: notSure("Sí", "es"),
    },
    model: { reason: "Quiere una cita de corte", askName: "Perfecto. ¿A nombre de quién?", askPhone: "Gracias, Ana. ¿Y tu teléfono?" },
    name: "Ana García",
  },
  {
    lang: "en",
    lines: {
      ask: notSure("I'd like a haircut tomorrow at nine in the evening", "en"),
      vale: notSure("OK, half past seven then", "en"),
      name: notSure("John Smith", "en"),
      phone: notSure("six one two, three four five, six seven eight", "en"),
      yes: notSure("Yes please", "en"),
    },
    model: { reason: "Wants a haircut appointment", askName: "Great. What name is it under?", askPhone: "Thanks, John. And your phone number?" },
    name: "John Smith",
  },
];

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

describe.each(scripts)("a full scripted booking Call in $lang", (sc) => {
  it("greets, rejects 21:00 with 19:30 offered, books 19:30 on a chair and leaves a complete Message", async () => {
    const heard = { language: sc.lang, intent: "booking" as const, reason: sc.model.reason, service: sc.lang === "es" ? "cortarme el pelo" : "haircut" };
    const model = createScriptedModel([
      // 1. "tomorrow at 9 pm": the model resolves "tomorrow" from TODAY in the prompt.
      modelTurn({ ...heard, reply: "Mira, te lo apunto.", date: "2026-11-11", time: "21:00" }),
      // 2. "OK, half past seven": only the time; the date comes from the offer the code made.
      modelTurn({ ...heard, reply: sc.model.askName, date: "2026-11-11", time: "19:30" }),
      // 3. the name
      modelTurn({ ...heard, reply: sc.model.askPhone, date: "2026-11-11", time: "19:30", name: sc.name }),
      // 4. the phone, as digits the model heard
      modelTurn({ ...heard, reply: "Te lo confirmo ya mismo.", date: "2026-11-11", time: "19:30", name: sc.name, phone: "612 345 678" }),
      // 5. "yes" to the read-back
      modelTurn({ ...heard, reply: "¡Genial!", date: "2026-11-11", time: "19:30", name: sc.name, phone: "612 345 678", callerConfirmed: true }),
    ]);
    const { POST, settle } = makePost(makeDeps(t, model));
    const caller = new Caller(POST, sc.lang);
    /** The phrases of Turn n of this Call: the Variant_Seed is the Call id and the Turn number. */
    const P = (n: number) => phrases(sc.lang, pack, lolaProfile, { callId: caller.callId, turn: n }, NOW);
    const spokenTemplate = (line: Said) => toSpokenReply(line.text, sc.lang, { maxSentences: 3 });

    const hello = await caller.start();
    expect(hello.status).toBe(200);
    expect(hello.body.reply).toBe(P(0).greeting().text);
    expect(hello.body.reply).toContain("Peluquería Lola");
    expect(hello.body.reply).toContain(sc.lang === "es" ? "asistente virtual" : "virtual assistant");
    expect(hello.body.cacheable).toBe(true);
    expect(hello.body.complete).toBe(false);
    expect(model.calls).toHaveLength(0); // the greeting is a template

    const r1 = await caller.say(sc.lines.ask);
    expect(r1.status).toBe(200);
    expect(r1.body.reply).toBe(spokenTemplate(P(1).rejected("outside_hours", WED_2100, OFFERED)));
    expect(r1.body.reply).toContain(sc.lang === "es" ? "las siete y media" : "half past seven");
    expect(r1.body.reply).not.toMatch(/\d/);
    expect(r1.body.cacheable).toBe(true);
    expect(r1.body.complete).toBe(false);

    // The time was accepted, so the code asks for the name; the model's own line is not spoken.
    const r2 = await caller.say(sc.lines.vale);
    expect(r2.body.reply).toBe(spokenTemplate(P(2).timeAcceptedAskName(WED_1930)));
    expect(r2.body.reply).not.toBe(sc.model.askName);
    expect(r2.body.reply).not.toMatch(/\d/);
    expect(r2.body.state.fields.requestedTime).toBe("2026-11-11T19:30");

    const r3 = await caller.say(sc.lines.name);
    expect(r3.body.reply).toBe(spokenTemplate(P(3).askPhone()));
    expect(r3.body.reply).not.toBe(sc.model.askPhone);
    expect(r3.body.state.fields.name).toBe(sc.name);

    const r4 = await caller.say(sc.lines.phone);
    // The read-back is the code's template with day, time, service, name and phone (4.13), not the model's line.
    expect(r4.body.reply).toBe(spokenTemplate(P(4).readBack("haircut", WED_1930, sc.name, "+34612345678")));
    expect(r4.body.reply).not.toMatch(/\d/);
    expect(r4.body.cacheable).toBe(false); // it holds a name and a phone
    expect(r4.body.state.fields.phone).toBe("+34612345678");
    expect(r4.body.complete).toBe(false);

    const r5 = await caller.say(sc.lines.yes);
    expect(r5.status).toBe(200);
    expect(r5.body.reply).toBe(spokenTemplate(P(5).booked("haircut", WED_1930)));
    expect(r5.body.reply).toContain("Lola"); // what happens next (4.15)
    expect(r5.body.cacheable).toBe(true);
    expect(r5.body.complete).toBe(true);
    expect(r5.body.state.complete).toBe(true);
    expect(r5.body.outcome).toBe("booked");
    expect(r5.body.state.intent).toBe("booking");
    expect(r5.body.language).toBe(sc.lang);
    expect(model.calls).toHaveLength(5);
    // The prompt was in the Call's language and carried the transcript as data.
    expect(model.calls[4].input).toContain(sc.lines.yes);

    // One confirmed booking on a chair.
    const rows = await t.handle.db.select().from(bookings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "confirmed",
      resourceId: "chair-1",
      serviceId: "haircut",
      customerName: sc.name,
      customerPhone: "+34612345678",
      channel: "voice",
      callId: caller.callId,
    });
    expect(rows[0].startsAt.toISOString()).toBe("2026-11-11T18:30:00.000Z");
    expect(rows[0].endsAt.toISOString()).toBe("2026-11-11T19:00:00.000Z");

    // One Message with every field filled.
    const ms = await t.handle.db.select().from(messages);
    expect(ms).toHaveLength(1);
    const m = ms[0];
    expect(m).toMatchObject({
      callId: caller.callId,
      callerName: sc.name,
      callerPhone: "+34612345678",
      reason: sc.model.reason,
      urgency: "normal",
      outcome: "booked",
      modelFailed: false,
      bookingId: rows[0].id,
      channel: "voice",
    });
    for (const k of ["callerName", "callerPhone", "reason", "urgency", "agreed", "suggestedReply"] as const) {
      expect(m[k], k).toBeTruthy();
    }
    // Owner-facing text is in the shop's first language (Spanish for Lola).
    expect(m.agreed).toContain("19:30");
    expect(m.suggestedReply).toContain(sc.name);

    // The Call is closed, with the transcript the server handled.
    const [c] = await t.handle.db.select().from(calls).where(eq(calls.id, caller.callId));
    expect(c.status).toBe("completed");
    expect(c.language).toBe(sc.lang);
    expect(c.transcript).toHaveLength(6);
    expect(c.turnCount).toBe(5);

    await settle(); // the after() sweep runs without error
  });
});

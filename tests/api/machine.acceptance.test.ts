import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lightAnnouncement, lightState } from "@/lib/messages/tape";
import type { AgendaItem, PollChanged } from "@/lib/owner/api";
import { createScriptedModel } from "@/lib/receptionist/callModel";
import { Caller, makeDeps, makePost, modelTurn, NOW, setupDb } from "./harness";
import { DEMO, PIN_SET_AT, CLOCK0, client, createMachineEnv, tokenFor } from "./machineHarness";
import type { TestDb } from "../db/pglite";
import { ownerRepoOf } from "../db/ownerFixtures";
import { hashPin } from "@/lib/owner/pin";

/**
 * Owner-machine task 10.9, the demo acceptance, scripted: a full Spanish booking Call through
 * `makeTurnHandler` with a scripted model, then the Poll handler with the previous version answers
 * `changed: true` with the Message first on the Tape, not yet heard (the light blinks), and the
 * Booking in the Agenda on its day (12.5). The real 5-second timing is checked by hand (task 12).
 *
 * Clock: Tuesday 10 November 2026, 09:00 in Madrid, the same as the Turn_API harness.
 */

let t: TestDb;
beforeAll(async () => {
  t = await setupDb();
  await ownerRepoOf(t).setOwnerPin(DEMO, await hashPin("246810"), PIN_SET_AT);
}, 120_000);
afterAll(async () => {
  await t.close();
});

describe("the demo acceptance: a Call books, and the machine shows it on its next Poll", () => {
  it("leaves the Message first on the Tape, unheard, and the Booking in the Agenda", async () => {
    expect(CLOCK0.toString()).toBe(NOW.toString());
    const machine = createMachineEnv(t); // its clock, CLOCK0, is the Turn_API harness's NOW
    const owner = client(machine.handlers);
    const open = { token: tokenFor(DEMO) };

    // The machine is open and has the Demo_Shop's samples; the Owner erases them to see a clean Tape.
    const opening = (await owner.poll(DEMO, null, open)).json as unknown as PollChanged;
    for (const m of opening.tape) await owner.message(DEMO, m.id, { action: "erase" }, open);
    const before = (await owner.poll(DEMO, null, open)).json as unknown as PollChanged;
    expect(before.counts).toEqual({ new: 0, unheard: 0 });
    expect(lightState(before.counts)).toBe("off");
    const quiet = await owner.poll(DEMO, before.version, open);
    expect(quiet.json).toEqual({ changed: false, version: before.version, counts: { new: 0, unheard: 0 } });

    // A Caller phones Peluquería Lola and books a haircut for tomorrow at 19:30.
    const all = { service: "corte", date: "2026-11-11", time: "19:30", name: "Ana García", phone: "612345678", reason: "Quiere un corte", urgency: "normal" as const };
    const model = createScriptedModel([modelTurn({ ...all, reply: "Te lo confirmo." }), modelTurn({ ...all, reply: "¡Genial!", callerConfirmed: true })]);
    const caller = new Caller(makePost(makeDeps(t, model)).POST);
    await caller.start();
    await caller.say("Quiero un corte mañana a las 19:30, soy Ana García, mi teléfono es 612345678");
    const done = await caller.say("Sí, perfecto");
    expect(done.body).toMatchObject({ complete: true, outcome: "booked" });

    // The machine's next Poll, with the version it already had.
    const after = await owner.poll(DEMO, before.version, open);
    expect(after.status).toBe(200);
    const poll = after.json as unknown as PollChanged;
    expect(poll.changed).toBe(true);
    expect(poll.version).toBeGreaterThan(before.version);

    expect(poll.counts).toEqual({ new: 1, unheard: 1 });
    expect(lightState(poll.counts)).toBe("blinking");
    expect(lightAnnouncement(poll.counts, "es")).toBe("1 mensaje nuevo, 1 sin escuchar");

    expect(poll.tape).toHaveLength(1);
    expect(poll.tape[0]).toMatchObject({
      heard: false,
      callerName: "Ana García",
      outcome: "booked",
      channel: "voice",
      sample: null,
      replyLang: "es",
    });
    expect(poll.tape[0].agreed).toHaveProperty("byLang");
    // No Transcript on the Tape: playing it back fetches it (14.2).
    expect(JSON.stringify(poll)).not.toContain("Quiero un corte mañana");

    const day = poll.agenda.find((d) => d.date === "2026-11-11");
    expect(day?.items).toHaveLength(1);
    const booking = day!.items[0] as AgendaItem;
    expect(booking).toMatchObject({
      serviceId: "haircut",
      customerName: "Ana García",
      start: "2026-11-11T18:30:00Z",
      status: "booked",
      channel: "voice",
      actions: ["confirm", "move", "cancel"],
    });
    expect(poll.agenda.flatMap((d) => d.items)).toHaveLength(1);

    // Playing the Message back returns what the Caller said, and the light goes steady.
    const play = await owner.message(DEMO, poll.tape[0].id, { action: "play" }, open);
    expect(play.json).toMatchObject({ lang: "es", transcript: expect.arrayContaining([expect.objectContaining({ caller: "Sí, perfecto" })]) });
    const heard = (await owner.poll(DEMO, poll.version, open)).json as unknown as PollChanged;
    expect(heard.counts).toEqual({ new: 1, unheard: 0 });
    expect(lightState(heard.counts)).toBe("steady");
  });
});

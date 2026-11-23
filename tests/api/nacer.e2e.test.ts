import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { makeCreateHandler } from "@/app/api/nacer/create/handler";
import { bookings, messages, shops } from "@/lib/db/schema";
import { createTrialStore, createWizardLimiter } from "@/lib/db/trialRepository";
import type { Line, TurnOutput } from "@/lib/conversation/types";
import { createScriptedModel } from "@/lib/receptionist/callModel";
import { makeDeps, makePost, modelTurn, NOW, request } from "./harness";
import { notSure } from "../conversation/notSure";
import { createTestDb, type TestDb } from "../db/pglite";
import { createBody } from "../rebirth/fixtures";

/**
 * A shop created by the wizard is a real shop: it takes a booking through the same turn pipeline
 * as Peluquería Lola (BACKLOG 16). Tuesday 10 Nov 2026 09:00 in Madrid; the wizard shop is open
 * Monday to Friday 10-14 and 17-20 with two chairs.
 */
let t: TestDb;
let shopId: string;
beforeAll(async () => {
  t = await createTestDb();
  const create = makeCreateHandler({
    store: () => createTrialStore(t.handle),
    limiter: () => createWizardLimiter(t.handle),
    clock: () => NOW,
    salt: () => "salt-1234",
  });
  const res = await create(
    new Request("http://x/api/nacer/create", { method: "POST", headers: { "x-forwarded-for": "1.1.1.1" }, body: JSON.stringify(createBody()) }),
  );
  expect(res.status).toBe(201);
  shopId = (await res.json()).shopId;
  // The harness clock is in the past (10 Nov); the database's own clock decides when a trial expires.
  await t.handle.db.update(shops).set({ expiresAt: new Date("2099-01-01T00:00:00Z") });
}, 60_000);
afterAll(async () => t?.close());

/** A caller of the wizard's shop: the same requests the browser sends. */
function callerOf(POST: (r: Request) => Promise<Response>) {
  let callId = "";
  let conversation: Line[] = [];
  return {
    async start() {
      const res = await POST(request({ kind: "start", shopId, language: "es" }));
      const body = (await res.json()) as TurnOutput;
      callId = body.callId;
      conversation = [{ caller: "", receptionist: body.reply }];
      return { status: res.status, body };
    },
    async say(utterance: string) {
      const res = await POST(request({ kind: "say", shopId, language: "es", callId, utterance, conversation: conversation.slice(-20) }));
      const body = (await res.json()) as TurnOutput;
      conversation.push({ caller: utterance, receptionist: body.reply });
      return { status: res.status, body };
    },
  };
}

describe("a shop made by the wizard takes a booking", () => {
  it("greets with its own name, books a 30-minute men's cut on a chair of its own, and leaves a message for the owner", async () => {
    const heard = { language: "es" as const, intent: "booking" as const, reason: "Quiere un corte", service: "corte de hombre" };
    const when = { date: "2026-11-11", time: "19:30" };
    const model = createScriptedModel([
      modelTurn({ ...heard, reply: "Vale.", ...when }),
      modelTurn({ ...heard, reply: "Vale.", ...when, name: "Ana García" }),
      modelTurn({ ...heard, reply: "Vale.", ...when, name: "Ana García", phone: "612 345 678" }),
      modelTurn({ ...heard, reply: "Vale.", ...when, name: "Ana García", phone: "612 345 678", callerConfirmed: true }),
    ]);
    const { POST, settle } = makePost(makeDeps(t, model));
    const caller = callerOf(POST);

    const hello = await caller.start();
    expect(hello.status).toBe(200);
    expect(hello.body.reply).toContain("Barbería Paco");

    const r1 = await caller.say(notSure("Quiero un corte de hombre mañana a las siete y media de la tarde", "es"));
    expect(r1.status).toBe(200);
    const r2 = await caller.say(notSure("Ana García", "es"));
    expect(r2.status).toBe(200);
    const r3 = await caller.say(notSure("seis uno dos, tres cuatro cinco, seis siete ocho", "es"));
    expect(r3.status).toBe(200);
    expect(r3.body.reply).toMatch(/Ana/);
    const r4 = await caller.say(notSure("Sí", "es"));
    expect(r4.status).toBe(200);
    expect(r4.body.outcome).toBe("booked");
    await settle();

    const rows = await t.handle.db.select().from(bookings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ shopId, serviceId: "corte-de-hombre", status: "confirmed", customerName: "Ana García", customerPhone: "+34612345678" });
    expect(["sillon-1", "sillon-2"]).toContain(rows[0].resourceId);
    expect(rows[0].startsAt.toISOString()).toBe(Temporal.Instant.from("2026-11-11T18:30:00Z").toString().replace("Z", ".000Z"));
    expect(rows[0].endsAt.getTime() - rows[0].startsAt.getTime()).toBe(30 * 60_000);

    const ms = await t.handle.db.select().from(messages);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ shopId, callerName: "Ana García", outcome: "booked", bookingId: rows[0].id });
  });

  it("refuses a time when the wizard shop is closed (Sunday)", async () => {
    const model = createScriptedModel([modelTurn({ language: "es", intent: "booking", service: "corte de hombre", date: "2026-11-15", time: "11:00" })]);
    const { POST } = makePost(makeDeps(t, model));
    const caller = callerOf(POST);
    await caller.start();
    const r = await caller.say(notSure("Quiero un corte de hombre el domingo a las once", "es"));
    expect(r.status).toBe(200);
    expect(r.body.outcome).not.toBe("booked");
    expect(await t.handle.db.select().from(bookings)).toHaveLength(1); // still only the first test's
  });
});

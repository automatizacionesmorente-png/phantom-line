import { describe, expect, it } from "vitest";
import type { ModelClient, Repository } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import { createScriptedModel } from "@/lib/receptionist/callModel";
import { SAT_1930 } from "./brainCall";
import { CoreCaller, coreHarness, modelTurn, switchModel } from "./coreCall";
import { notSure } from "./notSure";

/**
 * Task 9.2: `handleTurn.say` steps 1–6 of design.md ("handleTurn") that the properties do not pin
 * on their own: the bookings read beside the model call (2.7), its reuse, the global limit (1.5),
 * and what a brain Turn records (1.6).
 */
const shop = lolaSeedProfile;

/** Records the order of `listBookings` calls and model calls, and when each model call is answered. */
function traced(repo: Repository, model: ModelClient, events: string[]): { repo: Repository; model: ModelClient } {
  return {
    repo: {
      ...repo,
      listBookings: (...args) => {
        events.push("listBookings");
        return repo.listBookings(...args);
      },
    },
    model: {
      generate: async (req) => {
        events.push("model:start");
        // Let every pending promise callback run first, as a real network call would.
        await new Promise((r) => setImmediate(r));
        const text = await model.generate(req);
        events.push("model:end");
        return text;
      },
    },
  };
}

describe("handleTurn and the brain path", () => {
  it("with the services already known, the bookings read starts before the model answers, and is not repeated (2.7)", async () => {
    const events: string[] = [];
    const h = coreHarness({ shops: [shop], now: SAT_1930, model: switchModel({ kind: "503" }) });
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start();
    await c.say("quería un corte de mujer"); // the brain path: services known, a First_Offer
    events.length = 0;
    const scripted = createScriptedModel([modelTurn({ intent: "booking", reply: "Vale.", service: null })]);
    const t = traced(h.deps.repo, scripted, events);
    Object.assign(h.deps, { repo: t.repo, model: t.model });
    await c.say("Oye, ¿y Lola es simpática?");
    expect(events).toEqual(["listBookings", "model:start", "model:end"]);
  });

  it("a model whose facts change the times involved gets a fresh read for them", async () => {
    const events: string[] = [];
    const h = coreHarness({ shops: [shop], now: SAT_1930, model: switchModel({ kind: "503" }) });
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start();
    await c.say("quería un corte de mujer");
    events.length = 0;
    const scripted = createScriptedModel([modelTurn({ intent: "booking", reply: "Vale.", date: "2026-11-18", time: "11:00" })]);
    const t = traced(h.deps.repo, scripted, events);
    Object.assign(h.deps, { repo: t.repo, model: t.model });
    await c.say("Oye, ¿y Lola es simpática?");
    expect(events).toEqual(["listBookings", "model:start", "model:end", "listBookings"]);
    expect(h.repo.calls()[0].state.fields.requested).toEqual({ date: "2026-11-18", time: "11:00" });
  });

  it("the global hourly limit skips the model; the brain answers, nothing is logged, modelFailed stays false (1.5)", async () => {
    const model = switchModel({ kind: "valid", turn: modelTurn() });
    const h = coreHarness({ shops: [shop], now: SAT_1930, model, config: { globalPerHour: 1 } });
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start(); // global Turn 1
    const out = await c.say("quería un corte de mujer"); // 2: over
    expect(model.calls).toBe(0);
    expect(out.complete).toBe(false);
    expect(h.events).toEqual([]);
    const s = h.repo.calls()[0].state;
    expect(s).toMatchObject({ modelFailed: false, brainTurns: 1, offerKind: "first", fields: { serviceId: "corte-mujer" } });
  });

  it("a brain Turn after a model failure records modelFailed and one brain Turn; a valid model Turn after it adds none (1.6)", async () => {
    const model = switchModel({ kind: "429" });
    const h = coreHarness({ shops: [shop], now: SAT_1930, model });
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start();
    // front-desk-brain 17.5: "quería un corte de mujer" alone is a Sure_Reading and never calls the
    // model, so the failing model is reached with the not-sure tail (same facts).
    await c.say(notSure("quería un corte de mujer", "es"));
    expect(h.repo.calls()[0].state).toMatchObject({ modelFailed: true, brainTurns: 1 });
    expect(h.events.map((e) => [e.path, e.reason])).toEqual([["brain", "quota"]]);
    model.behaviour = { kind: "valid", turn: modelTurn({ reply: "Claro.", intent: "question" }) };
    await c.say("Oye, ¿y Lola es simpática?");
    expect(h.repo.calls()[0].state).toMatchObject({ modelFailed: true, brainTurns: 1 });
    expect(h.events).toHaveLength(1);
  });

  it("a database error in the early read is thrown from the Turn, never left unhandled", async () => {
    const h = coreHarness({ shops: [shop], now: SAT_1930, model: switchModel({ kind: "503" }) });
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start();
    await c.say("quería un corte de mujer");
    const boom = new Error("connection refused");
    Object.assign(h.deps, { repo: { ...h.deps.repo, listBookings: () => Promise.reject(boom) }, model: switchModel({ kind: "hang" }) });
    await expect(c.say("Oye, ¿y Lola es simpática?")).rejects.toBe(boom);
  });
});

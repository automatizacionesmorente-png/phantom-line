import { describe, expect, it } from "vitest";
import { lolaSeedProfile } from "@/lib/db/seed";
import { SAT_1930 } from "./brainCall";
import { CoreCaller, coreHarness } from "./coreCall";

/** PHANTOM_BRAIN_ONLY: the model is never called, and the caller always gets an answer. */
const shop = lolaSeedProfile;

describe("brain-only mode", () => {
  it("never calls the model, and answers a Universal_FAQ question and a question nobody planned for", async () => {
    let calls = 0;
    const h = coreHarness({ shops: [shop], now: SAT_1930, model: { generate: async () => (calls++, "{}") } });
    Object.assign(h.deps.config, { brainOnly: true });
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start();
    const joke = await c.say("cuéntame un chiste");
    expect(joke.reply.length).toBeGreaterThan(10);
    const robot = await c.say("¿eres un robot?");
    expect(robot.reply).toMatch(/inteligencia artificial/i);
    const odd = await c.say("¿cuántos habitantes tiene Tokio?");
    expect(odd.reply.length).toBeGreaterThan(10);
    expect(calls).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { lolaSeedProfile } from "@/lib/db/seed";
import { SAT_1930 } from "./brainCall";
import { CoreCaller, coreHarness, switchModel } from "./coreCall";

// B11 counterexample (CI, seed 1521322254): after "¿habláis inglés?" switched the Call to English,
// "¿pagar con tarjeta?" got "I don't know that" and an unanswered note for the Owner.
describe("an FAQ asked in the other language", () => {
  it("is answered after the Call switched language, with no note for the Owner", async () => {
    const h = coreHarness({ shops: [lolaSeedProfile], now: SAT_1930, model: switchModel({ kind: "503" }) });
    const c = new CoreCaller(h.deps, lolaSeedProfile, "es");
    await c.start();
    await c.say("¿habláis inglés?");
    const out = await c.say("¿pagar con tarjeta?");
    expect(out.reply).not.toMatch(/don't know/i);
    expect(out.reply).toMatch(/card|Bizum|cash|tarjeta/i);
    expect(h.repo.calls()[0].state.notes ?? []).toEqual([]);
  });
  it("still ignores a single word that means something else in the other language", async () => {
    const h = coreHarness({ shops: [lolaSeedProfile], now: SAT_1930, model: switchModel({ kind: "503" }) });
    const c = new CoreCaller(h.deps, lolaSeedProfile, "en");
    await c.start();
    const out = await c.say("red");
    expect(out.reply).not.toMatch(/wifi/i);
  });
});

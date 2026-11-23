import { describe, expect, it } from "vitest";
import type { Repository } from "@/lib/conversation/types";
import type { ClientRecall } from "@/lib/clients/welcome";
import { lolaSeedProfile } from "@/lib/db/seed";
import { SAT_1930 } from "./brainCall";
import { CoreCaller, coreHarness, switchModel } from "./coreCall";

/**
 * BACKLOG 14: a returning client is greeted ("¡Hola de nuevo, Carlos!" / "Welcome back, Carlos!")
 * only when the caller gave the phone AND a name that passes the existing name + phone rule, and
 * the receptionist offers "lo de siempre" from history. Nothing from the book is read back
 * otherwise. The brain answers (the model is down), so the lines are the code's own.
 */
const shop = lolaSeedProfile;
const PHONE_ES = "seis uno dos, tres cuatro cinco, seis siete ocho";
const PHONE = "+34612345678";

function withBook(book: ClientRecall[], lookups: string[] = []) {
  const h = coreHarness({ shops: [shop], now: SAT_1930, model: switchModel({ kind: "503" }) });
  const base: Repository = h.deps.repo;
  const findClient: NonNullable<Repository["findClient"]> = async (shopId, phone) => {
    lookups.push(`${shopId}:${phone}`);
    return book.find((c) => c.phone === phone) ?? null;
  };
  Object.assign(h.deps, { repo: { ...base, findClient } });
  return h;
}

const carlos: ClientRecall = { name: "Carlos Vega", phone: PHONE, usualServiceId: "corte-hombre+degradado" };

describe("welcoming a returning client", () => {
  it("greets by first name when the phone and the stored name match, and offers lo de siempre", async () => {
    const lookups: string[] = [];
    const h = withBook([carlos], lookups);
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start();
    const r1 = await c.say("quería una cita");
    expect(r1.reply).not.toMatch(/Carlos|de nuevo/);
    const r2 = await c.say("me llamo carlos vega");
    expect(r2.reply).not.toMatch(/de nuevo/); // no phone yet: nothing is recognised
    expect(lookups).toEqual([]);
    const r3 = await c.say(`mi teléfono es ${PHONE_ES}`);
    expect(lookups).toEqual([`${shop.id}:${PHONE}`]);
    expect(r3.reply).toContain("¡Hola de nuevo, Carlos!");
    expect(r3.reply).toContain("¿Lo de siempre, corte de hombre y degradado?");
    expect(r3.cacheable).toBe(false);
    // Said once: the next Turn does not greet again.
    const r4 = await c.say("no, mejor un corte de mujer");
    expect(r4.reply).not.toContain("de nuevo");
  });

  it("a yes to lo de siempre takes that service", async () => {
    const h = withBook([carlos]);
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start();
    await c.say("quería una cita");
    await c.say("me llamo carlos vega");
    const offer = await c.say(`mi teléfono es ${PHONE_ES}`);
    expect(offer.reply).toContain("Lo de siempre");
    const yes = await c.say("sí");
    expect(yes.state.fields.service).toMatch(/corte de hombre/i);
    expect(yes.reply).not.toContain("Lo de siempre");
  });

  it("is said in English too", async () => {
    const h = withBook([{ ...carlos, usualServiceId: "corte-hombre" }]);
    const c = new CoreCaller(h.deps, shop, "en");
    await c.start();
    await c.say("I'd like an appointment");
    await c.say("my name is carlos vega");
    const r = await c.say("my phone is six one two, three four five, six seven eight");
    expect(r.reply).toContain("Welcome back, Carlos!");
    expect(r.reply).toMatch(/The usual, /);
  });

  it("never recognises a caller whose name does not match the stored one (same phone, other person)", async () => {
    const h = withBook([carlos]);
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start();
    await c.say("quería una cita");
    await c.say("me llamo Ana García");
    const r = await c.say(`mi teléfono es ${PHONE_ES}`);
    expect(r.reply).not.toMatch(/Carlos|Vega|de nuevo|siempre/);
    expect(JSON.stringify(r)).not.toMatch(/Carlos|Vega/);
  });

  it("never recognises a caller who gives a name but a different phone", async () => {
    const h = withBook([carlos]);
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start();
    await c.say("quería una cita");
    await c.say("me llamo carlos vega");
    const r = await c.say("mi teléfono es seis uno dos, tres cuatro cinco, seis siete nueve");
    expect(r.reply).not.toMatch(/de nuevo|siempre/);
  });

  it("offers nothing when the stored client has no usual service, but still greets", async () => {
    const h = withBook([{ ...carlos, usualServiceId: null }]);
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start();
    await c.say("quería una cita");
    await c.say("me llamo carlos vega");
    const r = await c.say(`mi teléfono es ${PHONE_ES}`);
    expect(r.reply).toContain("¡Hola de nuevo, Carlos!");
    expect(r.reply).not.toContain("siempre");
  });

  it("a repository without a customer book changes nothing", async () => {
    const h = coreHarness({ shops: [shop], now: SAT_1930, model: switchModel({ kind: "503" }) });
    const c = new CoreCaller(h.deps, shop, "es");
    await c.start();
    await c.say("quería una cita");
    await c.say("me llamo carlos vega");
    const r = await c.say(`mi teléfono es ${PHONE_ES}`);
    expect(r.reply).not.toContain("de nuevo");
  });
});

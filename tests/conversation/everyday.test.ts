import { describe, expect, it } from "vitest";
import { lolaSeedProfile } from "@/lib/db/seed";
import { SAT_1930 } from "./brainCall";
import { CoreCaller, coreHarness } from "./coreCall";

/** What a caller hears for everyday and unplanned things, with the model switched off (PHANTOM_BRAIN_ONLY). */
const shop = lolaSeedProfile;

async function hear(lang: "es" | "en", utterance: string): Promise<string> {
  let calls = 0;
  const h = coreHarness({ shops: [shop], now: SAT_1930, model: { generate: async () => (calls++, "{}") } });
  Object.assign(h.deps.config, { brainOnly: true });
  const c = new CoreCaller(h.deps, shop, lang);
  await c.start();
  const r = await c.say(utterance);
  expect(calls).toBe(0);
  return r.reply;
}

describe("everyday talk, no API token", () => {
  const cases: [lang: "es" | "en", said: string, heard: RegExp][] = [
    ["es", "¿eres un robot?", /inteligencia artificial/i],
    ["en", "are you a real person?", /AI receptionist/i],
    ["es", "cuéntame un chiste", /agenda/i],
    ["en", "what's the capital of France?", /appointments/i],
    ["es", "¿cuál es la capital de Francia?", /citas/i],
    ["es", "me han dicho que sois muy buenos", /gracias/i],
    ["es", "¿sois caros?", /depende de cada servicio/i],
    ["en", "is it expensive", /depends on each service/i],
    ["es", "qué hora es", /No llevo reloj/i],
    ["es", "tengo una queja", /apunto a Lola/i],
    ["en", "I want to complain", /note for Lola/i],
    ["es", "me habéis hecho un destrozo en el pelo", /apunto a Lola/i],
    // An ability question is not a request for a service that does not exist.
    ["es", "¿puedo llevar a mi hijo?", /^(?!.*no hacemos)/i],
    ["en", "can I bring my dog", /^(?!.*we don't do)/i],
    ["es", "necesito factura", /^(?!.*no hacemos)/i],
    // What the shop's own FAQ says still wins.
    ["es", "¿aceptáis tarjeta?", /tarjeta/i],
  ];
  for (const [lang, said, heard] of cases)
    it(`${lang}: ${said}`, async () => {
      expect(await hear(lang, said)).toMatch(heard);
    });
});

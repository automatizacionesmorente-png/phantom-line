import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";
import type { TestDb } from "../db/pglite";
import { calls } from "@/lib/db/schema";
import { createScriptedModel } from "@/lib/receptionist/callModel";
import { Caller, makeDeps, makePost, modelTurn, setupDb } from "./harness";

/**
 * natural-voice 7.3: handleTurn passes the Call's language to toSpokenReply, so
 * digits the model still writes in its own answers reach the caller as words
 * (Requirement 11.4), and the stored transcript holds exactly the spoken words.
 * Through the real route, with a fake model returning what a model plausibly writes.
 */
let t: TestDb;
beforeAll(async () => {
  t = await setupDb();
}, 120_000);
beforeEach(async () => {
  await t.reset();
  await insertShop(t, lolaProfile);
});
afterAll(async () => {
  await t.close();
});

const question = (reply: string, language: "es" | "en" = "es") =>
  modelTurn({ intent: "question", language, reply, reason: "Pregunta" });

/**
 * Questions with no Profile_Topic, service, day or time in them. Since front-desk-brain the
 * Reading decides a Profile_Topic on the model path too (13.2), so "¿Cuánto cuesta un tinte?"
 * is answered from the profile's template, and the model's own digits would never be heard.
 * These lines leave the model's line as the reply, which is what this test is about.
 *
 * front-desk-brain 17.5: they must also not be Sure_Readings, or the model is not called at all.
 * Two old lines became sure through Code_Brain misreadings found here (reported in design.md, "As
 * built in task 17"): "Oye, una cosa que te quería preguntar" is read as an unknown service
 * "preguntar", and "Vale, ¿y algo más que me puedas contar?" reads "contar" as a typo of "cortar".
 * They are replaced by lines with the same role and no service, day, time or topic.
 */
const ES_FREE = ["Oye, otra cosa que me ronda la cabeza", "¿Y eso cómo lo veis vosotras?", "Vale, ¿y qué más me cuentas de vosotras?"];
const EN_FREE = ["Hey, one more thing I wanted to ask", "And what do you think about that?"];

async function ask(language: "es" | "en", replies: string[], utterances: string[]) {
  const model = createScriptedModel(replies.map((r) => question(r, language)));
  const { POST, settle } = makePost(makeDeps(t, model));
  const caller = new Caller(POST, language);
  await caller.start();
  const heard: string[] = [];
  for (const u of utterances) {
    const r = await caller.say(u);
    expect(r.status).toBe(200);
    heard.push(r.body.reply);
  }
  await settle();
  const [row] = await t.handle.db.select().from(calls);
  return { heard, transcript: row.transcript.map((l) => l.receptionist) };
}

describe("the model's own digits reach the caller as words", () => {
  it("Spanish: a price, a duration and opening hours", async () => {
    const { heard, transcript } = await ask(
      "es",
      [
        "Un tinte cuesta 45 € y dura 90 minutos.",
        "El sábado abrimos de 10:00 a 14:00 y de 17:00 a 20:00.",
        "Estamos en la Calle Mayor 12, te esperamos.",
      ],
      ES_FREE,
    );
    expect(heard).toEqual([
      "Un tinte cuesta cuarenta y cinco euros y dura noventa minutos.",
      "El sábado abrimos de las diez de la mañana a las dos de la tarde y de las cinco a las ocho de la tarde.",
      "Estamos en la Calle Mayor doce, te esperamos.",
    ]);
    for (const line of heard) expect(line).not.toMatch(/\d/);
    // The transcript shows exactly the words that were spoken (greeting first).
    expect(transcript.slice(1)).toEqual(heard);
  });

  it("English: a price with cents, a time with pm and an ordinal", async () => {
    const { heard, transcript } = await ask(
      "en",
      ["A haircut is €15.50 and takes 30 minutes.", "We open at 5 pm on Saturday the 14th."],
      EN_FREE,
    );
    expect(heard).toEqual([
      "A haircut is fifteen euros fifty and takes thirty minutes.",
      "We open at five in the afternoon on Saturday the fourteenth.",
    ]);
    for (const line of heard) expect(line).not.toMatch(/\d/);
    expect(transcript.slice(1)).toEqual(heard);
  });

  it("the model's 2-sentence limit still holds after the digits become words", async () => {
    const { heard } = await ask(
      "es",
      ["Abrimos a las 10:00. Cerramos a las 20:00. Y los lunes no abrimos."],
      [ES_FREE[0]],
    );
    expect(heard).toEqual(["Abrimos a las diez de la mañana. Cerramos a las ocho de la tarde."]);
  });
});

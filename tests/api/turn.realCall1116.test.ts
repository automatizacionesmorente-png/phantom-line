import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { insertShop } from "../db/helpers";
import type { TestDb } from "../db/pglite";
import type { ModelClient } from "@/lib/conversation/types";
import type { FallbackLogEvent } from "@/lib/conversation/fallbackLog";
import { bookings, calls, messages } from "@/lib/db/schema";
import { lolaSeedProfile } from "@/lib/db/seed";
import {
  createScriptedModel,
  failsWith503,
  MODEL_TIMEOUT_MS,
  neverResolves,
  throws429,
} from "@/lib/receptionist/callModel";
import { phrases, type Said } from "@/lib/receptionist/phrases";
import { toSpokenReply } from "@/lib/receptionist/speech";
import { getSectorPack, type Lang } from "@/lib/sectors";
import { Caller, makeDeps, makePost, modelTurn, setupDb, SHOP } from "./harness";
import { NOT_SURE_TAIL } from "../conversation/notSure";

/**
 * front-desk-brain task 10: the Real_Call_2026_11_16, replayed (Requirements 15.1, 15.2).
 *
 * On 2026-11-16 a real caller on the public demo said "Hola Lola quería cortarme el pelo y hacerme
 * un degradado". Gemini answered 503 after 6.6 s, the caller heard the Fallback_Message and the
 * Call was over. This file replays that call on PGlite through the real route (`makePost` and the
 * `Caller` harness), with the Rich_Profile the seed writes and the clock at Saturday 14 November
 * 2026, 19:30 Madrid, so the First_Offer is Tuesday 17 at 10:00 ("el martes a las diez").
 *
 * - 10.1 / 10.3: every Turn is a Sure_Reading, so the model is never called, whichever way it
 *   would fail (always 503, a hang, a 429). Each fake counts its calls, and the count must be 0.
 * - 10.2: the same first line plus three words no rule places (`NOT_SURE_TAIL`), so the model is
 *   called and fails; the brain still answers with the same First_Offer, one `turn_fallback` line
 *   with `path: "brain"` is written for that Turn only, and the Message has `modelFailed: true`.
 * - 10.4: the not-sure line with a healthy model whose `service` is "cortarme el pelo y un
 *   degradado": the code's facts decide on the model path too (13.2), so the same Combo_Id and
 *   the same First_Offer.
 */
const shop = lolaSeedProfile;
const pack = getSectorPack(shop.sectorPackId);
/** Saturday 14 November 2026, 19:30 in Madrid. */
const NOW = Temporal.Instant.from("2026-11-14T18:30:00Z");
/** Tuesday 17 November 2026, 10:00 in Madrid: the First_Offer. */
const TUE_1000 = Temporal.Instant.from("2026-11-17T09:00:00Z");
const COMBO = "corte-hombre+degradado";
const PHONE = "+34612345678";

/** The real call in Spanish, and its English twin (10.3). */
const SCRIPT: Record<Lang, { first: string; yes: string; name: string; customer: string; phone: string }> = {
  es: { first: "Hola Lola quería cortarme el pelo y hacerme un degradado", yes: "sí", name: "Me llamo Ana", customer: "Ana", phone: "612 345 678" },
  en: { first: "Hi Lola, I'd like a haircut and a fade", yes: "yes", name: "My name is Ann", customer: "Ann", phone: "+34 612 345 678" },
};

/** The First_Offer as the caller hears it, pinned once as a literal (10.1). */
const FIRST_OFFER_ES =
  "Un corte de hombre y un degradado son cincuenta minutos y dieciocho euros. ¿Te viene bien el martes a las diez? Si prefieres otro día, dímelo.";

let t: TestDb;
beforeAll(async () => {
  t = await setupDb();
}, 60_000);
beforeEach(async () => {
  await t.reset();
  await insertShop(t, shop);
});
afterAll(async () => {
  await t.close();
});

const P = (lang: Lang, callId: string, turn: number) => phrases(lang, pack, shop, { callId, turn }, NOW);
const spoken = (line: Said, lang: Lang) => toSpokenReply(line.text, lang, { maxSentences: 3 });

/** Wraps a fake so every call to it is counted, whatever it does. */
function counted(inner: ModelClient): ModelClient & { count: number } {
  const m = {
    count: 0,
    generate(req: Parameters<ModelClient["generate"]>[0]) {
      m.count++;
      return inner.generate(req);
    },
  };
  return m;
}

/** The three ways the free tier failed on the deployed demo (design.md, "Testing strategy"). */
const FAILING: [string, () => ModelClient][] = [
  ["always 503", () => failsWith503(Infinity, createScriptedModel([]))],
  ["a hang", () => neverResolves],
  ["a 429", () => throws429],
];

function setup(lang: Lang, model: ModelClient) {
  const events: FallbackLogEvent[] = [];
  const deps = {
    ...makeDeps(t, model, { modelTimeoutMs: MODEL_TIMEOUT_MS }),
    clock: () => NOW,
    logFallback: (e: FallbackLogEvent) => events.push(e),
  };
  const { POST, settle } = makePost(deps);
  return { caller: new Caller(POST, lang), events, settle };
}

/**
 * The whole call, Turn by Turn, with the exact reply each Turn must give. `first` is the first
 * utterance (the real line, or the not-sure variant). Returns the replies heard.
 */
async function runCall(lang: Lang, caller: Caller, first: string): Promise<string[]> {
  const s = SCRIPT[lang];
  const fallback = spoken(P(lang, "x", 0).fallbackEnd(), lang);
  const heard: string[] = [];
  await caller.start();
  const id = () => caller.callId;

  // Turn 1: the First_Offer for the Service_Combo, with its totals and the slot.
  const r1 = await caller.say(first);
  expect(r1.status).toBe(200);
  expect(r1.body.reply).toBe(spoken(P(lang, id(), 1).firstOffer(COMBO, TUE_1000), lang));
  // The public state shows the service by name (`serviceView`); the Combo_Id is checked on the booking row.
  expect(r1.body.state.fields.service).toBe(lang === "es" ? "Corte de hombre + Degradado" : "Men's cut + Fade");
  heard.push(r1.body.reply);

  // Turn 2: "sí" accepts the offer; it is not a booking (B12), the name is next.
  const r2 = await caller.say(s.yes);
  expect(r2.body.reply).toBe(spoken(P(lang, id(), 2).timeAcceptedAskName(TUE_1000), lang));
  expect(r2.body.state.fields.requestedTime).toBe("2026-11-17T10:00");
  heard.push(r2.body.reply);

  // Turn 3: the name; the pack requires the phone, so it is asked next.
  const r3 = await caller.say(s.name);
  expect(r3.body.reply).toBe(spoken(P(lang, id(), 3).askPhone(), lang));
  expect(r3.body.state.fields.name).toBe(s.customer);
  heard.push(r3.body.reply);

  // Turn 4: the phone; the read-back names the combo, the day, the time and the total.
  const r4 = await caller.say(s.phone);
  expect(r4.body.reply).toBe(spoken(P(lang, id(), 4).readBack(COMBO, TUE_1000, s.customer, PHONE), lang));
  heard.push(r4.body.reply);

  for (const r of [r1, r2, r3, r4]) {
    expect(r.body.complete).toBe(false);
    expect(r.body.outcome).toBeUndefined();
  }

  // Turn 5: "sí" to the read-back books it.
  const r5 = await caller.say(s.yes);
  expect(r5.body).toMatchObject({ complete: true, outcome: "booked" });
  expect(r5.body.reply).toBe(spoken(P(lang, id(), 5).booked(COMBO, TUE_1000), lang));
  heard.push(r5.body.reply);

  for (const line of heard) expect(line).not.toBe(fallback);
  return heard;
}

/** One booking from 10:00 to 10:50 Madrid on chair 1 with the Combo_Id, and one booked Message. */
async function expectBooked(lang: Lang, callId: string, modelFailed: boolean) {
  const rows = await t.handle.db.select().from(bookings);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ serviceId: COMBO, resourceId: "chair-1", customerName: SCRIPT[lang].customer, customerPhone: PHONE });
  expect(rows[0].startsAt.toISOString()).toBe("2026-11-17T09:00:00.000Z");
  expect(rows[0].endsAt.toISOString()).toBe("2026-11-17T09:50:00.000Z");
  const ms = await t.handle.db.select().from(messages);
  expect(ms).toHaveLength(1);
  expect(ms[0]).toMatchObject({ callId, outcome: "booked", modelFailed });
  const cs = await t.handle.db.select().from(calls);
  expect(cs.map((c) => c.status)).toEqual(["completed"]);
}

describe("Real_Call_2026_11_16 in Spanish: every Turn is sure, the model is never called (10.1)", () => {
  it("the first reply is the First_Offer, word for word", () => {
    expect(P("es", "any", 1).firstOffer(COMBO, TUE_1000).text).toBe(FIRST_OFFER_ES);
    expect(spoken(P("es", "any", 1).firstOffer(COMBO, TUE_1000), "es")).toBe(FIRST_OFFER_ES);
  });

  for (const [name, failing] of FAILING) {
    it(`with a model that fails (${name}): booked, zero model calls, no turn_fallback line`, async () => {
      const model = counted(failing());
      const { caller, events, settle } = setup("es", model);
      const heard = await runCall("es", caller, SCRIPT.es.first);
      expect(heard[0]).toBe(FIRST_OFFER_ES);
      expect(model.count).toBe(0);
      expect(events).toEqual([]);
      await expectBooked("es", caller.callId, false);
      await settle();
    });
  }
});

describe("the fourth run: three unplaceable words, so the model is called and fails (10.2)", () => {
  const first = SCRIPT.es.first + NOT_SURE_TAIL.es;
  for (const [name, failing] of FAILING) {
    it(`${name}: the same First_Offer, one turn_fallback line with path "brain", modelFailed: true`, async () => {
      const model = counted(failing());
      const { caller, events, settle } = setup("es", model);
      const heard = await runCall("es", caller, first);
      expect(heard[0]).toBe(FIRST_OFFER_ES);
      // Only Turn 1 asked the model; every later Turn was sure.
      expect(model.count).toBeGreaterThanOrEqual(1);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ path: "brain", shopId: SHOP });
      await expectBooked("es", caller.callId, true);
      await settle();
    }, 30_000);
  }
});

describe("the English twin (10.3)", () => {
  for (const [name, failing] of FAILING) {
    it(`with a model that fails (${name}): booked, zero model calls, no turn_fallback line`, async () => {
      const model = counted(failing());
      const { caller, events, settle } = setup("en", model);
      const heard = await runCall("en", caller, SCRIPT.en.first);
      expect(heard[0]).toBe(
        "A men's cut and a fade take fifty minutes and cost eighteen euros. Does next Tuesday at ten work for you? If another day suits you better, just say.",
      );
      expect(model.count).toBe(0);
      expect(events).toEqual([]);
      await expectBooked("en", caller.callId, false);
      await settle();
    });
  }
});

describe("a healthy model on the not-sure variant: the code's facts decide (10.4, 13.2)", () => {
  it('the model\'s service "cortarme el pelo y un degradado" gives the same Combo_Id and First_Offer', async () => {
    const model = createScriptedModel([
      modelTurn({
        intent: "booking",
        service: "cortarme el pelo y un degradado",
        reason: "Quiere un corte y un degradado",
        reply: "Claro, ¿qué día te viene bien?",
      }),
    ]);
    const { caller, events, settle } = setup("es", model);
    const heard = await runCall("es", caller, SCRIPT.es.first + NOT_SURE_TAIL.es);
    expect(heard[0]).toBe(FIRST_OFFER_ES);
    // The model was asked once, for Turn 1, and answered validly; its own line was not spoken.
    expect(model.calls).toHaveLength(1);
    expect(heard.join(" ")).not.toContain("¿qué día te viene bien?");
    expect(events).toEqual([]);
    await expectBooked("es", caller.callId, false);
    await settle();
  });
});

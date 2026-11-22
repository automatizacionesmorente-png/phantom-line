import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import type { TopicHit } from "@/lib/conversation/brain/topics";
import { lolaSeedProfile } from "@/lib/db/seed";
import { FILLER_KINDS, FILLERS, fillerTexts } from "@/lib/receptionist/fillers";
import { phrases, type Said } from "@/lib/receptionist/phrases";
import { MAX_WORDS, splitSentences } from "@/lib/receptionist/speech";
import { getSectorPack, type Lang } from "@/lib/sectors";

/**
 * front-desk-brain 8.2: every template of design.md "New templates", in Spanish and English, with
 * the Rich_Profile. NOW is Saturday 14 November 2026, 19:30 in Madrid (the Real_Call's clock), so
 * the shop is open and Tuesday 17 is "el martes" / "next Tuesday".
 */
const shop = lolaSeedProfile;
const pack = getSectorPack("hair-salon");
const NOW = Temporal.Instant.from("2026-11-14T18:30:00Z");
const TUE_1000 = Temporal.Instant.from("2026-11-17T09:00:00Z");
const P = { es: phrases("es", pack, shop, undefined, NOW), en: phrases("en", pack, shop, undefined, NOW) };

const TOPICS: { key: string; topic: TopicHit }[] = [
  { key: "hours", topic: { kind: "hours", day: null, now: false } },
  { key: "hours(day)", topic: { kind: "hours", day: Temporal.PlainDate.from("2026-11-21"), now: false } },
  { key: "hours(closed day)", topic: { kind: "hours", day: Temporal.PlainDate.from("2026-11-16"), now: false } },
  { key: "hours(now)", topic: { kind: "hours", day: null, now: true } },
  { key: "address", topic: { kind: "address" } },
  { key: "services", topic: { kind: "services" } },
  { key: "price(service)", topic: { kind: "price", target: { kind: "service", id: "corte-hombre" } } },
  { key: "price(combo)", topic: { kind: "price", target: { kind: "service", id: "corte-hombre+degradado" } } },
  { key: "price(choice)", topic: { kind: "price", target: { kind: "choice", candidates: ["corte-mujer", "corte-hombre", "corte-infantil"] } } },
  { key: "duration(service)", topic: { kind: "duration", target: { kind: "service", id: "mechas" } } },
  { key: "duration(category)", topic: { kind: "duration", target: { kind: "category", categoryId: "color" } } },
  ...(shop.faq ?? []).map((f) => ({ key: `faq:${f.id}`, topic: { kind: "faq", id: f.id } as TopicHit })),
];

/** Every new template with its arguments, in one language. */
function all(lang: Lang): { key: string; said: Said }[] {
  const p = P[lang];
  return [
    { key: "firstOffer", said: p.firstOffer("corte-hombre+degradado", TUE_1000) },
    { key: "firstOffer(one)", said: p.firstOffer("mechas", TUE_1000) },
    { key: "firstOffer(three)", said: p.firstOffer("keratina+hidratante+matiz", TUE_1000) },
    { key: "offerAgain", said: p.offerAgain(TUE_1000) },
    { key: "noSlotNearby", said: p.noSlotNearby() },
    { key: "askService", said: p.askService() },
    { key: "askService(brief)", said: p.askService(true) },
    { key: "askServiceChoice", said: p.askServiceChoice(["corte-mujer", "corte-hombre", "corte-infantil"]) },
    { key: "askServiceChoice(category)", said: p.askServiceChoice(shop.services.filter((s) => s.category === "color").map((s) => s.id)) },
    ...TOPICS.map(({ key, topic }) => ({ key: `topicAnswer:${key}`, said: p.topicAnswer(topic) })),
    { key: "ownerNoted", said: p.ownerNoted() },
    { key: "ownerNoted(continuing)", said: p.ownerNoted(true) },
    { key: "sensitiveNoted", said: p.sensitiveNoted() },
    { key: "sensitiveNoted(continuing)", said: p.sensitiveNoted(true) },
    { key: "unknownKeepAlive", said: p.unknownKeepAlive() },
    { key: "unknownKeepAlive(continuing)", said: p.unknownKeepAlive(true) },
    { key: "notUnderstood", said: p.notUnderstood() },
    { key: "notUnderstoodAgain", said: p.notUnderstoodAgain() },
    { key: "languageSwitched", said: p.languageSwitched() },
    { key: "phoneAgain", said: p.phoneAgain() },
    { key: "tooManyServices", said: p.tooManyServices() },
    { key: "addOnRemoved", said: p.addOnRemoved(["degradado"], ["corte-hombre"]) },
    { key: "addOnRemoved(continuing)", said: p.addOnRemoved(["degradado"], ["corte-hombre"], true) },
    { key: "confirmAgain", said: p.confirmAgain() },
    { key: "smallTalk(thanks)", said: p.smallTalk("thanks") },
    { key: "smallTalk(greeting)", said: p.smallTalk("greeting") },
    { key: "smallTalk(no)", said: p.smallTalk("no") },
  ];
}

describe("the new templates, word for word (Rich_Profile)", () => {
  it("the First_Offer names every part, the totals and the slot (7.5, 8.1)", () => {
    expect(P.es.firstOffer("corte-hombre+degradado", TUE_1000).text).toBe(
      "Un corte de hombre y un degradado son cincuenta minutos y dieciocho euros. ¿Te viene bien el martes a las diez? Si prefieres otro día, dímelo.",
    );
    expect(P.en.firstOffer("corte-hombre+degradado", TUE_1000).text).toBe(
      "A men's cut and a fade take fifty minutes and cost eighteen euros. Does next Tuesday at ten work for you? If another day suits you better, just say.",
    );
    // A part priced "from" makes the total "desde" / "from" (7.5).
    expect(P.es.firstOffer("mechas", TUE_1000).text).toBe(
      "Unas mechas son dos horas y media y desde cincuenta y cinco euros. ¿Te viene bien el martes a las diez? Si prefieres otro día, dímelo.",
    );
    expect(P.en.firstOffer("mechas", TUE_1000).text).toContain("takes two and a half hours and costs from fifty-five euros");
    expect(P.es.offerAgain(TUE_1000).text).toBe("¿Te viene bien el martes a las diez?");
  });

  it("the catalog by Category, and the Service_Choice question (4.4, 11.6)", () => {
    expect(P.es.askService().text).toBe("Claro. Hacemos cortes, barbería, peinados, color y tratamientos. ¿Qué te quieres hacer?");
    expect(P.en.askService().text).toBe("Sure. We do haircuts, barbering, styling, colour and treatments. What would you like to have done?");
    expect(P.es.askServiceChoice(["corte-mujer", "corte-hombre", "corte-infantil"]).text).toBe("¿El corte es de mujer, de hombre o infantil?");
    expect(P.en.askServiceChoice(["corte-mujer", "corte-hombre", "corte-infantil"]).text).toBe("Is it a women's cut, a men's cut or a kids' cut?");
    expect(P.es.askServiceChoice(["barba", "arreglo-barba"]).text).toBe("¿Cuál quieres: un afeitado de barba o un arreglo de barba?");
  });

  it("the Profile_Topic answers come from the profile (9.1)", () => {
    const es = (t: TopicHit) => P.es.topicAnswer(t).text;
    const en = (t: TopicHit) => P.en.topicAnswer(t).text;
    expect(es({ kind: "hours", day: null, now: false })).toBe(
      "Abrimos de martes a sábado, de diez de la mañana a dos de la tarde y de cinco a ocho de la tarde. Lunes y domingo cerramos.",
    );
    expect(en({ kind: "hours", day: null, now: false })).toBe(
      "We're open Tuesday to Saturday, ten in the morning to two in the afternoon and five in the afternoon to eight in the evening. We're closed on Monday and Sunday.",
    );
    expect(es({ kind: "hours", day: Temporal.PlainDate.from("2026-11-21"), now: false })).toBe(
      "El sábado veintiuno abrimos de diez de la mañana a dos de la tarde y de cinco a ocho de la tarde.",
    );
    // Monday 16 is two days after Saturday 14: "el lunes" (receptionist-voice.md, never "pasado mañana").
    expect(es({ kind: "hours", day: Temporal.PlainDate.from("2026-11-16"), now: false })).toBe("El lunes cerramos.");
    expect(es({ kind: "hours", day: null, now: true })).toBe("Sí, ahora mismo estamos abiertos, hasta las ocho de la tarde.");
    expect(es({ kind: "address" })).toBe("Estamos en Calle Mayor doce, Madrid.");
    expect(es({ kind: "services" })).toBe("Hacemos cortes, barbería, peinados, color y tratamientos.");
    expect(es({ kind: "price", target: { kind: "service", id: "corte-hombre" } })).toBe("Por un corte de hombre son catorce euros, y se tarda media hora.");
    expect(en({ kind: "price", target: { kind: "service", id: "corte-hombre" } })).toBe("For a men's cut it's fourteen euros, and it takes half an hour.");
    expect(es({ kind: "price", target: { kind: "choice", candidates: ["corte-mujer", "corte-hombre", "corte-infantil"] } })).toBe(
      "Por un corte de mujer son veinticinco euros, por un corte de hombre catorce euros y por un corte infantil diez euros.",
    );
    // At most 3 named, then "the rest" (9.1); colour has 7 services, and only 2 fit in 25 words here.
    const colour = es({ kind: "duration", target: { kind: "category", categoryId: "color" } });
    expect(colour).toMatch(/^Para un tinte de raíz se tarda una hora y cuarto/);
    expect(colour.endsWith("Te cuento el resto si quieres.")).toBe(true);
    for (const f of shop.faq ?? []) {
      expect(es({ kind: "faq", id: f.id })).toBe(f.answer.es);
      expect(en({ kind: "faq", id: f.id })).toBe(f.answer.en);
    }
  });

  it("the shop is closed now: the next opening, said by day (Sunday 15 November, 12:00 Madrid)", () => {
    const sunday = phrases("es", pack, shop, undefined, Temporal.Instant.from("2026-11-15T11:00:00Z"));
    expect(sunday.topicAnswer({ kind: "hours", day: null, now: true }).text).toBe("Ahora mismo estamos cerrados. Abrimos el martes a las diez.");
    const en = phrases("en", pack, shop, undefined, Temporal.Instant.from("2026-11-15T11:00:00Z"));
    expect(en.topicAnswer({ kind: "hours", day: null, now: true }).text).toBe("We're closed right now. We open next Tuesday at ten.");
  });

  it("the Keep_Alive_Lines and the re-asks", () => {
    expect(P.es.ownerNoted().text).toBe("Se lo apunto a Lola para que te llame. Mientras, ¿te doy cita o te cuento horarios y precios?");
    expect(P.es.sensitiveNoted().text).toBe(
      "De eso no te puedo aconsejar, pero se lo apunto a Lola y te llama hoy mismo. ¿Te ayudo con algo más?",
    );
    expect(P.es.unknownKeepAlive().text).toBe("Eso no lo sé, pero se lo apunto a Lola. ¿Te ayudo con una cita, horarios o precios?");
    expect(P.es.notUnderstood().text).toBe("Perdona, no te he entendido. Puedo darte cita o contarte horarios, precios y servicios.");
    expect(P.es.notUnderstoodAgain().text).toBe(
      "Se lo dejo apuntado a Lola por si acaso. Si te resulta más fácil, también puedes escribirme aquí abajo.",
    );
    expect(P.en.languageSwitched().text).toBe("Of course, we can carry on in English. How can I help?");
    expect(P.es.phoneAgain().text).toBe("Perdona, no me ha quedado claro el número. ¿Me lo dices otra vez, despacio?");
    expect(P.es.tooManyServices().text).toBe("Como mucho te puedo apuntar tres servicios seguidos. ¿Cuáles quieres?");
    expect(P.es.addOnRemoved(["degradado"], ["corte-hombre"]).text).toBe(
      "Vale, sin el corte de hombre. El degradado va con el corte de hombre, así que lo quito también. ¿Qué te quieres hacer?",
    );
    expect(P.en.addOnRemoved(["degradado"], ["corte-hombre"]).text).toBe(
      "Okay, no men's cut. The fade goes with the men's cut, so I'll take it off too. What would you like to have done?",
    );
  });

  it("the Owner's code-built reason parts (10.7), in each language", () => {
    expect(P.es.owner.reasonWants(["Corte de hombre + Degradado"])).toBe("Quiere Corte de hombre + Degradado");
    expect(P.en.owner.reasonAsked(["hours", "faq:pago"])).toBe("Asked about the opening hours and pay by card");
    expect(P.es.owner.note({ kind: "unanswered", question: "¿qué tal es Lola cortando?" })).toBe("Sin respuesta: «¿qué tal es Lola cortando?»");
    expect(P.es.owner.note({ kind: "owner_request" })).toBe("Pide que Lola le llame");
  });
});

describe.each(["es", "en"] as const)("every new template in Spoken_Form (%s)", (lang) => {
  const lines = all(lang);

  it("at most 3 sentences of at most 25 words, no digits, no markup", () => {
    for (const { key, said } of lines) {
      const sentences = splitSentences(said.text);
      expect(sentences.length, `${key}: ${said.text}`).toBeLessThanOrEqual(3);
      for (const s of sentences) expect(s.split(/\s+/).filter(Boolean).length, `${key}: ${s}`).toBeLessThanOrEqual(MAX_WORDS);
      expect(said.text, key).not.toMatch(/\d/);
      expect(said.text, key).not.toMatch(/[*_#`~<>[\]{}|]/);
      expect(said.text.trim(), key).not.toBe("");
    }
  });

  it("cacheable by natural-voice 6.5: none holds a name, a phone or the Caller's words, so all are", () => {
    for (const { key, said } of lines) expect(said.cacheable, key).toBe(true);
  });

  it("the Spanish and English lines differ", () => {
    const other = all(lang === "es" ? "en" : "es");
    lines.forEach(({ key, said }, k) => expect(said.text, key).not.toBe(other[k].said.text));
  });
});

describe("Fillers (lib/receptionist/fillers.ts)", () => {
  it("at least 2 variants per kind and language, all different, in Spoken_Form", () => {
    for (const lang of ["es", "en"] as const) {
      for (const kind of FILLER_KINDS) {
        const variants = FILLERS[lang][kind];
        expect(variants.length, `${lang} ${kind}`).toBeGreaterThanOrEqual(2);
        expect(new Set(variants).size).toBe(variants.length);
        for (const v of variants) {
          expect(v).not.toMatch(/\d/);
          expect(v.split(/\s+/).length).toBeLessThanOrEqual(6);
        }
      }
      const texts = fillerTexts(lang);
      expect(texts.length).toBe(FILLER_KINDS.reduce((n, k) => n + FILLERS[lang][k].length, 0));
      expect(new Set(texts.map((t) => t.text)).size).toBe(texts.length);
    }
  });

  it("the module imports nothing, so the browser can bundle it without the phrase book", () => {
    const source = readFileSync(path.resolve(process.cwd(), "lib/receptionist/fillers.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/require\(/);
  });
});

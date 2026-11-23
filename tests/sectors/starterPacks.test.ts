import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ShopProfileSchema } from "@/lib/conversation/shopProfile";
import { normalizeText } from "@/lib/conversation/fields";
import { serviceWords } from "@/lib/conversation/brain/services";
import { findTerm } from "@/lib/messages/terms";
import { buildSystemInstruction } from "@/lib/receptionist/prompt";
import { allSectorPacks, getSectorPack, listSectorPacks, type Lang } from "@/lib/sectors";
import { brainCall, SAT_1930 } from "../conversation/brainCall";
import { starterShop } from "./starterShop";

const IDS = ["hair-salon", "barber-shop", "beauty-centre", "physio-clinic", "dental-clinic"] as const;

type Reading = ReturnType<typeof brainCall>[number]["reading"]["services"];
const read = (id: string, line: string, lang: Lang): Reading =>
  brainCall([line], { shop: starterShop(id), now: SAT_1930, lang })[0].reading.services;

/** Per pack: what callers say, in both languages, and what must happen. */
const CASES: Record<
  (typeof IDS)[number],
  {
    es: [string, string][];
    en: [string, string][];
    /** The bare word that makes the receptionist ask which one, then the answer and the service it settles. */
    choice: { lang: Lang; lines: [string, string]; category: string; id: string }[];
    urgent: { es: string[]; en: string[] };
    notUrgent: { es: string[]; en: string[] };
    /** Sensitive: the receptionist never advises; the turn is a note for the owner. */
    sensitive: { lang: Lang; line: string }[];
  }
> = {
  "hair-salon": {
    es: [["quiero un corte de hombre", "corte-hombre"], ["quiero unas mechitas", "mechas"], ["quiero un tinte de raíz", "tinte-raiz"]],
    en: [["a men's haircut please", "corte-hombre"], ["I'd like a women's haircut", "corte-mujer"], ["a haircut for my son", "corte-infantil"]],
    choice: [
      { lang: "es", lines: ["quería cortarme el pelo", "de hombre"], category: "cortes", id: "corte-hombre" },
      { lang: "en", lines: ["I'd like a haircut", "for my son"], category: "cortes", id: "corte-infantil" },
    ],
    urgent: { es: ["me ha dado alergia el tinte"], en: ["I had an allergic reaction to the dye"] },
    notUrgent: { es: ["¿hacéis la prueba de alergia?"], en: ["do you do an allergy test?"] },
    sensitive: [{ lang: "es", line: "me ha dado alergia el tinte" }, { lang: "en", line: "I had an allergic reaction" }],
  },
  "barber-shop": {
    es: [
      ["quiero un corte de hombre", "corte-hombre"],
      ["quiero un degradado", "degradado"],
      ["quiero arreglarme la barba", "arreglo-barba"],
      ["quiero un afeitado con toalla caliente", "afeitado-clasico"],
      ["quiero pelarme al cero", "pelado-maquina"],
    ],
    en: [
      ["a men's haircut please", "corte-hombre"],
      ["I'd like a gents' haircut", "corte-hombre"],
      ["can I get a skin fade", "degradado"],
      ["I want to trim my beard", "arreglo-barba"],
      ["a haircut for my son", "corte-infantil"],
    ],
    choice: [
      { lang: "es", lines: ["quería cortarme el pelo", "de hombre"], category: "cortes", id: "corte-hombre" },
      { lang: "es", lines: ["quiero la barba", "afeitado"], category: "barba", id: "afeitado-clasico" },
      { lang: "en", lines: ["I'd like a haircut", "a fade"], category: "cortes", id: "degradado" },
    ],
    urgent: { es: ["me ha dado alergia el producto", "me escuece la cara"], en: ["I think I'm allergic to the cream"] },
    notUrgent: { es: ["¿hacéis prueba de alergia?"], en: ["do you do an allergy test?"] },
    sensitive: [{ lang: "es", line: "me ha dado alergia el producto de la barba" }, { lang: "en", line: "my skin has a reaction to the razor" }],
  },
  "beauty-centre": {
    es: [
      ["quiero una manicura semipermanente", "manicura-semipermanente"],
      ["quiero una pedicura", "pedicura"],
      ["quiero depilarme las piernas", "cera-piernas"],
      ["quiero un lifting de pestañas", "lifting-pestanas"],
      ["quiero una limpieza facial", "limpieza-facial"],
    ],
    en: [
      ["I'd like a gel manicure", "manicura-semipermanente"],
      ["a bikini wax please", "cera-ingles"],
      ["I want lash extensions", "extensiones-pestanas"],
      ["a relaxing massage", "masaje-relajante"],
      ["a pedicure please", "pedicura"],
    ],
    choice: [
      { lang: "es", lines: ["quiero hacerme las uñas", "semipermanente"], category: "unas", id: "manicura-semipermanente" },
      { lang: "es", lines: ["quiero depilarme", "las axilas"], category: "depilacion", id: "cera-axilas" },
      { lang: "en", lines: ["I'd like my nails done", "acrylics"], category: "unas", id: "unas-acrilicas" },
    ],
    urgent: { es: ["me ha dado alergia el gel", "me quema la cera"], en: ["I had a reaction to the glue"] },
    notUrgent: { es: ["¿hacéis prueba de alergia antes?"], en: ["do you do a patch test?"] },
    sensitive: [{ lang: "es", line: "tengo hongos en una uña" }, { lang: "en", line: "I think I have an infection on my nail" }],
  },
  "physio-clinic": {
    es: [
      ["quiero una primera visita", "primera-visita"],
      ["quiero una sesión de fisio", "sesion-fisioterapia"],
      ["quiero un masaje descontracturante", "masaje-descontracturante"],
      ["quiero punción seca", "puncion-seca"],
      ["quiero una sesión de suelo pélvico", "suelo-pelvico"],
    ],
    en: [
      ["I'd like a first appointment", "primera-visita"],
      ["a physio session please", "sesion-fisioterapia"],
      ["a sports massage", "masaje-deportivo"],
      ["I want dry needling", "puncion-seca"],
      ["shockwave therapy please", "ondas-choque"],
    ],
    choice: [
      { lang: "es", lines: ["quiero un masaje", "deportivo"], category: "masajes", id: "masaje-deportivo" },
      { lang: "en", lines: ["I need a massage", "deep tissue"], category: "masajes", id: "masaje-descontracturante" },
    ],
    urgent: {
      es: ["tengo un dolor fuerte en la espalda", "me he hecho un esguince", "no puedo moverme"],
      en: ["I'm in severe pain", "I think I sprained my ankle", "I can't walk"],
    },
    notUrgent: { es: ["tengo dolor de espalda, quiero una cita"], en: ["I have a sore back and want to book"] },
    sensitive: [
      { lang: "es", line: "¿qué me tomo para la espalda?" },
      { lang: "es", line: "¿me puedes decir el diagnóstico de mi rodilla?" },
      { lang: "en", line: "what should I take for the pain, ibuprofen?" },
      { lang: "en", line: "is it serious, what is wrong with me" },
    ],
  },
  "dental-clinic": {
    es: [
      ["quiero una limpieza dental", "limpieza"],
      ["quiero una revisión", "revision"],
      ["quiero un blanqueamiento", "blanqueamiento"],
      ["quiero sacarme una muela", "extraccion"],
      ["quiero una revisión de ortodoncia", "revision-ortodoncia"],
    ],
    en: [
      ["a teeth whitening please", "blanqueamiento"],
      ["I need a filling", "empaste"],
      ["a dental check-up", "revision"],
      ["I'd like a root canal", "endodoncia"],
      ["an implant assessment", "consulta-implantes"],
    ],
    choice: [
      { lang: "es", lines: ["quiero un tratamiento", "un empaste"], category: "tratamientos", id: "empaste" },
      { lang: "en", lines: ["I'd like a consultation", "first visit"], category: "consultas", id: "primera-visita" },
    ],
    urgent: {
      es: ["tengo un dolor fuerte en una muela", "tengo un flemón", "me sangra la encía", "mi hijo se ha dado un golpe en un diente"],
      en: ["I have severe pain in a tooth", "my face is swollen", "my gum is bleeding", "I got a knock on my front tooth"],
    },
    notUrgent: { es: ["quiero una limpieza dental"], en: ["I'd like a dental cleaning"] },
    sensitive: [
      { lang: "es", line: "tengo un flemón, ¿qué antibiótico me tomo?" },
      { lang: "es", line: "me sangra la encía, ¿es grave?" },
      { lang: "en", line: "I have an abscess, can I take ibuprofen?" },
      { lang: "en", line: "I knocked my tooth and it's bleeding" },
    ],
  },
};

describe("listSectorPacks", () => {
  it("lists every appointment pack with its id, both names and its resource kind", () => {
    const list = listSectorPacks();
    expect(list.map((p) => p.id)).toEqual([...IDS]);
    expect(list).toEqual(
      expect.arrayContaining([
        { id: "barber-shop", name: { es: "Barbería", en: "Barber shop" }, resourceKind: { es: { one: "sillón", many: "sillones" }, en: { one: "chair", many: "chairs" } } },
        { id: "beauty-centre", name: { es: "Centro de estética y uñas", en: "Beauty and nails centre" }, resourceKind: { es: { one: "cabina", many: "cabinas" }, en: { one: "room", many: "rooms" } } },
        { id: "physio-clinic", name: { es: "Clínica de fisioterapia", en: "Physiotherapy clinic" }, resourceKind: { es: { one: "camilla", many: "camillas" }, en: { one: "treatment room", many: "treatment rooms" } } },
        { id: "dental-clinic", name: { es: "Clínica dental", en: "Dental clinic" }, resourceKind: { es: { one: "gabinete", many: "gabinetes" }, en: { one: "surgery", many: "surgeries" } } },
      ]),
    );
  });

  it("lists only appointment packs, and a caller cannot change the registry through the result", () => {
    for (const l of listSectorPacks()) expect(getSectorPack(l.id).unit).toBe("appointment");
    const first = listSectorPacks();
    first[0].resourceKind.es.one = "mutado";
    first[0].name.es = "mutado";
    expect(listSectorPacks()[0].resourceKind.es.one).not.toBe("mutado");
    expect(listSectorPacks()[0].name.es).not.toBe("mutado");
  });
});

describe("every starter catalogue", () => {
  it("passes the Shop_Profile schema, with ES/EN names, a spoken name, a duration, a price and a Category", () => {
    for (const pack of allSectorPacks()) {
      const shop = starterShop(pack.id);
      expect(ShopProfileSchema.safeParse(shop).success, pack.id).toBe(true);
      expect(shop.services.length, pack.id).toBeGreaterThanOrEqual(8);
      expect((shop.faq ?? []).map((f) => f.id), pack.id).toEqual(expect.arrayContaining(["tarifas", "pago", "parking", "cancelacion", "accesibilidad"]));
      for (const s of shop.services) {
        const at = `${pack.id}/${s.id}`;
        expect(s.name.es.length && s.name.en.length, at).toBeTruthy();
        expect(s.spokenName?.es && s.spokenName?.en, at).toBeTruthy();
        expect(s.category, at).toBeTruthy();
        expect(s.priceCents, at).toBeGreaterThan(0);
        expect(s.priceCents % 100, at).toBe(0);
        expect(s.durationMin % 5, at).toBe(0);
        expect((s.aliases ?? []).length, at).toBeGreaterThanOrEqual(4);
      }
      // Both languages are covered: some alias of every service is plain English.
      for (const s of shop.services) expect(s.name.es !== s.name.en || (s.aliases ?? []).length > 0, s.id).toBe(true);
    }
  });

  it("is rejected by the registry when a service is broken (the schema is really applied)", () => {
    const shop = starterShop("barber-shop");
    const broken = { ...shop, services: [{ ...shop.services[0], durationMin: 0 }] };
    expect(ShopProfileSchema.safeParse(broken).success).toBe(false);
  });

  it("property: no two services of a pack share an alias, a name or an id word", () => {
    const owner = new Map<string, Map<string, string>>();
    for (const pack of allSectorPacks()) {
      const words = new Map<string, string>();
      owner.set(pack.id, words);
      for (const s of starterShop(pack.id).services)
        for (const w of new Set(serviceWords(s).map(normalizeText))) {
          expect(words.get(w) ?? s.id, `${pack.id}: "${w}"`).toBe(s.id);
          words.set(w, s.id);
        }
    }
    fc.assert(
      fc.property(fc.constantFrom(...IDS), fc.nat(), fc.nat(), (id, i, j) => {
        const services = starterShop(id).services;
        const a = services[i % services.length];
        const b = services[j % services.length];
        if (a.id === b.id) return true;
        const wa = new Set(serviceWords(a).map(normalizeText));
        return serviceWords(b).every((w) => !wa.has(normalizeText(w)));
      }),
      { numRuns: 300 },
    );
  });

  it("property: every alias of every service resolves to that service, in Spanish or English", () => {
    const all = IDS.flatMap((id) => starterShop(id).services.flatMap((s) => (s.aliases ?? []).map((a) => [id, s.id, a] as const)));
    fc.assert(
      fc.property(fc.constantFrom(...all), ([id, serviceId, alias]) => {
        const hit = (["es", "en"] as const).some((lang) => {
          const r = read(id, lang === "es" ? `quiero ${alias}` : `I would like ${alias}`, lang);
          return r.kind === "set" && r.ids.includes(serviceId);
        });
        expect(hit, `${id}/${serviceId}: "${alias}"`).toBe(true);
      }),
      { numRuns: all.length },
    );
  });

  it("what the receptionist says for a service (its names and its spoken name) reads back as that one service", () => {
    const bad: string[] = [];
    for (const pack of allSectorPacks()) {
      const shop = starterShop(pack.id);
      for (const s of shop.services)
        for (const lang of ["es", "en"] as const) {
          const said = [s.name[lang], s.spokenName?.[lang] ?? ""];
          for (const w of said) {
            const r = read(pack.id, w, lang);
            // An Add_On brings its base along (4.10); nothing else may.
            const ids = r.kind === "set" ? r.ids.filter((id) => !(s.addOnTo ?? []).includes(id)) : [];
            if (ids.length !== 1 || ids[0] !== s.id) bad.push(`${pack.id}/${s.id}: ${w} -> ${ids.join("+")}`);
          }
        }
    }
    expect(bad).toEqual([]);
  });

  it("no FAQ alias is a service word, and no two FAQ entries share one (the profile schema checks it)", () => {
    for (const pack of allSectorPacks()) expect(ShopProfileSchema.safeParse(starterShop(pack.id)).success, pack.id).toBe(true);
  });
});

describe.each(IDS)("%s", (id) => {
  const c = CASES[id];
  const pack = getSectorPack(id);

  it.each(c.es)("Spanish: “%s” reads as %s", (line, serviceId) => {
    expect(read(id, line, "es")).toMatchObject({ kind: "set", ids: [serviceId] });
  });

  it.each(c.en)("English: “%s” reads as %s", (line, serviceId) => {
    expect(read(id, line, "en")).toMatchObject({ kind: "set", ids: [serviceId] });
  });

  it.each(c.choice.map((x) => [x.lines.join(" → "), x] as const))("a bare word asks which one: %s", (_name, x) => {
    const shop = starterShop(id);
    const turns = brainCall(x.lines, { shop, now: SAT_1930, lang: x.lang });
    expect(turns[0].reading.services).toMatchObject({ kind: "category", categoryId: x.category });
    expect(turns[0].decision.state.fields.serviceId).toBeUndefined();
    // The question names the choices in the shop's own words, and the answer settles the service.
    expect(turns[0].decision.reply).toMatch(/\?/);
    expect(turns[1].decision.state.fields.serviceId).toBe(x.id);
  });

  it("urgent words make the message urgent, in both languages, and everyday booking words do not", () => {
    for (const lang of ["es", "en"] as const) {
      for (const line of c.urgent[lang]) expect(findTerm([line], pack.vocabulary[lang].urgent), line).not.toBeNull();
      for (const line of c.notUrgent[lang]) {
        const shop = starterShop(id);
        const [t] = brainCall([line], { shop, now: SAT_1930, lang });
        expect(t.reading.sensitive, line).toBeNull();
      }
    }
    expect(findTerm(["quiero una cita hoy"], pack.vocabulary.es.today)).toBe("hoy");
    expect(findTerm(["I want an appointment today"], pack.vocabulary.en.today)).toBe("today");
  });

  it("sensitive topics become a note for the owner, never advice, and the pack lists them in the prompt", () => {
    const shop = starterShop(id);
    for (const { lang, line } of c.sensitive) {
      const [t] = brainCall([line], { shop, now: SAT_1930, lang });
      expect(t.reading.sensitive, line).not.toBeNull();
      expect(t.decision.state.notes?.some((n) => n.kind === "sensitive"), line).toBe(true);
      expect(t.decision.reply, line).toMatch(lang === "es" ? /no te puedo aconsejar.*apunto a Marta/ : /can't give advice.*note for Marta/);
      expect(t.decision.effects.some((e) => e.type === "createBooking")).toBe(false);
    }
    const now = SAT_1930;
    for (const lang of ["es", "en"] as const) {
      const prompt = buildSystemInstruction(shop, pack, lang, now);
      expect(pack.sensitiveTopics[lang].length).toBeGreaterThanOrEqual(3);
      expect(pack.neverPromise[lang].length).toBeGreaterThanOrEqual(3);
      for (const topic of pack.sensitiveTopics[lang]) expect(prompt).toContain(topic);
      for (const never of pack.neverPromise[lang]) expect(prompt).toContain(never);
      expect(prompt).toContain(pack.resourceKind[lang].one);
    }
  });

  it("the starter data speaks the pack's own words, never another sector's", () => {
    const shop = starterShop(id);
    const prompt = buildSystemInstruction(shop, pack, "es", SAT_1930);
    expect(prompt).not.toMatch(/\bmesa\b/i);
    expect(pack.slotStepMin).toBeGreaterThanOrEqual(5);
    expect(pack.rules.every((r) => typeof r === "function")).toBe(true);
  });
});

describe("the clinics never triage", () => {
  it.each(["physio-clinic", "dental-clinic"] as const)("%s: advice-seeking is urgent and sensitive in both languages", (id) => {
    const pack = getSectorPack(id);
    for (const lang of ["es", "en"] as const) {
      const text = pack.sensitiveTopics[lang].join(" ").toLowerCase();
      expect(text).toMatch(lang === "es" ? /diagn|clínic|medicaci/ : /diagnos|clinical|medication/);
      expect(findTerm([lang === "es" ? "¿qué me tomo?" : "what should I take?"], pack.vocabulary[lang].urgent)).not.toBeNull();
    }
  });
});

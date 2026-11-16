import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { LEXICON, lexiconEntries, type LexiconList } from "@/lib/conversation/brain/lexicon";
import { phraseKey } from "@/lib/conversation/brain/normalize";
import { readUtterance } from "@/lib/conversation/brain/read";
import { matchServices } from "@/lib/conversation/brain/services";
import { initialCallState, type CallState, type Lang } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import { getSectorPack } from "@/lib/sectors";

/** The sector-neutral lexicon (front-desk-brain 3.1, 3.2, 3.6, 19.2), one block per list. */
const shop = lolaSeedProfile;
const pack = getSectorPack(shop.sectorPackId);
const NOW = Temporal.Instant.from("2026-11-14T18:30:00Z");
const LANGS = ["es", "en"] as const;
const read = (utterance: string, lang: Lang, patch: Partial<CallState> = {}) =>
  readUtterance({ utterance, state: { ...initialCallState(lang), ...patch }, shop, pack, now: NOW, lang });
const readBack: Partial<CallState> = {
  stage: "awaiting_confirmation",
  fields: { serviceId: "corte-mujer", requested: { date: "2026-11-17", time: "10:00" }, name: "Ana", phone: "+34612345678" },
  pending: { kind: "book", serviceId: "corte-mujer", start: "2026-11-17T09:00:00Z" },
};
const entries = (lang: Lang, list: LexiconList) => LEXICON[lang][list];

describe("every lexicon list", () => {
  const lists = Object.keys(LEXICON.es) as LexiconList[];
  it("exists in both languages with the same lists", () => {
    expect(Object.keys(LEXICON.en).sort()).toEqual([...lists].sort());
  });
  it.each(lists)("%s: every entry has a word, and no entry repeats in a language", (list) => {
    for (const lang of LANGS) {
      const keys = entries(lang, list).map((e) => phraseKey(e.replace("{owner}", "x")));
      expect(keys.every((k) => k !== ""), `${lang} ${list}`).toBe(true);
      expect(new Set(keys).size, `${lang} ${list}`).toBe(keys.length);
    }
  });
});

describe("each list does its job", () => {
  for (const lang of LANGS) {
    it(`${lang} yes and no: each entry, as the first words, answers a read-back`, () => {
      for (const y of entries(lang, "yes")) expect(read(y, lang, readBack).yes, y).toBe(true);
      for (const n of entries(lang, "no")) expect(read(n, lang, readBack).no, n).toBe(true);
    });

    it(`${lang} goodbye and thanks: each entry alone closes, and is sure`, () => {
      for (const g of entries(lang, "goodbye")) {
        const r = read(g, lang);
        expect(r.intents, g).toContain("goodbye");
        expect(r.sure, g).toBe(true);
      }
      for (const t of entries(lang, "thanks")) expect(read(t, lang).intents, t).toContain("thanks");
    });

    it(`${lang} greeting: each entry is a greeting`, () => {
      for (const g of entries(lang, "greeting")) expect(read(g, lang).intents, g).toContain("greeting");
    });

    it(`${lang} booking: each entry makes a booking utterance`, () => {
      for (const b of entries(lang, "booking")) expect(read(b, lang).intents, b).toContain("booking");
    });

    it(`${lang} wanting: each entry before a service is a placed booking request`, () => {
      for (const w of entries(lang, "wanting")) {
        const r = read(`${w} un tinte de raíz`, lang);
        expect(r.services, w).toEqual({ kind: "set", ids: ["tinte-raiz"], mode: "replace" });
        expect(r.unplaced, w).toBe(0);
      }
    });

    it(`${lang} reschedule and cancel: each entry is that intent`, () => {
      for (const x of entries(lang, "reschedule")) expect(read(x, lang).intents, x).toContain("reschedule");
      for (const x of entries(lang, "cancel")) expect(read(x, lang).intents, x).toContain("cancel");
    });

    it(`${lang} negation: a service right after each entry is not requested (4.6)`, () => {
      for (const n of entries(lang, "negation")) {
        const m = matchServices(`${n} tinte de raíz`, shop);
        expect(m.request, n).toEqual({ kind: "none" });
      }
    });

    it(`${lang} addition: each entry before a service adds it (4.7)`, () => {
      for (const a of entries(lang, "addition")) {
        const m = matchServices(`${a} barba`, shop, { current: ["corte-hombre"] });
        expect(m.next, a).toEqual(["corte-hombre", "barba"]);
      }
    });

    it(`${lang} joiner: each entry joins two services`, () => {
      for (const j of entries(lang, "joiner")) expect(matchServices(`mechas ${j} matiz`, shop).next, j).toEqual(["mechas", "matiz"]);
    });

    it(`${lang} name cues: each entry is followed by the name (6.1)`, () => {
      for (const c of entries(lang, "nameCues")) expect(read(`${c} Ana Ruiz`, lang).name, c).toBe("Ana Ruiz");
    });

    it(`${lang} phone cues: each entry before digits leaves nothing unplaced`, () => {
      for (const c of entries(lang, "phoneCues")) {
        const r = read(`${c} 612 34 56 78`, lang);
        expect(r.phone, c).toBe("+34612345678");
        expect(r.unplaced, c).toBe(0);
      }
    });

    it(`${lang} owner requests and owner words: each makes an Owner_Request (10.1)`, () => {
      for (const t of entries(lang, "ownerRequest")) expect(read(t.replace("{owner}", "Lola"), lang).ownerRequest, t).toBe(true);
      const template = lang === "es" ? "quiero hablar con {owner}" : "talk to {owner}";
      for (const o of entries(lang, "ownerWords")) expect(read(template.replace("{owner}", o), lang).ownerRequest, o).toBe(true);
    });

    it(`${lang} language switch: each entry asks for the other language`, () => {
      for (const x of entries(lang, "toEn")) expect(read(x, "es").wantsLanguage, x).toBe("en");
      for (const x of entries(lang, "toEs")) expect(read(x, "en", { language: "en" }).wantsLanguage, x).toBe("es");
    });

    it(`${lang} question: each entry, said first, is a question cue`, () => {
      for (const q of entries(lang, "question")) expect(read(`${q} blablá`, lang).question, q).toBe(true);
    });

    it(`${lang} parts of the day: each entry narrows the offer (5.4)`, () => {
      for (const m of entries(lang, "morning")) expect(read(m, lang).partOfDay, m).toBe("morning");
      for (const a of entries(lang, "afternoon")) expect(read(a, lang).partOfDay, a).toBe("afternoon");
    });

    it(`${lang} built-in topics: each entry reaches its topic`, () => {
      for (const h of entries(lang, "hours")) expect(read(h, lang).topic?.kind, h).toBe("hours");
      for (const a of entries(lang, "address")) expect(read(a, lang).topic?.kind, a).toBe("address");
      for (const s of entries(lang, "services")) expect(read(s, lang).topic?.kind, s).toBe("services");
      for (const p of entries(lang, "price")) expect(read(`${p} un tinte de raíz`, lang).topic, p).toEqual({ kind: "price", target: { kind: "service", id: "tinte-raiz" } });
      for (const d of entries(lang, "duration"))
        expect(read(`${d} un tinte de raíz`, lang).topic, d).toEqual({ kind: "duration", target: { kind: "service", id: "tinte-raiz" } });
      for (const n of entries(lang, "now")) expect(read(`${lang === "es" ? "¿abrís" : "are you open"} ${n}?`, lang).topic, n).toMatchObject({ kind: "hours", now: true });
    });

    it(`${lang} filler and glue: never count as unplaced (19.2)`, () => {
      for (const f of [...entries(lang, "filler"), ...entries(lang, "glue")]) expect(read(f, lang).unplaced, f).toBe(0);
    });
  }
});

describe("the lexicon is sector-neutral (3.6)", () => {
  it("has no entry that is a service alias, a service name, a Category word or an FAQ alias of the Rich_Profile", () => {
    const shopWords = new Set<string>();
    for (const s of shop.services) for (const w of [s.id.replace(/-/g, " "), s.name.es, s.name.en, ...(s.aliases ?? [])]) shopWords.add(phraseKey(w));
    for (const c of shop.categories ?? []) for (const w of [c.name.es, c.name.en, ...(c.aliases ?? [])]) shopWords.add(phraseKey(w));
    for (const f of shop.faq ?? []) for (const w of [...f.aliases.es, ...f.aliases.en]) shopWords.add(phraseKey(w));
    const clashes = lexiconEntries().filter((e) => shopWords.has(e.phrase));
    expect(clashes).toEqual([]);
  });

  it("names no resource of the shop or kind of resource of any pack", () => {
    const resource = new Set<string>();
    for (const r of shop.resources) for (const w of [r.name.es, r.name.en]) resource.add(phraseKey(w));
    for (const lang of LANGS) for (const w of Object.values(pack.resourceKind[lang])) resource.add(phraseKey(w));
    expect(lexiconEntries().filter((e) => resource.has(e.phrase))).toEqual([]);
  });
});

describe("the Code_Brain is pure (design.md, Modules)", () => {
  const dir = join(process.cwd(), "lib/conversation/brain");
  it("imports nothing from lib/db or the model call", () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      const specs = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const s of specs) {
        expect(s, `${file}: ${s}`).not.toMatch(/(^|\/)lib\/db(\/|$)|^\.\.\/\.\.\/db|callModel/);
      }
    }
  });

  it(
    "is enforced by ESLint's no-restricted-imports on lib/conversation/brain/",
    async () => {
      const { ESLint } = await import("eslint");
      const eslint = new ESLint({ cwd: process.cwd() });
      const probe = 'import { lolaSeedProfile } from "@/lib/db/seed";\nimport { callReceptionist } from "@/lib/receptionist/callModel";\nexport const x = [lolaSeedProfile, callReceptionist];\n';
      const [inBrain] = await eslint.lintText(probe, { filePath: join(dir, "lintProbe.ts") });
      const rules = inBrain.messages.map((m) => m.ruleId);
      expect(rules.filter((r) => r === "no-restricted-imports")).toHaveLength(2);
      // The same imports elsewhere in lib/conversation are allowed.
      const [outside] = await eslint.lintText(probe, { filePath: join(process.cwd(), "lib/conversation/lintProbe.ts") });
      expect(outside.messages.filter((m) => m.ruleId === "no-restricted-imports")).toEqual([]);
    },
    120_000,
  );
});

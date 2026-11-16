import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readName, readPhone } from "@/lib/conversation/brain/person";
import { speakNumber } from "@/lib/receptionist/spoken";

/** B10 of front-desk-brain design.md: names and phones are read as said (6.1–6.4). */
const NUM_RUNS = 200;
const opts = { expectName: false, ownerName: "Lola", shopName: "Peluquería Lola" };

/** 1–4 words, accents, compound surnames, as Chrome writes them (capitalized). */
const FIRST = ["Ana", "María", "José", "Lucía", "Íñigo", "Begoña", "Ramón", "Marta", "Álvaro", "Noelia", "Chloé", "John", "Sarah", "Mohamed", "Xiomara"];
const MORE = ["Luis", "Belén", "Carmen", "Antonio", "Elena"];
const SURNAMES = ["García", "Pérez", "Muñoz", "Fernández", "Ibáñez", "López", "Smith", "Núñez", "Gómez", "Sáez"];
const arbName = fc
  .tuple(fc.constantFrom(...FIRST), fc.option(fc.constantFrom(...MORE), { nil: null }), fc.array(fc.constantFrom(...SURNAMES), { minLength: 0, maxLength: 2 }))
  .map(([f, m, s]) => [f, ...(m ? [m] : []), ...s].slice(0, 4).join(" "));

const CUES = ["me llamo {n}", "soy {n}", "mi nombre es {n}", "a nombre de {n}", "my name is {n}", "I'm {n}", "this is {n}", "Hola, me llamo {n}, y quería una cita", "vale, soy {n}.", "my name is {n}, thanks"];
const ADDRESSED = ["Hola Lola, quería una cita", "Hola Lola, ¿abrís mañana?", "Hola Lola, buenas", "Hi Lola, I'd like to book", "Lola, una pregunta"];

/** A Spanish mobile number's 9 national digits. */
const arbMobile = fc
  .tuple(fc.constantFrom("6", "7"), fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 8, maxLength: 8 }))
  .map(([a, rest]) => a + rest.join(""));
/** The digits split into groups of 1 to 3. */
const arbGroups = (digits: string) =>
  fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 9, maxLength: 9 }).map((sizes) => {
    const out: string[] = [];
    let k = 0;
    for (const n of sizes) {
      if (k >= digits.length) break;
      out.push(digits.slice(k, k + n));
      k += n;
    }
    return out;
  });
/** A group said as number words: leading zeros as "cero", the rest with `speakNumber`. */
function groupWords(g: string): string {
  const zeros = /^0*/.exec(g)![0].length;
  const rest = g.slice(zeros);
  return [...Array(zeros).fill("cero"), ...(rest ? [speakNumber(Number(rest), "es")] : [])].join(" ");
}

describe("B10. Names and phones are read as said", () => {
  it("reads a name after a cue, and none when the owner is only addressed (6.1, 6.3)", () => {
    let addressed = 0;
    let cued = 0;
    fc.assert(
      fc.property(arbName, fc.constantFrom(...CUES), fc.constantFrom(...ADDRESSED), fc.boolean(), (name, cue, address, asAddress) => {
        if (asAddress) {
          addressed++;
          expect(readName(address, opts), address).toBeNull();
          return;
        }
        cued++;
        const said = cue.replace("{n}", name);
        expect(readName(said, opts)?.name, said).toBe(name);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(addressed).toBeGreaterThan(0);
    expect(cued).toBeGreaterThan(0);
  });

  it("reads every grouping of a Spanish mobile, as digits or as number words, to E.164 (6.4)", () => {
    const seen: Record<string, number> = {};
    const hit = (k: string) => (seen[k] = (seen[k] ?? 0) + 1);
    fc.assert(
      fc.property(
        arbMobile.chain((p) => fc.tuple(fc.constant(p), arbGroups(p))),
        fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
        fc.array(fc.constantFrom(" ", "-", " - ", ", "), { minLength: 9, maxLength: 9 }),
        fc.constantFrom("", "+34 ", "más treinta y cuatro, ", "0034 "),
        fc.constantFrom("", "mi teléfono es ", "es el ", "apunta: "),
        ([national, groups], asWords, seps, prefix, lead) => {
          let text = "";
          groups.forEach((g, k) => {
            const words = asWords[k];
            hit(words ? "words" : "digits");
            if (words && g.startsWith("0")) hit("leadingZero");
            const said = words ? groupWords(g) : g;
            if (k > 0) {
              // Two number-word groups need a pause between them, as people make one: without it,
              // "doscientos cinco" is the one number 205, not 200 and 5, in the language itself.
              const wordsAround = asWords[k] || asWords[k - 1];
              text += wordsAround ? ", " : seps[k];
            }
            text += said;
          });
          if (prefix) hit("prefix");
          if (groups.length >= 5) hit("manyGroups");
          if (groups.length <= 4) hit("fewGroups");
          const said = `${lead}${prefix}${text}`;
          expect(readPhone(said, "Europe/Madrid"), said).toMatchObject({ phone: `+34${national}`, rejected: false });
        },
      ),
      { numRuns: NUM_RUNS },
    );
    for (const k of ["words", "digits", "leadingZero", "prefix", "manyGroups", "fewGroups"]) expect(seen[k] ?? 0, k).toBeGreaterThan(0);
  });
});

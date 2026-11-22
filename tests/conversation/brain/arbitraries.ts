import fc from "fast-check";
import { lexiconWords } from "@/lib/conversation/brain/lexicon";
import { editDistance, words } from "@/lib/conversation/brain/normalize";
import { serviceIndex } from "@/lib/conversation/brain/services";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { modelTurn, type ModelBehaviour } from "../coreCall";

/**
 * Generators and pools for the Code_Brain's tests (front-desk-brain design.md, "Correctness
 * Properties"). `arbAliasVariant` is the design's: random case, accents added or removed,
 * doubled spaces, punctuation around it, and with probability 0.3 one typo in one word of 5+
 * letters, filtered so the typo word is not another alias word or a lexicon word.
 */

const ACCENT: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú", n: "ñ" };
const PLAIN: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ñ: "n", ü: "u" };

/** One typo of the kinds Requirement 4.2 allows: insertion, deletion, substitution, adjacent swap. */
export function arbTypo(word: string): fc.Arbitrary<string> {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return fc
    .tuple(fc.constantFrom("ins", "del", "sub", "swap"), fc.nat({ max: word.length - 1 }), fc.constantFrom(...letters))
    .map(([kind, at, ch]) => {
      if (kind === "ins") return word.slice(0, at) + ch + word.slice(at);
      if (kind === "del") return word.slice(0, at) + word.slice(at + 1);
      if (kind === "sub") return word.slice(0, at) + ch + word.slice(at + 1);
      const k = Math.min(at, word.length - 2);
      return word.slice(0, k) + word[k + 1] + word[k] + word.slice(k + 2);
    });
}

/** A said form of an alias that the matcher must still read as that alias. */
export function arbAliasVariant(alias: string, shop: ShopProfile): fc.Arbitrary<{ text: string; typo: boolean }> {
  const { aliasWords } = serviceIndex(shop);
  const lex = lexiconWords();
  const ws = alias.split(/\s+/).filter(Boolean);
  const typoable = ws
    .map((w, i) => ({ w, i, n: words(w) }))
    .filter((x) => x.n.length === 1 && x.n[0].length >= 5 && !/\d/.test(x.n[0]));
  const typoed: fc.Arbitrary<{ ws: string[]; typo: boolean }> =
    typoable.length === 0
      ? fc.constant({ ws, typo: false })
      : fc.oneof(
          { weight: 7, arbitrary: fc.constant({ ws, typo: false }) },
          {
            weight: 3,
            arbitrary: fc
              .constantFrom(...typoable)
              .chain((x) => arbTypo(x.n[0]).map((t) => ({ x, t })))
              .map(({ x, t }) => {
                const allow = x.n[0].length <= 8 ? 1 : 2;
                const ok =
                  t.length > 4 &&
                  !aliasWords.has(t) &&
                  !lex.has(t) &&
                  editDistance(t, x.n[0], allow) <= allow &&
                  // A typo that lands on a plural form ("cortes") is not a typo test.
                  !/s$/.test(t);
                if (!ok) return { ws, typo: false };
                const copy = [...ws];
                copy[x.i] = t;
                return { ws: copy, typo: true };
              }),
          },
        );
  return fc
    .record({
      base: typoed,
      accents: fc.constantFrom("keep", "strip", "add"),
      upper: fc.array(fc.boolean(), { minLength: 80, maxLength: 80 }),
      space: fc.constantFrom(" ", "  "),
      before: fc.constantFrom("", "¿", "¡", "(", '"', ", "),
      after: fc.constantFrom("", "?", "!", ".", ",", ")", "…"),
    })
    .map(({ base, accents, upper, space, before, after }) => {
      let s = base.ws.join(space);
      if (accents === "strip") s = [...s].map((c) => PLAIN[c] ?? c).join("");
      if (accents === "add") {
        // Add one accent to the first plain vowel: Chrome and callers both do it.
        const at = [...s].findIndex((c) => ACCENT[c] !== undefined && c !== "n");
        if (at >= 0) s = [...s].map((c, k) => (k === at ? ACCENT[c] : c)).join("");
      }
      s = [...s].map((c, k) => (upper[k % upper.length] ? c.toUpperCase() : c)).join("");
      return { text: `${before}${s}${after}`, typo: base.typo };
    });
}

/** Everyday utterances for the performance test and the reader's smoke checks. */
export const UTTERANCE_POOL: readonly string[] = [
  "Hola Lola quería cortarme el pelo y hacerme un degradado",
  "Hola, buenas tardes, mira, quería pedir cita para un corte de hombre y un arreglo de barba para mañana por la tarde si puede ser",
  "Buenos días, llamaba porque quería hacerme unas mechas con matiz y no sé cuánto tiempo lleva ni cuánto cuesta más o menos",
  "Oye, ¿aceptáis Bizum o hay que pagar con tarjeta? Y otra cosa, ¿hay parking cerca de la peluquería?",
  "Me llamo María del Carmen Pérez García y mi teléfono es el seis uno dos, treinta y cuatro, cincuenta y seis, setenta y ocho",
  "Mi número es 612 34 56 78, y el nombre es a nombre de Ana López, por favor",
  "Vale, perfecto, el martes a las cinco y media de la tarde me viene muy bien, muchas gracias",
  "No, ese día no puedo, mejor el miércoles por la mañana o el jueves a primera hora si hay hueco",
  "Quería hablar con Lola directamente si es posible, es que tengo una duda sobre un tratamiento que me hice",
  "Me ha dado alergia el tinte que me pusisteis la semana pasada y me pica muchísimo la cabeza, ¿qué hago?",
  "¿Y qué tal es Lola cortando? Es que una amiga me dijo que es muy buena con los rizos pero no sé",
  "Hi, I would like to book a men's cut and a beard trim for next Tuesday at half past five in the afternoon please",
  "Do you take cards or do I need to bring cash? And is there a car park somewhere close to the salon?",
  "My name is John Smith and my number is six one two, three four five, six seven eight, thanks a lot",
  "Can I talk to the owner please, it's about a problem with my last colour appointment",
  "Quería cancelar la cita que tengo para el sábado a las once porque me ha surgido un viaje de trabajo",
  "Quería cambiar mi cita del jueves al viernes por la tarde, a las seis o a las seis y media si puede ser",
  "¿Abrís los lunes? Es que solo puedo ir los lunes por la mañana antes de entrar a trabajar",
  "Sí, y también quería un tratamiento hidratante, que tengo el pelo muy seco con el verano",
  "Sin el degradado, mejor solo el corte de hombre, que el degradado me lo hago yo en casa",
  "¿Cuánto tarda el color? Es que querría venir en la hora de la comida y no tengo mucho tiempo",
  "¿Hacéis la prueba de alergia antes del tinte o hace falta venir otro día antes para hacerla?",
  "Adiós, gracias por todo, hasta luego",
  "Gracias, eso es todo",
  "patata frita con ketchup y mostaza en la playa de Benidorm bajo la lluvia",
  "¿Habláis inglés? Es para mi marido, que no habla nada de español y quiere cortarse el pelo",
  "In Spanish please, my English is not very good, I prefer to talk in Spanish if that's okay",
  "Pues mira, a las cinco, no, mejor a las seis, que a las cinco salgo del trabajo y no llego",
  "el veinte de diciembre a las doce del mediodía, que es el día de la boda de mi hermana",
  "quería un peinado de novia para el sábado veintiséis de diciembre, que me caso ese día por la mañana",
  "un corte para mi hija de seis años y otro para mi hijo de ocho, si puede ser a la vez",
  "Oye, una pregunta rápida, ¿cuánto cuesta un balayage con matiz? Es que lo he visto en Instagram",
  "¿Dónde estáis exactamente? Es que voy en metro y no sé en qué parada me tengo que bajar",
  "¿Tenéis wifi? Es que voy a estar dos horas y media con las mechas y querría trabajar un poco",
  "ok, so, just to confirm, that's tomorrow at ten in the morning for a women's cut, right?",
  "I'm Sarah, my phone is plus forty four, seven seven double zero nine hundred",
  "Is it possible to come without an appointment? I'm walking around the centre right now",
  "Sí",
  "No",
  "Vale",
  "Ana García",
  "612 34 56 78",
  "mañana",
  "por la tarde",
  "de hombre",
  "Buenas, quería saber si os queda algún hueco esta semana para un tinte de raíz y un tratamiento hidratante, por la tarde a ser posible",
  "Hello, could I book highlights with a toner for the twentieth of December in the morning? It's for a wedding",
  "Perdona, ¿me repites el precio del alisado de keratina? Es que no lo he oído bien con el ruido de la calle",
  "Ah, y también quería preguntar si vendéis champú, que el que me recomendasteis la otra vez se me ha acabado",
  "Mejor sin el arreglo de barba, solo el corte de hombre y el degradado, que la barba me la arreglo yo",
];

// ---------------------------------------------------------------------------
// arbModelBehaviour (design.md, "Correctness Properties"): what the model does on one Turn.

/**
 * A valid scripted turn, Gemini's 503, a 429, a hang that ignores the signal, a network error,
 * invalid JSON or a schema-invalid object. A valid turn never says the Caller wants to end, so a
 * property about a Call that goes on can use it as it is.
 */
export const arbModelBehaviour: fc.Arbitrary<ModelBehaviour> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc
      .record({
        reply: fc.constantFrom("Vale.", "Claro, dime.", "¿Algo más?", "Perfecto."),
        intent: fc.constantFrom("booking" as const, "question" as const, "other" as const),
        service: fc.constantFrom(null, "corte", "un degradado", "mechas"),
        callerConfirmed: fc.boolean(),
        outOfProfile: fc.boolean(),
        urgency: fc.constantFrom("low" as const, "normal" as const),
      })
      .map((over) => ({ kind: "valid" as const, turn: modelTurn({ ...over, reason: "Llama por una cita" }) })),
  },
  { weight: 1, arbitrary: fc.constant({ kind: "503" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "429" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "hang" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "network" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "invalid_json" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "schema_invalid" as const }) },
);

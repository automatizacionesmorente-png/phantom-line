import type { Lang } from "@/lib/sectors";
import { phraseKey, words } from "./normalize";

/**
 * The Code_Brain's sector-neutral words, per language (front-desk-brain 3.1–3.6, 19.2).
 * No entry names a service, a resource or a sector: the shop's own words come from the
 * Shop_Profile (aliases, Categories, FAQ) and the Sector_Pack, so a new pack needs no change
 * here. A test checks that no entry is an alias of the Rich_Profile (3.6). Entries are written
 * as people say them; they are compared after `tokenize` (no accents, lower case).
 */
export interface LangLexicon {
  yes: readonly string[];
  no: readonly string[];
  goodbye: readonly string[];
  thanks: readonly string[];
  greeting: readonly string[];
  /** Booking nouns and verbs: "cita", "reservar", "book". */
  booking: readonly string[];
  /** Verbs of wanting that carry a request: "quería", "hacerme", "I'd like". */
  wanting: readonly string[];
  reschedule: readonly string[];
  cancel: readonly string[];
  /** A service right after one of these is not requested (4.6). */
  negation: readonly string[];
  /** Before the first service, these make the request add to the Call's services (4.7). */
  addition: readonly string[];
  /** Words that join two services: "y", "con", "and", "with". */
  joiner: readonly string[];
  nameCues: readonly string[];
  phoneCues: readonly string[];
  /** "hablar con {owner}", "que me llame {owner}": `{owner}` stands for the owner words below. */
  ownerRequest: readonly string[];
  /** Who the Caller may ask for besides the owner's own name. */
  ownerWords: readonly string[];
  /** A request to carry on in English (`toEn`) or in Spanish (`toEs`). */
  toEn: readonly string[];
  toEs: readonly string[];
  /** Words that open a question when they come first. */
  question: readonly string[];
  /** Part of the day without a time (5.4). */
  morning: readonly string[];
  afternoon: readonly string[];
  /** Built-in Profile_Topics. */
  hours: readonly string[];
  now: readonly string[];
  address: readonly string[];
  services: readonly string[];
  price: readonly string[];
  duration: readonly string[];
  /** Filler words that never count as unplaced (19.2): "pues", "vale", "oye", "mira". */
  filler: readonly string[];
  /** Articles, prepositions and pronouns: placed by default, never a reason to call the model. */
  glue: readonly string[];
}

export const LEXICON: Record<Lang, LangLexicon> = {
  es: {
    yes: [
      "sí", "si claro", "vale", "perfecto", "de acuerdo", "me viene bien", "me va bien", "genial", "claro",
      "estupendo", "muy bien", "venga", "okey", "ok", "correcto", "eso es", "exacto", "por supuesto",
    ],
    no: ["no", "mejor otro", "no me viene bien", "no me va bien", "no gracias", "mejor no", "tampoco", "otro"],
    goodbye: ["adiós", "hasta luego", "nada más", "eso es todo", "hasta pronto", "chao", "chau", "un saludo"],
    thanks: ["gracias", "muchas gracias", "mil gracias", "te lo agradezco"],
    greeting: ["hola", "buenas", "buenos días", "buenas tardes", "buenas noches", "qué tal", "holaa"],
    booking: [
      "cita", "citas", "hora", "hueco", "reservar", "reserva", "pedir", "apuntar", "apuntarme", "turno",
      "coger", "pedir hora", "dar cita",
    ],
    wanting: [
      "quería", "querría", "quiero", "quisiera", "necesito", "me gustaría", "hacerme", "hacer", "hacerle",
      "venir", "ir", "pasarme", "puedo", "podría", "podéis", "busco", "darme", "me das", "me podéis",
    ],
    reschedule: ["cambiar", "cambio", "mover", "aplazar", "retrasar", "adelantar", "reprogramar", "cambiarla", "moverla"],
    cancel: ["anular", "cancelar", "anularla", "cancelarla", "no puedo ir", "no voy a poder ir", "anulo", "cancelo"],
    negation: ["sin", "no", "nada de", "tampoco", "ni"],
    addition: ["y también", "también", "además", "y un", "y una", "y además", "otra cosa"],
    joiner: ["y", "con", "e", "más"],
    nameCues: ["me llamo", "soy", "mi nombre es", "a nombre de", "de parte de"],
    phoneCues: ["mi teléfono", "teléfono", "mi móvil", "móvil", "mi número", "número", "el número"],
    ownerRequest: [
      "hablar con {owner}", "hablar con la {owner}", "hablar con el {owner}", "que me llame {owner}",
      "que me llame la {owner}", "que me llame el {owner}", "pásame con {owner}", "ponme con {owner}",
      "puedo hablar con {owner}", "quiero hablar con {owner}", "con una persona", "con alguien",
    ],
    ownerWords: ["dueña", "dueño", "encargada", "encargado", "jefa", "jefe", "una persona", "alguien", "persona"],
    toEn: ["hablas inglés", "habla inglés", "en inglés", "speak english", "in english", "english please"],
    toEs: ["en español", "en castellano", "hablas español"],
    question: ["qué", "cuánto", "cuánta", "cuándo", "dónde", "cómo", "cuál", "hay", "tenéis", "hacéis", "abrís", "se puede"],
    morning: ["por la mañana", "de mañana", "esta mañana", "a primera hora"],
    afternoon: ["por la tarde", "de tarde", "esta tarde", "por la noche", "a última hora"],
    hours: [
      "horario", "horarios", "abrís", "abren", "abre", "abierto", "abiertos", "abierta", "cerráis", "cierran",
      "cierra", "cerrado", "cerrados", "a qué hora abrís", "a qué hora cerráis", "qué horario",
    ],
    now: ["ahora", "ahora mismo", "en este momento"],
    address: ["dirección", "dónde estáis", "dónde está", "dónde están", "dónde os encuentro", "la calle", "ubicación", "dónde queda"],
    services: ["qué servicios", "servicios", "qué hacéis", "qué ofrecéis", "qué tenéis"],
    price: ["cuánto cuesta", "cuánto vale", "precio", "precios", "cuánto es", "cuánto sale", "cuánto me cobras", "cuesta", "cuestan", "valen"],
    duration: ["cuánto tarda", "cuánto dura", "cuánto tiempo", "cuánto se tarda", "cuánto lleva", "tarda", "dura"],
    filler: ["pues", "vale", "oye", "mira", "bueno", "eh", "em", "mm", "ehm", "a ver", "verás", "es que", "nada", "porfa", "por favor"],
    glue: [
      "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "a", "en", "para", "por", "con",
      "y", "o", "me", "mi", "mis", "te", "se", "le", "lo", "que", "es", "esta", "este", "ese", "esa", "eso",
      "yo", "tu", "usted", "vosotros", "os", "nos", "algo", "también", "sobre", "hacia", "día",
      "semana", "si", "muy", "más", "otra", "vez", "son",
    ],
  },
  en: {
    yes: [
      "yes", "yeah", "yep", "sure", "okay", "ok", "that works", "that's fine", "fine", "perfect", "great",
      "sounds good", "of course", "right", "correct", "alright", "all right",
    ],
    no: ["no", "nope", "no thanks", "not really", "another one", "something else", "that doesn't work"],
    goodbye: ["bye", "goodbye", "that's all", "that's it", "see you", "nothing else"],
    thanks: ["thanks", "thank you", "cheers", "many thanks"],
    greeting: ["hello", "hi", "hey", "good morning", "good afternoon", "good evening"],
    booking: ["book", "booking", "appointment", "slot", "reserve", "reservation", "schedule"],
    wanting: [
      "i'd like", "i would like", "i want", "i need", "could i", "can i", "get", "have", "like", "want",
      "need", "come in", "looking for",
    ],
    reschedule: ["reschedule", "move", "change", "postpone", "rebook"],
    cancel: ["cancel", "call off", "can't make it", "cannot make it", "won't make it"],
    negation: ["without", "no", "not", "don't want", "nor"],
    addition: ["also", "plus", "and a", "and also", "as well", "in addition"],
    joiner: ["and", "with", "plus", "then"],
    nameCues: ["my name is", "i'm", "i am", "it's", "this is", "under", "name's"],
    phoneCues: ["my number", "my phone", "phone", "number", "mobile"],
    ownerRequest: [
      "talk to {owner}", "speak to {owner}", "speak with {owner}", "talk with {owner}", "talk to the {owner}",
      "speak to the {owner}", "call me back", "put me through to {owner}",
    ],
    ownerWords: ["owner", "manager", "a person", "someone", "a human", "a real person", "person", "somebody"],
    toEn: ["in english", "english please", "speak english"],
    toEs: ["in spanish", "en español", "speak spanish", "hablas español", "spanish please"],
    question: ["what", "how", "when", "where", "which", "do", "does", "is", "are", "can", "could"],
    morning: ["in the morning", "this morning", "morning", "first thing"],
    afternoon: ["in the afternoon", "in the evening", "this afternoon", "this evening", "afternoon", "evening"],
    hours: [
      "opening hours", "hours", "open", "opening", "close", "closed", "closing", "what time do you open",
      "what time do you close",
    ],
    now: ["now", "right now", "at the moment"],
    address: ["address", "where are you", "where is it", "where's the", "location", "where are you located"],
    services: ["what services", "services", "what do you do", "what do you offer"],
    price: ["how much", "price", "prices", "cost", "costs", "charge"],
    duration: ["how long", "duration", "how much time"],
    filler: ["well", "so", "um", "uh", "erm", "hmm", "please", "actually", "just", "like"],
    glue: [
      "the", "a", "an", "of", "for", "to", "at", "on", "in", "and", "or", "i", "me", "my", "you", "your", "we",
      "it", "is", "that", "this", "some", "with", "about", "around", "be", "would", "there", "s", "m", "d",
      "ll", "re", "ve", "t", "day", "week", "very", "again",
    ],
  },
};

export type LexiconList = keyof LangLexicon;

/** Every list of a language as normalized phrases (word arrays), longest first. */
const PHRASES = new Map<string, readonly (readonly string[])[]>();
export function phrasesOf(lang: Lang, list: LexiconList): readonly (readonly string[])[] {
  const key = `${lang}:${list}`;
  let p = PHRASES.get(key);
  if (!p) {
    p = LEXICON[lang][list]
      .map((x) => words(x))
      .filter((w) => w.length > 0)
      .sort((a, b) => b.length - a.length);
    PHRASES.set(key, p);
  }
  return p;
}

/** Every single word that appears in any lexicon entry of either language. */
let WORDS: ReadonlySet<string> | null = null;
export function lexiconWords(): ReadonlySet<string> {
  if (!WORDS) {
    const s = new Set<string>();
    for (const lang of ["es", "en"] as const)
      for (const list of Object.keys(LEXICON[lang]) as LexiconList[])
        for (const e of LEXICON[lang][list]) for (const w of words(e.replace("{owner}", ""))) s.add(w);
    WORDS = s;
  }
  return WORDS;
}

/** Every lexicon entry of both languages as a normalized phrase, for the 3.6 check. */
export function lexiconEntries(): { lang: Lang; list: LexiconList; phrase: string }[] {
  const out: { lang: Lang; list: LexiconList; phrase: string }[] = [];
  for (const lang of ["es", "en"] as const)
    for (const list of Object.keys(LEXICON[lang]) as LexiconList[])
      for (const e of LEXICON[lang][list]) out.push({ lang, list, phrase: phraseKey(e.replace("{owner}", "")) });
  return out;
}

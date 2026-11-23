import { commonFaq } from "./starters/common";
import { psychologyPracticeCatalogue } from "./starters/psychologyPractice";
import type { SectorPack, StarterFaqEntry } from "./types";

/**
 * Crisis words ("suicidio", "hacerme daño"...) are answered from the profile, word for word, with
 * the two numbers to call in Spain: 112 and 024. They are spoken digit by digit (Spoken_Form). The
 * same phrases are in `vocabulary.urgent` as a net: an FAQ alias masks its urgent term (9.7), so
 * the caller gets this answer, and any wording the aliases miss still becomes an urgent note.
 */
const crisisFaq: StarterFaqEntry = {
  id: "crisis",
  aliases: {
    es: [
      "suicidio",
      "suicidarme",
      "quitarme la vida",
      "matarme",
      "hacerme daño",
      "autolesión",
      "autolesiones",
      "me quiero morir",
      "quiero morirme",
      "no quiero vivir",
      "no quiero seguir viviendo",
      "estoy en peligro",
    ],
    en: [
      "suicide",
      "kill myself",
      "end my life",
      "hurt myself",
      "harm myself",
      "self-harm",
      "want to die",
      "don't want to live",
      "i'm in danger",
    ],
  },
  answer: {
    es: "Es importante que hables con alguien ahora mismo: llama al uno, uno, dos, o al cero, dos, cuatro, que atienden a cualquier hora. Si hay peligro inmediato, llama siempre al uno, uno, dos.",
    en: "It is important to talk to someone right now: call one, one, two, or zero, two, four, which answer at any hour. If there is immediate danger, always call one, one, two.",
  },
};

const confidentiality: StarterFaqEntry = {
  id: "confidencialidad",
  aliases: {
    es: ["confidencial", "confidencialidad", "secreto profesional", "quién se entera"],
    en: ["confidential", "confidentiality", "who will know", "is it private"],
  },
  answer: {
    es: "Todo lo que se habla en consulta es confidencial.",
    en: "Everything discussed in a session is confidential.",
  },
};

const invoice: StarterFaqEntry = {
  id: "factura",
  aliases: {
    es: ["factura", "recibo", "justificante de pago", "desgravar"],
    en: ["invoice", "receipt", "proof of payment"],
  },
  answer: {
    es: "Podemos darte factura de cada sesión; pídela al pagar.",
    en: "We can give you an invoice for each session; ask for it when you pay.",
  },
};

/**
 * Psychology practice (consulta de psicología): appointments with psychologists, in person or
 * online. The receptionist NEVER asks why the caller wants a consultation, how they feel or
 * anything about their mental health; if the caller volunteers it, she does not comment or advise.
 * Diagnosis and medication questions become a note for the owner, and crisis words get the
 * emergency numbers (see `crisisFaq`).
 */
export const psychologyPractice: SectorPack = {
  id: "psychology-practice",
  displayName: { es: "Consulta de psicología", en: "Psychology practice" },
  unit: "appointment",
  resourceKind: {
    es: { one: "psicólogo", many: "psicólogos" },
    en: { one: "psychologist", many: "psychologists" },
  },
  requiredFields: ["service", "requestedTime", "name", "phone"],
  slotStepMin: 30,
  // "The service must fit before the session closes" is a general rule in lib/booking.
  rules: [],
  vocabulary: {
    // Crisis words, then the questions that ask for clinical advice (diagnosis, medication): any of
    // them makes the Message urgent and turns the turn into a note, never an answer. Bare
    // "ansiedad", "depresión" and "terapia" are left out on purpose: "quiero una cita, tengo
    // ansiedad" is the ordinary booking and the receptionist never asks for more.
    es: {
      booking: "cita",
      bookingVerb: "reservar",
      service: "sesión",
      place: "la consulta",
      urgent: [
        "urgente",
        "urgentemente",
        "urgencia",
        "emergencia",
        "crisis",
        "ataque de pánico",
        "suicidio",
        "suicidarme",
        "quitarme la vida",
        "matarme",
        "hacerme daño",
        "autolesión",
        "autolesiones",
        "me quiero morir",
        "quiero morirme",
        "no quiero vivir",
        "no quiero seguir viviendo",
        "estoy en peligro",
        "diagnóstico",
        "qué me pasa",
        "qué tengo",
        "estoy enfermo",
        "estoy enferma",
        "medicación",
        "medicamento",
        "antidepresivos",
        "ansiolíticos",
        "pastillas",
        "receta",
        "psiquiatra",
      ],
      today: ["hoy", "esta mañana", "esta tarde", "esta noche", "ahora mismo", "cuanto antes", "lo antes posible"],
    },
    en: {
      booking: "appointment",
      bookingVerb: "book",
      service: "session",
      place: "the practice",
      urgent: [
        "urgent",
        "urgently",
        "emergency",
        "crisis",
        "panic attack",
        "suicide",
        "kill myself",
        "end my life",
        "hurt myself",
        "harm myself",
        "self-harm",
        "want to die",
        "don't want to live",
        "i'm in danger",
        "diagnosis",
        "what is wrong with me",
        "what do i have",
        "am i ill",
        "medication",
        "medicine",
        "antidepressants",
        "anxiety pills",
        "pills",
        "prescription",
        "psychiatrist",
      ],
      today: ["today", "this morning", "this afternoon", "tonight", "right now", "asap", "as soon as possible"],
    },
  },
  voice: {
    es: {
      voice: "es-es-commercial-3",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: "Una recepcionista muy amable de Madrid en una consulta de psicología, serena, cálida y discreta, a ritmo pausado.",
    },
    en: {
      voice: "Callirrhoe",
      classicVoice: "Callirrhoe",
      languageCode: "en-US",
      style: "A warm, discreet receptionist at a Madrid psychology practice speaking English, calm and gentle, unhurried pace.",
    },
  },
  sensitiveTopics: {
    es: [
      "el motivo de la consulta: nunca preguntes por qué quiere venir ni cómo se encuentra, y si lo cuenta no lo comentes ni aconsejes",
      "cualquier diagnóstico o consulta clínica: qué le pasa al cliente, si es grave o qué tiene",
      "medicación: antidepresivos, ansiolíticos, dosis, recetas o psiquiatría",
      "salud mental en general, ansiedad, depresión, pánico, duelo o trastornos",
      "autolesión o suicidio: no aconsejes, di que llame ahora al uno, uno, dos o al cero, dos, cuatro",
    ],
    en: [
      "the reason for the consultation: never ask why they want to come or how they are feeling, and if they say, do not comment or advise",
      "any diagnosis or clinical question: what is wrong with the client, whether it is serious or what they have",
      "medication: antidepressants, anxiety pills, doses, prescriptions or psychiatry",
      "mental health in general, anxiety, depression, panic, grief or disorders",
      "self-harm or suicide: do not advise, tell them to call one, one, two or zero, two, four right now",
    ],
  },
  neverPromise: {
    es: [
      "un diagnóstico o una opinión clínica sobre lo que le pasa al cliente",
      "que la terapia vaya a curar, mejorar o dar un resultado",
      "cuántas sesiones hará falta o cuánto tardará en sentirse mejor",
      "recetar o recomendar medicación",
      "que un psicólogo concreto vaya a atender",
      "un precio que no esté en la lista",
    ],
    en: [
      "a diagnosis or a clinical opinion about what is wrong with the client",
      "that therapy will cure, improve or give a result",
      "how many sessions will be needed or how long until they feel better",
      "prescribing or recommending medication",
      "that a specific psychologist will see them",
      "a price that is not on the list",
    ],
  },
  starterCatalogue: psychologyPracticeCatalogue,
  starterFaq: [...commonFaq, confidentiality, invoice, crisisFaq],
};

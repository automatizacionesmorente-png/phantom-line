import { commonFaq } from "./starters/common";
import { physioClinicCatalogue } from "./starters/physioClinic";
import type { SectorPack, StarterFaqEntry } from "./types";

const comfortableClothes: StarterFaqEntry = {
  id: "ropa-comoda",
  aliases: {
    es: ["qué ropa llevo", "ropa cómoda", "qué llevar"],
    en: ["what to wear", "comfortable clothes", "what to bring"],
  },
  answer: {
    es: "Te recomendamos venir con ropa cómoda que te permita moverte.",
    en: "We recommend wearing comfortable clothes that let you move freely.",
  },
};

/**
 * Physiotherapy clinic (fisioterapia): appointments on treatment tables (camillas) in treatment
 * rooms. The receptionist never advises on a diagnosis, a medication or an injury, and never
 * triages: acute pain is flagged urgent for the owner by the code (owner-machine 5).
 */
export const physioClinic: SectorPack = {
  id: "physio-clinic",
  displayName: { es: "Clínica de fisioterapia", en: "Physiotherapy clinic" },
  unit: "appointment",
  resourceKind: {
    es: { one: "camilla", many: "camillas" },
    en: { one: "treatment room", many: "treatment rooms" },
  },
  requiredFields: ["service", "requestedTime", "name", "phone"],
  slotStepMin: 15,
  // "The service must fit before the session closes" is a general rule in lib/booking. A rule
  // about first visits needs to know which visit it is, and a pack rule only sees the service.
  rules: [],
  vocabulary: {
    // Acute pain and injury, plus the questions that ask for advice (diagnosis, medication): any of
    // them makes the Message urgent and turns the turn into a note, never an answer. Bare "dolor",
    // "lesión" and "me duele" are left out on purpose: "tengo dolor de espalda y quiero una cita"
    // is the ordinary booking, and the one-line reason is kept as the caller said it.
    es: {
      booking: "cita",
      bookingVerb: "reservar",
      service: "sesión",
      place: "la clínica",
      urgent: [
        "urgente",
        "urgentemente",
        "urgencia",
        "emergencia",
        "dolor agudo",
        "dolor fuerte",
        "mucho dolor",
        "dolor insoportable",
        "me duele mucho",
        "no puedo moverme",
        "no puedo caminar",
        "no puedo apoyar",
        "me he lesionado",
        "me he hecho daño",
        "me he caído",
        "esguince",
        "desgarro",
        "rotura",
        "luxación",
        "fractura",
        "hormigueo",
        "entumecimiento",
        "mareo",
        "diagnóstico",
        "qué me pasa",
        "qué tengo",
        "es grave",
        "qué me tomo",
        "puedo tomar",
        "medicación",
        "medicamento",
        "antiinflamatorio",
        "ibuprofeno",
        "paracetamol",
      ],
      today: ["hoy", "esta mañana", "esta tarde", "esta noche", "ahora mismo", "cuanto antes", "lo antes posible"],
    },
    en: {
      booking: "appointment",
      bookingVerb: "book",
      service: "session",
      place: "the clinic",
      urgent: [
        "urgent",
        "urgently",
        "emergency",
        "severe pain",
        "sharp pain",
        "terrible pain",
        "unbearable pain",
        "a lot of pain",
        "in agony",
        "can't move",
        "can't walk",
        "can't put weight",
        "i injured",
        "i hurt",
        "i fell",
        "sprain",
        "sprained",
        "torn",
        "tear",
        "dislocated",
        "fracture",
        "broken bone",
        "tingling",
        "numbness",
        "dizzy",
        "diagnosis",
        "what is wrong with me",
        "is it serious",
        "what should i take",
        "can i take",
        "medication",
        "medicine",
        "ibuprofen",
        "painkillers",
      ],
      today: ["today", "this morning", "this afternoon", "tonight", "right now", "asap", "as soon as possible"],
    },
  },
  voice: {
    es: {
      voice: "es-es-commercial-3",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: "Una recepcionista amable de Madrid en una clínica de fisioterapia, serena y cercana, a ritmo natural.",
    },
    en: {
      voice: "Callirrhoe",
      classicVoice: "Callirrhoe",
      languageCode: "en-US",
      style: "A calm, kind receptionist at a Madrid physiotherapy clinic speaking English, natural pace.",
    },
  },
  sensitiveTopics: {
    es: [
      "cualquier diagnóstico: qué le pasa al cliente, si es grave o qué tiene",
      "medicación: qué tomar, dosis, antiinflamatorios, analgésicos o infiltraciones",
      "lesiones y dolor: qué hacer con una lesión, si puede hacer ejercicio, frío o calor, o cuánto tardará en curarse",
      "embarazo, posoperatorios y cualquier otra consulta clínica",
    ],
    en: [
      "any diagnosis: what is wrong with the client, whether it is serious or what they have",
      "medication: what to take, doses, anti-inflammatories, painkillers or injections",
      "injuries and pain: what to do about an injury, whether they can exercise, ice or heat, or how long it will take to heal",
      "pregnancy, after surgery and any other clinical question",
    ],
  },
  neverPromise: {
    es: [
      "que el tratamiento vaya a curar, quitar el dolor o dar un resultado",
      "cuántas sesiones hará falta o cuánto tardará en recuperarse",
      "que un fisioterapeuta concreto vaya a atender",
      "un precio que no esté en la lista",
    ],
    en: [
      "that the treatment will cure, remove the pain or give a result",
      "how many sessions will be needed or how long recovery will take",
      "that a specific physiotherapist will see them",
      "a price that is not on the list",
    ],
  },
  starterCatalogue: physioClinicCatalogue,
  starterFaq: [...commonFaq, comfortableClothes],
};

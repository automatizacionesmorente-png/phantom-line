import { arriveEarlyFaq, commonFaq } from "./starters/common";
import { tutoringAcademyCatalogue } from "./starters/tutoringAcademy";
import type { SectorPack, StarterFaqEntry } from "./types";

const groupCourses: StarterFaqEntry = {
  id: "cursos-grupo",
  aliases: {
    es: ["clases en grupo", "cursos en grupo", "curso de grupo", "grupo de clase", "matrícula", "apuntarme a un curso"],
    en: ["group classes", "group courses", "group course", "enrol", "enrolment", "sign up for a course"],
  },
  answer: {
    es: "Aquí reservas clases particulares uno a uno; los cursos en grupo y la matrícula los gestiona la dirección, y te dejo el recado.",
    en: "Here you book one-to-one classes; group courses and enrolment are handled by the owner, and I can take a message.",
  },
};

/**
 * Tutoring academy (academia de clases): one-to-one appointments with teachers. Group courses are
 * not bookable; enrolment is the owner's, so the receptionist takes a message. She never promises
 * a grade or a pass.
 */
export const tutoringAcademy: SectorPack = {
  id: "tutoring-academy",
  displayName: { es: "Academia de clases", en: "Tutoring academy" },
  unit: "appointment",
  resourceKind: {
    es: { one: "profesor", many: "profesores" },
    en: { one: "teacher", many: "teachers" },
  },
  requiredFields: ["service", "requestedTime", "name", "phone"],
  slotStepMin: 30,
  // "The service must fit before the session closes" is a general rule in lib/booking.
  rules: [],
  vocabulary: {
    // A class has no real emergency; these only route a complaint or a question the receptionist
    // cannot answer (a grade, a pass) to the owner. Bare "examen" and "nota" are left out on
    // purpose: "quiero una clase para el examen" is the ordinary booking.
    es: {
      booking: "cita",
      bookingVerb: "reservar",
      service: "clase",
      place: "la academia",
      urgent: ["urgente", "urgentemente", "urgencia", "emergencia", "queja", "reclamación", "devolución", "devolver el dinero"],
      today: ["hoy", "esta mañana", "esta tarde", "esta noche", "ahora mismo", "cuanto antes", "lo antes posible"],
    },
    en: {
      booking: "appointment",
      bookingVerb: "book",
      service: "class",
      place: "the academy",
      urgent: ["urgent", "urgently", "emergency", "complaint", "complain", "refund", "get my money back"],
      today: ["today", "this morning", "this afternoon", "tonight", "right now", "asap", "as soon as possible"],
    },
  },
  voice: {
    es: {
      voice: "es-es-commercial-3",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: "Una persona amable y organizada de Madrid que atiende en una academia de clases, cercana y clara, a ritmo natural.",
    },
    en: {
      voice: "Callirrhoe",
      classicVoice: "Callirrhoe",
      languageCode: "en-US",
      style: "A friendly, organised person at a Madrid tutoring academy speaking English, clear and approachable, natural pace.",
    },
  },
  sensitiveTopics: {
    es: [
      "cualquier queja, reclamación o petición de devolución de dinero",
      "el nivel o el rendimiento de un alumno: si va bien o mal, si necesita refuerzo o qué le pasa",
      "dificultades de aprendizaje, diagnósticos o necesidades especiales de un alumno",
    ],
    en: [
      "any complaint, claim or request for a refund",
      "a student's level or performance: whether they are doing well or badly, whether they need extra help or what is wrong",
      "learning difficulties, diagnoses or special needs of a student",
    ],
  },
  neverPromise: {
    es: [
      "que el alumno vaya a aprobar, sacar una nota o pasar la selectividad",
      "cuántas clases hará falta o cuánto tardará en mejorar",
      "que un profesor concreto vaya a dar la clase",
      "plaza o precio de un curso en grupo",
      "un precio que no esté en la lista",
    ],
    en: [
      "that the student will pass, get a grade or pass the university entrance exam",
      "how many classes will be needed or how long until they improve",
      "that a specific teacher will give the class",
      "a place or a price in a group course",
      "a price that is not on the list",
    ],
  },
  starterCatalogue: tutoringAcademyCatalogue,
  starterFaq: [...commonFaq, arriveEarlyFaq, groupCourses],
};

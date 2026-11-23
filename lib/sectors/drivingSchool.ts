import { arriveEarlyFaq, commonFaq } from "./starters/common";
import { drivingSchoolCatalogue } from "./starters/drivingSchool";
import type { SectorPack, StarterFaqEntry } from "./types";

const enrolment: StarterFaqEntry = {
  id: "matricula-teorico",
  aliases: {
    es: ["matrícula", "matricularme", "apuntarme", "sacarme el carnet", "el teórico", "clases de teoría", "curso teórico"],
    en: ["enrol", "enrolment", "sign up", "theory course", "theory classes", "theory test course"],
  },
  answer: {
    es: "La matrícula y el curso teórico se hacen en la oficina; te dejo el recado para que te llamen.",
    en: "Enrolment and the theory course are done at the office; I can leave a message for them to call you.",
  },
};

const permitB: StarterFaqEntry = {
  id: "permiso-b",
  aliases: {
    es: ["permiso B", "carnet de coche", "carnet B", "qué carnets sacáis"],
    en: ["B licence", "car licence", "which licences", "car driving licence"],
  },
  answer: {
    es: "Preparamos el permiso B, el carnet de coche.",
    en: "We prepare you for the B licence, the car driving licence.",
  },
};

const examDates: StarterFaqEntry = {
  id: "fecha-examen",
  aliases: {
    es: ["fecha del examen", "cuándo es mi examen", "cuándo me examino", "presentarme al examen"],
    en: ["exam date", "when is my exam", "when is my test", "book my test"],
  },
  answer: {
    es: "Las fechas de examen las fija la DGT y las gestiona la oficina; yo no puedo confirmarlas.",
    en: "Exam dates are set by the DGT and handled by the office; I cannot confirm them.",
  },
};

/**
 * Driving school (autoescuela): appointments for practical lessons with instructors. Enrolment and
 * the theory course are handled by the owner in the office, so the receptionist takes a message.
 * She never promises a pass in the DGT exam nor an exam date.
 */
export const drivingSchool: SectorPack = {
  id: "driving-school",
  displayName: { es: "Autoescuela", en: "Driving school" },
  unit: "appointment",
  visitNoteLabel: { es: "Lo trabajado en clase", en: "What we covered" },
  resourceKind: {
    es: { one: "profesor", many: "profesores" },
    en: { one: "instructor", many: "instructors" },
  },
  requiredFields: ["service", "requestedTime", "name", "phone"],
  slotStepMin: 15,
  // "The service must fit before the session closes" is a general rule in lib/booking.
  rules: [],
  vocabulary: {
    // A lesson has no real emergency; these only route a complaint or an accident to the owner.
    // Bare "examen" and "suspenso" are left out on purpose: "una clase antes del examen" is the
    // ordinary booking.
    es: {
      booking: "cita",
      bookingVerb: "reservar",
      service: "clase",
      place: "la autoescuela",
      urgent: ["urgente", "urgentemente", "urgencia", "emergencia", "accidente", "queja", "reclamación", "devolución"],
      today: ["hoy", "esta mañana", "esta tarde", "esta noche", "ahora mismo", "cuanto antes", "lo antes posible"],
    },
    en: {
      booking: "appointment",
      bookingVerb: "book",
      service: "lesson",
      place: "the driving school",
      urgent: ["urgent", "urgently", "emergency", "accident", "complaint", "complain", "refund"],
      today: ["today", "this morning", "this afternoon", "tonight", "right now", "asap", "as soon as possible"],
    },
  },
  voice: {
    es: {
      voice: "es-es-commercial-3",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: "Una persona simpática y paciente de Madrid que atiende en una autoescuela, cercana y tranquilizadora, a ritmo natural.",
    },
    en: {
      voice: "Callirrhoe",
      classicVoice: "Callirrhoe",
      languageCode: "en-US",
      style: "A friendly, patient person at a Madrid driving school speaking English, reassuring, natural pace.",
    },
  },
  sensitiveTopics: {
    es: [
      "cualquier queja, reclamación o accidente durante una clase",
      "si el alumno está listo para el examen o cuántas clases necesita",
      "salud, visión, medicación o discapacidad para sacar el carnet",
    ],
    en: [
      "any complaint, claim or accident during a lesson",
      "whether the student is ready for the test or how many lessons they need",
      "health, eyesight, medication or disability for getting a licence",
    ],
  },
  neverPromise: {
    es: [
      "que el alumno vaya a aprobar el examen de la DGT, teórico o práctico",
      "una fecha de examen",
      "cuántas clases hará falta o cuánto tardará en sacarse el carnet",
      "que un profesor concreto vaya a dar la clase",
      "un precio que no esté en la lista",
    ],
    en: [
      "that the student will pass the DGT exam, theory or practical",
      "an exam date",
      "how many lessons will be needed or how long it will take to get the licence",
      "that a specific instructor will give the lesson",
      "a price that is not on the list",
    ],
  },
  starterCatalogue: drivingSchoolCatalogue,
  starterFaq: [...commonFaq, arriveEarlyFaq, enrolment, permitB, examDates],
};

import { beautyCentreCatalogue } from "./starters/beautyCentre";
import { arriveEarlyFaq, commonFaq } from "./starters/common";
import type { SectorPack } from "./types";

/** Beauty and nails centre (centro de estética): appointments in treatment rooms (cabinas). */
export const beautyCentre: SectorPack = {
  id: "beauty-centre",
  displayName: { es: "Centro de estética y uñas", en: "Beauty and nails centre" },
  unit: "appointment",
  visitNoteLabel: { es: "Fórmula del color / notas", en: "Colour formula / notes" },
  resourceKind: {
    es: { one: "cabina", many: "cabinas" },
    en: { one: "room", many: "rooms" },
  },
  requiredFields: ["service", "requestedTime", "name", "phone"],
  slotStepMin: 15,
  // "The service must fit before the session closes" is a general rule in lib/booking.
  rules: [],
  vocabulary: {
    // Reactions to wax, gel, glue or tints are the centre's real emergency. Not clinical
    // diagnoses: the receptionist takes a message and the owner calls back.
    es: {
      booking: "cita",
      bookingVerb: "reservar",
      service: "tratamiento",
      place: "el centro",
      urgent: [
        "urgente",
        "urgentemente",
        "urgencia",
        "emergencia",
        "alergia",
        "alérgico",
        "alérgica",
        "reacción",
        "me pica",
        "me escuece",
        "irritación",
        "quemadura",
        "me quema",
        "infección",
        "hongos",
        "dolor",
      ],
      today: ["hoy", "esta mañana", "esta tarde", "esta noche", "ahora mismo", "cuanto antes", "lo antes posible"],
      notUrgent: ["prueba de alergia", "test de alergia", "prueba de parche"],
    },
    en: {
      booking: "appointment",
      bookingVerb: "book",
      service: "treatment",
      place: "the centre",
      urgent: [
        "urgent",
        "urgently",
        "emergency",
        "allergy",
        "allergic",
        "reaction",
        "itching",
        "stinging",
        "irritation",
        "burn",
        "burning",
        "infection",
        "fungus",
        "pain",
      ],
      today: ["today", "this morning", "this afternoon", "tonight", "right now", "asap", "as soon as possible"],
      notUrgent: ["allergy test", "patch test"],
    },
  },
  voice: {
    es: {
      voice: "es-es-commercial-3",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: "Una recepcionista amable de Madrid en un centro de estética, serena, a ritmo natural y sonriendo.",
    },
    en: {
      voice: "Callirrhoe",
      classicVoice: "Callirrhoe",
      languageCode: "en-US",
      style: "A friendly receptionist at a Madrid beauty centre speaking English, calm, natural pace, smiling.",
    },
  },
  sensitiveTopics: {
    es: [
      "alergias, irritaciones o reacciones de la piel a ceras, geles, pegamentos, tintes o cremas",
      "hongos, infecciones o problemas de las uñas o de la piel, y cualquier consejo médico",
      "tratamientos durante el embarazo, la lactancia o con medicación",
    ],
    en: [
      "allergies, irritation or skin reactions to wax, gel, glue, tints or creams",
      "fungus, infections or problems of the nails or skin, and any medical advice",
      "treatments during pregnancy, breastfeeding or while on medication",
    ],
  },
  neverPromise: {
    es: [
      "un resultado concreto, como quitar una cicatriz, adelgazar o que no vuelva a salir el vello",
      "cuánto durará una manicura semipermanente, unas extensiones o un tratamiento",
      "un precio que no esté en la lista",
    ],
    en: [
      "a specific result, such as removing a scar, losing weight or hair never growing back",
      "how long a gel manicure, extensions or a treatment will last",
      "a price that is not on the list",
    ],
  },
  starterCatalogue: beautyCentreCatalogue,
  starterFaq: [...commonFaq, arriveEarlyFaq],
};

import { barberShopCatalogue } from "./starters/barberShop";
import { arriveEarlyFaq, commonFaq } from "./starters/common";
import type { SectorPack } from "./types";

/** Barber shop (barbería): appointments on chairs. */
export const barberShop: SectorPack = {
  id: "barber-shop",
  displayName: { es: "Barbería", en: "Barber shop" },
  unit: "appointment",
  visitNoteLabel: { es: "Fórmula del color / notas", en: "Colour formula / notes" },
  resourceKind: {
    es: { one: "sillón", many: "sillones" },
    en: { one: "chair", many: "chairs" },
  },
  requiredFields: ["service", "requestedTime", "name", "phone"],
  slotStepMin: 15,
  // "The service must fit before the session closes" is a general rule in lib/booking.
  rules: [],
  vocabulary: {
    // A reaction to a product or a razor is the barber's real emergency. Bare "ahora" / "now" and
    // bare "corte" / "cut" are left out on purpose: "un corte" is what every caller asks for.
    es: {
      booking: "cita",
      bookingVerb: "reservar",
      service: "servicio",
      place: "la barbería",
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
        "irritación",
        "quemadura",
        "me quema",
        "me escuece",
        "dolor",
      ],
      today: ["hoy", "esta mañana", "esta tarde", "esta noche", "ahora mismo", "cuanto antes", "lo antes posible"],
      notUrgent: ["prueba de alergia", "test de alergia"],
    },
    en: {
      booking: "appointment",
      bookingVerb: "book",
      service: "service",
      place: "the barber shop",
      urgent: ["urgent", "urgently", "emergency", "allergy", "allergic", "reaction", "itching", "irritation", "burn", "burning", "stinging", "pain"],
      today: ["today", "this morning", "this afternoon", "tonight", "right now", "asap", "as soon as possible"],
      notUrgent: ["allergy test", "patch test"],
    },
  },
  voice: {
    es: {
      voice: "es-es-commercial-3",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: "Una persona simpática de Madrid que atiende en una barbería, relajada, a ritmo natural y sonriendo.",
    },
    en: {
      voice: "Callirrhoe",
      classicVoice: "Callirrhoe",
      languageCode: "en-US",
      style: "A friendly person at a Madrid barber shop speaking English, relaxed, natural pace, smiling.",
    },
  },
  sensitiveTopics: {
    es: [
      "caída del pelo, alopecia, caspa, problemas del cuero cabelludo o cualquier consejo médico",
      "alergias, irritaciones o reacciones de la piel a productos, cuchillas o tintes",
      "cualquier cosa de la piel de la cara, como granos, heridas o foliculitis",
    ],
    en: [
      "hair loss, alopecia, dandruff, scalp problems or any medical advice",
      "allergies, irritation or skin reactions to products, razors or dyes",
      "anything about the skin of the face, such as spots, cuts or razor bumps",
    ],
  },
  neverPromise: {
    es: [
      "un resultado o un corte concreto, como el de una foto",
      "que el pelo o la barba vayan a crecer más o más rápido",
      "cuánto durará un tinte de barba",
      "un precio que no esté en la lista",
    ],
    en: [
      "a specific result or a cut as in a photo",
      "that hair or beard will grow back thicker or faster",
      "how long a beard colour will last",
      "a price that is not on the list",
    ],
  },
  starterCatalogue: barberShopCatalogue,
  starterFaq: [...commonFaq, arriveEarlyFaq],
};

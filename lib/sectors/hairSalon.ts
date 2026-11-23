import { hairSalonCatalogue } from "./starters/hairSalon";
import { arriveEarlyFaq, commonFaq } from "./starters/common";
import type { SectorPack } from "./types";

/** Hair salon (Peluquería Lola): appointments on chairs. */
export const hairSalon: SectorPack = {
  id: "hair-salon",
  displayName: { es: "Peluquería", en: "Hair salon" },
  unit: "appointment",
  resourceKind: {
    es: { one: "sillón", many: "sillones" },
    en: { one: "chair", many: "chairs" },
  },
  requiredFields: ["service", "requestedTime", "name", "phone"],
  slotStepMin: 15,
  // "The service must fit before the session closes" is a general rule in lib/booking.
  rules: [],
  vocabulary: {
    // Urgency_Terms (owner-machine design, "Pack data"). A reaction to a dye is the salon's real
    // emergency, hence the allergy and burn terms. Bare "ahora" / "now" are left out on purpose:
    // "ahora mismo no puedo" and "I now want…" would mark half the calls as same-day.
    es: {
      booking: "cita",
      bookingVerb: "reservar",
      service: "servicio",
      place: "la peluquería",
      urgent: [
        "urgente",
        "urgentemente",
        "urgencia",
        "emergencia",
        "alergia",
        "alérgica",
        "alérgico",
        "reacción",
        "me pica",
        "quemadura",
        "me quema",
        "dolor",
      ],
      today: ["hoy", "esta mañana", "esta tarde", "esta noche", "ahora mismo", "cuanto antes", "lo antes posible"],
      // A question about the allergy test is not urgent; "me ha dado alergia" still is (front-desk-brain 16.5).
      notUrgent: ["prueba de alergia", "test de alergia", "prueba del tinte"],
    },
    en: {
      booking: "appointment",
      bookingVerb: "book",
      service: "service",
      place: "the salon",
      urgent: ["urgent", "urgently", "emergency", "allergy", "allergic", "reaction", "itching", "burn", "burning", "pain"],
      today: ["today", "this morning", "this afternoon", "tonight", "right now", "asap", "as soon as possible"],
      notUrgent: ["allergy test", "patch test"],
    },
  },
  voice: {
    // Chosen by the owner after the spike (natural-voice task 2.1): Castilian, "warm and
    // engaging", on gemini-3.8-flash-tts and gemini-3.8-flash-lite-tts. Kore on other models.
    // The style keeps "a ritmo natural": task 3.8 rejected the "algo ágil" pace words, which
    // changed nothing on gemini-3.8-flash-tts (design.md "Pace"). The pace comes from speechRate.
    es: {
      voice: "es-es-commercial-3",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: "Una peluquera simpática de Madrid, relajada, a ritmo natural y sonriendo.",
    },
    // Provisional until the English audition (task 2.4) picks the voice: Callirrhoe is the
    // first candidate in design.md ("easy-going, relaxed, casual"), a classic name on every model.
    en: {
      voice: "Callirrhoe",
      classicVoice: "Callirrhoe",
      languageCode: "en-US",
      style: "A friendly hairdresser in Madrid speaking English, relaxed, natural pace, smiling.",
    },
  },
  sensitiveTopics: {
    es: [
      "caída del pelo, problemas del cuero cabelludo o cualquier consejo médico",
      "alergias o reacciones de la piel a tintes y productos",
      "tratamientos durante el embarazo",
    ],
    en: [
      "hair loss, scalp problems or any medical advice",
      "allergies or skin reactions to dyes and products",
      "treatments during pregnancy",
    ],
  },
  neverPromise: {
    es: [
      "un resultado o un color concreto (por ejemplo, rubio platino)",
      "cuánto durará un tinte o un tratamiento",
      "un precio que no esté en la lista",
    ],
    en: [
      "a specific result or colour (for example, platinum blonde)",
      "how long a colour or treatment will last",
      "a price that is not on the list",
    ],
  },
  starterCatalogue: hairSalonCatalogue,
  starterFaq: [...commonFaq, arriveEarlyFaq],
};

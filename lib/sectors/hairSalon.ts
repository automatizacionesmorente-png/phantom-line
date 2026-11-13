import type { SectorPack } from "./types";

/** Hair salon (Peluquería Lola): appointments on chairs. */
export const hairSalon: SectorPack = {
  id: "hair-salon",
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
    es: { booking: "cita", bookingVerb: "reservar", service: "servicio", place: "la peluquería" },
    en: { booking: "appointment", bookingVerb: "book", service: "service", place: "the salon" },
  },
  voice: {
    // Chosen by the owner after the spike (natural-voice task 2.1): Castilian, "warm and
    // engaging", on gemini-3.8-flash-tts and gemini-3.8-flash-lite-tts. Kore on other models.
    // The style keeps "a ritmo natural" until task 3.8 decides the pace (see design.md "Pace").
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
};

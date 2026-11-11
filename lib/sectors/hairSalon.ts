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
    es: { booking: "cita", bookingVerb: "reservar", service: "servicio" },
    en: { booking: "appointment", bookingVerb: "book", service: "service" },
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

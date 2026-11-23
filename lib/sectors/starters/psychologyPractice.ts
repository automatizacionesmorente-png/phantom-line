import type { StarterCatalogue } from "../types";

/**
 * Psychology practice starter catalogue (Spain, 2026 estimate; the owner edits prices and
 * durations). Names say what is booked, never why: the receptionist never asks the reason for the
 * consultation and records no mental-health detail. A bare "sesión" or "terapia" is a Category
 * word, so the receptionist asks which one. No alias is shared by two services.
 */
export const psychologyPracticeCatalogue: StarterCatalogue = {
  categories: [
    {
      id: "primeras",
      name: { es: "primeras consultas", en: "first consultations" },
      aliases: ["consulta", "consultas", "visita", "visit", "consultation", "consultations"],
    },
    {
      id: "sesiones",
      name: { es: "sesiones", en: "sessions" },
      aliases: ["sesión", "sesiones", "terapia", "terapias", "session", "sessions", "therapy", "counselling"],
    },
  ],
  services: [
    {
      id: "primera-consulta",
      name: { es: "Primera consulta", en: "First consultation" },
      spokenName: { es: "una primera consulta", en: "a first consultation" },
      category: "primeras",
      durationMin: 50,
      priceCents: 5500,
      aliases: [
        "primera consulta",
        "primera sesión",
        "primera visita",
        "primera cita",
        "nunca he ido",
        "soy nuevo",
        "soy nueva",
        "first consultation",
        "first session",
        "first appointment",
        "first visit",
        "new client",
        "never been before",
      ],
    },
    {
      id: "sesion-individual",
      name: { es: "Sesión individual", en: "Individual session" },
      spokenName: { es: "una sesión individual", en: "an individual session" },
      category: "sesiones",
      durationMin: 50,
      priceCents: 6000,
      aliases: [
        "sesión individual",
        "terapia individual",
        "sesión de psicología",
        "sesión con el psicólogo",
        "sesión de seguimiento",
        "sesión para mí",
        "individual session",
        "individual therapy",
        "one-to-one session",
        "one to one session",
        "therapy session",
        "follow-up session",
      ],
    },
    {
      id: "terapia-pareja",
      name: { es: "Terapia de pareja", en: "Couples therapy" },
      spokenName: { es: "una sesión de terapia de pareja", en: "a couples therapy session" },
      category: "sesiones",
      durationMin: 75,
      priceCents: 8000,
      aliases: [
        "terapia de pareja",
        "terapia para parejas",
        "sesión de pareja",
        "sesión para dos",
        "vamos los dos",
        "couples therapy",
        "couples session",
        "couples counselling",
        "relationship counselling",
        "session for two",
        "we are coming as a couple",
      ],
    },
    {
      id: "sesion-online",
      name: { es: "Sesión online", en: "Online session" },
      spokenName: { es: "una sesión online", en: "an online session" },
      category: "sesiones",
      durationMin: 50,
      priceCents: 5500,
      aliases: [
        "sesión online",
        "terapia online",
        "sesión por videollamada",
        "por videollamada",
        "sesión a distancia",
        "desde casa",
        "online session",
        "online therapy",
        "video session",
        "video call session",
        "remote session",
        "from home",
      ],
    },
  ],
};

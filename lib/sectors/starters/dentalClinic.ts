import type { StarterCatalogue } from "../types";

/**
 * Dental clinic starter catalogue (Spain, 2026 estimate; the owner edits prices and durations).
 * Names say what is booked, never what is wrong with the caller: the receptionist gives no
 * clinical advice. A bare "consulta" or "tratamiento" is a Category word, so the receptionist
 * asks which one. No alias is shared by two services.
 */
export const dentalClinicCatalogue: StarterCatalogue = {
  categories: [
    {
      id: "consultas",
      name: { es: "consultas", en: "consultations" },
      aliases: ["consultas", "consulta", "visita", "visit", "consultation", "consultations"],
    },
    {
      id: "tratamientos",
      name: { es: "tratamientos", en: "treatments" },
      aliases: ["tratamiento", "tratamientos", "treatment", "treatments", "procedure"],
    },
  ],
  services: [
    {
      id: "primera-visita",
      name: { es: "Primera visita", en: "First visit" },
      spokenName: { es: "una primera visita", en: "a first visit" },
      category: "consultas",
      goesWith: ["limpieza"],
      durationMin: 30,
      priceCents: 3000,
      aliases: ["primera visita", "primera consulta", "nunca he ido", "soy nuevo", "soy nueva", "first visit", "first appointment", "new patient", "initial consultation"],
    },
    {
      id: "revision",
      name: { es: "Revisión dental", en: "Check-up" },
      spokenName: { es: "una revisión dental", en: "a dental check-up" },
      category: "consultas",
      goesWith: ["limpieza"],
      durationMin: 30,
      priceCents: 3500,
      aliases: ["revisión dental", "revisión", "revisión de boca", "chequeo", "chequeo dental", "revisarme la boca", "check-up", "checkup", "dental check-up", "dental checkup", "dental exam", "routine check-up"],
    },
    {
      id: "limpieza",
      name: { es: "Limpieza dental", en: "Dental cleaning" },
      spokenName: { es: "una limpieza dental", en: "a dental cleaning" },
      category: "tratamientos",
      goesWith: ["revision"],
      durationMin: 45,
      priceCents: 5500,
      aliases: ["limpieza dental", "limpieza", "limpieza de boca", "higiene dental", "profilaxis", "dental cleaning", "teeth cleaning", "cleaning", "scale and polish", "hygienist"],
    },
    {
      id: "empaste",
      name: { es: "Empaste", en: "Filling" },
      spokenName: { es: "un empaste", en: "a filling" },
      category: "tratamientos",
      priceFrom: true,
      durationMin: 45,
      priceCents: 6000,
      aliases: ["empaste", "empastar", "empastarme", "arreglar una caries", "caries", "filling", "get a filling", "cavity", "fill a cavity"],
    },
    {
      id: "endodoncia",
      name: { es: "Endodoncia", en: "Root canal" },
      spokenName: { es: "una endodoncia", en: "a root canal" },
      category: "tratamientos",
      priceFrom: true,
      durationMin: 75,
      priceCents: 15000,
      aliases: ["endodoncia", "matar el nervio", "tratamiento de conductos", "root canal", "root canal treatment", "endodontics"],
    },
    {
      id: "extraccion",
      name: { es: "Extracción", en: "Extraction" },
      spokenName: { es: "una extracción", en: "an extraction" },
      category: "tratamientos",
      priceFrom: true,
      durationMin: 30,
      priceCents: 7000,
      aliases: ["extracción", "extraer", "sacar una muela", "sacar un diente", "sacarme una muela", "muela del juicio", "extraction", "tooth extraction", "tooth removal", "wisdom tooth", "pull a tooth"],
    },
    {
      id: "blanqueamiento",
      name: { es: "Blanqueamiento dental", en: "Teeth whitening" },
      spokenName: { es: "un blanqueamiento dental", en: "a teeth whitening" },
      category: "tratamientos",
      priceFrom: true,
      durationMin: 60,
      priceCents: 25000,
      aliases: ["blanqueamiento dental", "blanqueamiento", "blanquear los dientes", "dientes más blancos", "teeth whitening", "whitening", "whiten my teeth", "tooth whitening"],
    },
    {
      id: "revision-ortodoncia",
      name: { es: "Revisión de ortodoncia", en: "Orthodontic check" },
      spokenName: { es: "una revisión de ortodoncia", en: "an orthodontic check" },
      category: "consultas",
      durationMin: 30,
      priceCents: 6000,
      aliases: ["revisión de ortodoncia", "ortodoncia", "brackets", "aparato", "alineadores", "invisalign", "orthodontic check", "orthodontics", "braces", "aligners", "braces check"],
    },
    {
      id: "consulta-implantes",
      name: { es: "Valoración de implantes", en: "Implant assessment" },
      spokenName: { es: "una valoración de implantes", en: "an implant assessment" },
      category: "consultas",
      durationMin: 45,
      priceCents: 4000,
      aliases: ["valoración de implantes", "implantes", "implante dental", "poner un implante", "implant assessment", "implants", "dental implant", "implant consultation"],
    },
  ],
};

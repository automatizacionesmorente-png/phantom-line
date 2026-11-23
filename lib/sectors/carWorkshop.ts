import { carWorkshopCatalogue } from "./starters/carWorkshop";
import { arriveEarlyFaq, commonFaq } from "./starters/common";
import type { SectorPack, StarterFaqEntry } from "./types";

const faq: StarterFaqEntry[] = [
  {
    id: "coche-sustitucion",
    aliases: {
      es: ["coche de sustitución", "coche de cortesía", "vehículo de sustitución", "coche prestado"],
      en: ["courtesy car", "replacement car", "loan car", "substitute car"],
    },
    answer: {
      es: "Depende de la disponibilidad de cada día, y te lo confirma el taller al traer el coche.",
      en: "It depends on what is available each day, and the workshop will confirm it when you bring the car in.",
    },
  },
  {
    id: "dejar-primera-hora",
    aliases: {
      es: ["dejar el coche a primera hora", "dejar el coche antes de abrir", "dejar las llaves", "dejarlo por la noche"],
      en: ["drop the car off early", "leave the car first thing", "leave the keys", "drop off before opening"],
    },
    answer: {
      es: "Puedes traerlo a la hora de tu cita; si necesitas dejarlo antes, dínoslo al reservar.",
      en: "You can bring it at the time of your appointment; if you need to leave it earlier, tell us when you book.",
    },
  },
  {
    id: "presupuesto",
    aliases: {
      es: ["presupuesto", "presupuesto sin compromiso", "cuánto me costará la reparación"],
      en: ["quote", "free quote", "estimate", "no-obligation quote"],
    },
    answer: {
      es: "Te damos un presupuesto sin compromiso cuando el mecánico ha visto el coche.",
      en: "We give you a no-obligation quote once the mechanic has seen the car.",
    },
  },
];

/**
 * Car repair shop (taller mecánico): appointments on mechanics' lifts and bays. The receptionist
 * never diagnoses a fault, never says a car is safe to drive and never quotes a repair: callers
 * who say the car will not start, smokes or has no brakes are flagged urgent for the owner by the
 * code (owner-machine 5).
 */
export const carWorkshop: SectorPack = {
  id: "car-workshop",
  displayName: { es: "Taller mecánico", en: "Car repair shop" },
  unit: "appointment",
  resourceKind: {
    es: { one: "mecánico", many: "mecánicos" },
    en: { one: "mechanic", many: "mechanics" },
  },
  requiredFields: ["service", "requestedTime", "name", "phone"],
  slotStepMin: 30,
  // "The service must fit before the session closes" is a general rule in lib/booking.
  rules: [],
  vocabulary: {
    // A car that will not start, smokes or does not brake is the workshop's real emergency. Bare
    // "avería", "ruido" and "testigo" are left out on purpose: "tengo una avería y quiero cita" and
    // "me sale un testigo" are the ordinary booking.
    es: {
      booking: "cita",
      bookingVerb: "reservar",
      service: "servicio",
      place: "el taller",
      urgent: [
        "urgente",
        "urgentemente",
        "urgencia",
        "emergencia",
        "no arranca",
        "no me arranca",
        "se ha parado",
        "se me ha parado",
        "se ha calado",
        "humo",
        "huele a quemado",
        "no frena",
        "no frenan",
        "sin frenos",
        "pierde aceite",
        "pierde líquido",
        "se ha calentado",
        "recalentado",
        "accidente",
        "me he quedado tirado",
        "me he quedado tirada",
        "grúa",
      ],
      today: ["hoy", "esta mañana", "esta tarde", "esta noche", "ahora mismo", "cuanto antes", "lo antes posible"],
    },
    en: {
      booking: "appointment",
      bookingVerb: "book",
      service: "service",
      place: "the workshop",
      urgent: [
        "urgent",
        "urgently",
        "emergency",
        "won't start",
        "doesn't start",
        "does not start",
        "has stalled",
        "stalled",
        "smoke",
        "smoking",
        "burning smell",
        "brakes don't work",
        "no brakes",
        "not braking",
        "leaking oil",
        "leaking fluid",
        "overheated",
        "overheating",
        "accident",
        "broken down",
        "tow truck",
      ],
      today: ["today", "this morning", "this afternoon", "tonight", "right now", "asap", "as soon as possible"],
    },
  },
  voice: {
    es: {
      voice: "es-es-commercial-3",
      classicVoice: "Kore",
      languageCode: "es-ES",
      style: "Una persona resolutiva y amable de Madrid que atiende en un taller mecánico, tranquila y clara, a ritmo natural.",
    },
    en: {
      voice: "Callirrhoe",
      classicVoice: "Callirrhoe",
      languageCode: "en-US",
      style: "A helpful, friendly person at a Madrid car workshop speaking English, calm and clear, natural pace.",
    },
  },
  sensitiveTopics: {
    es: [
      "cualquier diagnóstico de una avería: qué le pasa al coche, qué pieza falla o cuánto costará arreglarlo",
      "si el coche es seguro, si puede seguir circulando o si pasará la ITV",
      "garantías, reclamaciones, siniestros y seguros",
      "humo, frenos, fugas o cualquier avería peligrosa mientras conduce",
    ],
    en: [
      "any diagnosis of a fault: what is wrong with the car, which part is failing or how much it will cost to fix",
      "whether the car is safe, whether it can keep being driven or whether it will pass the ITV",
      "warranties, complaints, accident claims and insurance",
      "smoke, brakes, leaks or any dangerous fault while driving",
    ],
  },
  neverPromise: {
    es: [
      "el precio final de una reparación sin que el mecánico haya visto el coche",
      "que una pieza esté en stock o llegue en un día concreto",
      "que el coche vaya a pasar la ITV",
      "cuánto tardará una reparación que no esté en la lista",
      "que un mecánico concreto vaya a atender",
    ],
    en: [
      "the final price of a repair before the mechanic has seen the car",
      "that a part is in stock or will arrive on a given day",
      "that the car will pass the ITV",
      "how long a repair that is not on the list will take",
      "that a specific mechanic will see them",
    ],
  },
  starterCatalogue: carWorkshopCatalogue,
  starterFaq: [...commonFaq, arriveEarlyFaq, ...faq],
};

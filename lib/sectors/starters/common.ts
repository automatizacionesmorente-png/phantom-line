import type { StarterFaqEntry } from "../types";

/**
 * The everyday answers every appointment business gets, as a starting point: prices, payment,
 * parking, cancellation and accessibility. The wizard shows them to the owner, who edits them
 * before going live. In Spoken_Form (no digits, at most two short sentences), and they claim
 * nothing about the premises that an owner has not confirmed: parking and accessibility say what
 * is usually true and ask the caller to say so when booking.
 */
export const commonFaq: readonly StarterFaqEntry[] = [
  {
    id: "tarifas",
    aliases: {
      es: ["tarifas", "lista de precios", "carta de precios"],
      en: ["price list", "rates", "price range"],
    },
    answer: {
      es: "Los precios dependen del servicio; dime cuál te interesa y te digo cuánto cuesta.",
      en: "Prices depend on the service; tell me which one you want and I will tell you the price.",
    },
  },
  {
    id: "pago",
    aliases: {
      es: ["pagar con tarjeta", "bizum", "efectivo", "formas de pago", "cómo se paga", "aceptáis tarjeta"],
      en: ["pay by card", "payment", "cash", "do you take cards"],
    },
    answer: {
      es: "Puedes pagar con tarjeta, con Bizum o en efectivo.",
      en: "You can pay by card, with Bizum or in cash.",
    },
  },
  {
    id: "parking",
    aliases: {
      es: ["aparcar", "parking", "aparcamiento", "dónde dejo el coche"],
      en: ["park the car", "car park", "where can I park"],
    },
    answer: {
      es: "No tenemos aparcamiento propio, pero suele haber parkings públicos cerca.",
      en: "We have no parking of our own, but there are usually public car parks nearby.",
    },
  },
  {
    id: "cancelacion",
    aliases: {
      es: ["política de cancelación", "si no puedo ir", "penalización", "no presentarme"],
      en: ["cancellation policy", "cancel fee", "if I can't make it", "no-show fee"],
    },
    answer: {
      es: "Puedes cambiar o anular tu cita sin coste hasta veinticuatro horas antes, llamando a este mismo número.",
      en: "You can change or cancel your appointment free of charge up to twenty-four hours before, by calling this same number.",
    },
  },
  {
    id: "accesibilidad",
    aliases: {
      es: ["silla de ruedas", "escalones", "accesible", "accesibilidad", "carrito de bebé"],
      en: ["wheelchair", "step-free", "accessible", "accessibility", "stroller"],
    },
    answer: {
      es: "Si necesitas acceso adaptado, dínoslo al reservar y te lo confirmamos antes de tu cita.",
      en: "If you need step-free access, tell us when you book and we will confirm it before your appointment.",
    },
  },
];

/** "Cuánto antes llego": the same harmless answer in every sector. */
export const arriveEarlyFaq: StarterFaqEntry = {
  id: "llegar-antes",
  aliases: {
    es: ["cuánto antes llego", "llegar antes", "con cuánta antelación"],
    en: ["how early", "arrive early"],
  },
  answer: {
    es: "Con llegar cinco minutos antes es suficiente.",
    en: "Arriving five minutes early is enough.",
  },
};

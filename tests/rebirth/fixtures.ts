import type { CreateRequest, Draft } from "@/lib/rebirth/draft";

const day = [
  { open: "10:00", close: "14:00" },
  { open: "17:00", close: "20:00" },
];

/** A valid draft: a Madrid barbershop, two chairs, one split-hours week. */
export function validDraft(over: Partial<Draft> = {}): Draft {
  return {
    sectorId: "hair-salon",
    business: {
      name: "Barbería Paco",
      address: "Calle Mayor 12",
      city: "Madrid",
      timeZone: "Europe/Madrid",
      languages: ["es", "en"],
      ownerName: "Paco",
    },
    team: { members: ["Sillón 1", "Sillón 2"], concurrent: 2 },
    hours: { 1: day, 2: day, 3: day, 4: day, 5: day, 6: [{ open: "10:00", close: "14:00" }] },
    services: [
      { name: "Corte de hombre", nameEn: "Men's cut", durationMin: 30, priceEur: 14, from: false },
      { name: "Tinte de raíz", nameEn: undefined, durationMin: 90, priceEur: 35.5, from: true },
    ],
    faq: [
      {
        question: "Aparcamiento",
        keywords: "aparcar, parking",
        keywordsEn: "parking, car park",
        answer: "Hay un parking público a dos minutos andando.",
        answerEn: undefined,
      },
      { question: "Formas de pago", keywords: "pagar con tarjeta", keywordsEn: undefined, answer: undefined, answerEn: undefined },
    ],
    ...over,
  };
}

export function createBody(over: Partial<CreateRequest> = {}, draft: Draft = validDraft()): CreateRequest {
  return { draft, pin: "246810", acceptTerms: true, ...over };
}

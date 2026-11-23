import { describe, expect, it } from "vitest";
import { brainCall, SAT_1930 } from "../conversation/brainCall";
import { starterShop } from "./starterShop";

// One call per pack, on a shop built from the pack's starter data only: ask for a service by a
// colloquial name, accept the first offer, give a name and a phone, confirm the read-back. Saturday
// 14 November 2026, 19:30 in Madrid; the shop opens Monday at 10:00 (two resources).
const CALLS = [
  { pack: "hair-salon", lang: "es", line: "Hola, quería cortarme las puntas", service: "corte-mujer", minutes: 45 },
  { pack: "barber-shop", lang: "es", line: "Hola, quería un degradado", service: "degradado", minutes: 40 },
  { pack: "barber-shop", lang: "en", line: "Hi, can I get a men's haircut?", service: "corte-hombre", minutes: 30 },
  { pack: "beauty-centre", lang: "es", line: "Hola, quería una manicura semipermanente", service: "manicura-semipermanente", minutes: 45 },
  { pack: "beauty-centre", lang: "en", line: "Hi, I'd like a bikini wax", service: "cera-ingles", minutes: 25 },
  { pack: "physio-clinic", lang: "es", line: "Hola, quería una primera visita", service: "primera-visita", minutes: 60 },
  { pack: "physio-clinic", lang: "en", line: "Hi, I'd like a sports massage", service: "masaje-deportivo", minutes: 45 },
  { pack: "dental-clinic", lang: "es", line: "Hola, quería una limpieza dental", service: "limpieza", minutes: 45 },
  { pack: "dental-clinic", lang: "en", line: "Hi, I'd like a dental check-up", service: "revision", minutes: 30 },
  { pack: "car-workshop", lang: "es", line: "Hola, quería cambiar el aceite", service: "cambio-aceite", minutes: 45 },
  { pack: "car-workshop", lang: "en", line: "Hi, I would like an oil change", service: "cambio-aceite", minutes: 45 },
  { pack: "psychology-practice", lang: "es", line: "Hola, quería una primera consulta", service: "primera-consulta", minutes: 50 },
  { pack: "psychology-practice", lang: "en", line: "Hi, I'd like an online session", service: "sesion-online", minutes: 50 },
  { pack: "tutoring-academy", lang: "es", line: "Hola, quería una clase de mates", service: "matematicas", minutes: 60 },
  { pack: "tutoring-academy", lang: "en", line: "Hi, I'd like a trial class", service: "clase-prueba", minutes: 60 },
  { pack: "driving-school", lang: "es", line: "Hola, quería una clase práctica", service: "clase-practica", minutes: 45 },
  { pack: "driving-school", lang: "en", line: "Hi, I'd like a double lesson", service: "clase-practica-doble", minutes: 90 },
] as const;

describe.each(CALLS)("$pack ($lang): $line", ({ pack, lang, line, service, minutes }) => {
  const shop = starterShop(pack);
  const lines =
    lang === "es" ? [line, "sí", "Me llamo Ana", "612 345 678", "sí"] : [line, "yes", "My name is Anna", "612 345 678", "yes"];

  it("books the service end to end, in the shop's opening hours, on one of its own resources", () => {
    const turns = brainCall(lines, { shop, now: SAT_1930, lang });
    expect(turns.map((t) => t.decision.effects.filter((e) => e.type === "createBooking").length)).toEqual([0, 0, 0, 0, 1]);
    const last = turns.at(-1)!.decision;
    expect([last.complete, last.outcome]).toEqual([true, "booked"]);
    const booking = last.effects.find((e) => e.type === "createBooking");
    expect(booking?.type).toBe("createBooking");
    if (booking?.type !== "createBooking") return;
    expect(booking.serviceId).toBe(service);
    expect(booking.verdict.start.toString()).toBe("2026-11-16T09:00:00Z"); // Monday 10:00 in Madrid
    expect(booking.verdict.end.since(booking.verdict.start).total("minutes")).toBe(minutes);
    expect(shop.resources.map((r) => r.id)).toContain(booking.verdict.resourceId);
  });

  it("a second caller at the same time gets the other resource, never the same one", () => {
    const first = brainCall(lines, { shop, now: SAT_1930, lang });
    const booked = first.at(-1)!.decision.effects.find((e) => e.type === "createBooking");
    if (booked?.type !== "createBooking") throw new Error("first call did not book");
    const existing = [{ id: "b1", resourceId: booked.verdict.resourceId, start: booked.verdict.start, end: booked.verdict.end }];
    const second = brainCall(lines, { shop, now: SAT_1930, lang, existing });
    const again = second.at(-1)!.decision.effects.find((e) => e.type === "createBooking");
    if (again?.type !== "createBooking") throw new Error("second call did not book");
    expect(again.verdict.start.toString()).toBe(booked.verdict.start.toString());
    expect(again.verdict.resourceId).not.toBe(booked.verdict.resourceId);
  });
});

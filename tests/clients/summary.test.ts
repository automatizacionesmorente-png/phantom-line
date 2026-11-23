import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { historyState, median, summarize, usualService, type ClientBooking } from "@/lib/clients/summary";
import { firstName, whatsappUrl, winbackText } from "@/lib/clients/winback";
import { recognises, usualOffer, welcomeBack } from "@/lib/clients/welcome";

const NOW = Temporal.Instant.from("2026-11-10T08:00:00Z");
const ago = (days: number) => NOW.subtract({ hours: days * 24 });
const b = (id: string, daysAgo: number, over: Partial<ClientBooking> = {}): ClientBooking => ({
  id,
  serviceId: "corte",
  start: ago(daysAgo),
  end: ago(daysAgo).add({ minutes: 30 }),
  status: "confirmed",
  noShow: false,
  ...over,
});

describe("summarize", () => {
  it("counts finished confirmed bookings as visits, no-shows apart, and ignores cancelled ones", () => {
    const s = summarize([b("1", 30), b("2", 20, { noShow: true }), b("3", 10, { status: "cancelled" }), b("4", 5)], NOW);
    expect(s.totalVisits).toBe(2);
    expect(s.noShows).toBe(1);
    expect(s.lastVisit?.toString()).toBe(ago(5).toString());
    expect(s.upcoming).toBeNull();
  });

  it("sees an unfinished booking as upcoming, never as a visit", () => {
    const next = b("n", -3);
    expect(historyState(next, NOW)).toBe("upcoming");
    expect(summarize([b("1", 9), next], NOW)).toMatchObject({ totalVisits: 1, upcoming: next.start });
  });

  it("usual services: most visited first, ties to the most recent; offered only from 2 visits", () => {
    const s = summarize(
      [b("1", 90, { serviceId: "tinte" }), b("2", 60, { serviceId: "corte" }), b("3", 30, { serviceId: "corte" }), b("4", 10, { serviceId: "tinte" })],
      NOW,
    );
    expect(s.usualServices).toEqual([
      { serviceId: "tinte", count: 2 },
      { serviceId: "corte", count: 2 },
    ]);
    expect(usualService(s)).toBe("tinte");
    expect(usualService(summarize([b("1", 5)], NOW))).toBeNull();
  });

  it("the interval is the median gap in days, rounded up; none with fewer than 2 visits", () => {
    expect(summarize([b("1", 5)], NOW).intervalDays).toBeNull();
    expect(summarize([b("1", 70), b("2", 40), b("3", 10)], NOW).intervalDays).toBe(30);
    expect(median([1, 9, 3])).toBe(3);
    expect(median([2, 4])).toBe(3);
  });
});

describe("win-back text and wa.me link", () => {
  const slots = [Temporal.Instant.from("2026-11-11T09:00:00Z"), Temporal.Instant.from("2026-11-12T16:30:00Z")];
  it("is in the client's language and names the real slots", () => {
    const es = winbackText({ name: "Carlos Vega", shopName: "Peluquería Lola", lang: "es", timeZone: "Europe/Madrid", slots });
    expect(es).toBe(
      "Hola Carlos, hace tiempo que no te vemos por Peluquería Lola. Esta semana tenemos hueco: Miércoles 11 a las 10:00, Jueves 12 a las 17:30. ¿Te reservo alguno?",
    );
    const en = winbackText({ name: "John Carter", shopName: "Lola's", lang: "en", timeZone: "Europe/Madrid", slots });
    expect(en).toContain("Hi John,");
    expect(en).toContain("Wednesday the 11th at 10 am");
  });

  it("never invents a slot: with none, it only invites them to ask", () => {
    const text = winbackText({ name: "Ana", shopName: "Lola", lang: "es", timeZone: "Europe/Madrid", slots: [] });
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(text).toContain("Cuando quieras");
  });

  it("wa.me link: digits only in the phone, the text URL-encoded", () => {
    const url = whatsappUrl("+34 612-345 678", "Hola Ana & Co? ¡Sí!");
    expect(url).toBe(`https://wa.me/34612345678?text=${encodeURIComponent("Hola Ana & Co? ¡Sí!")}`);
    expect(new URL(url).searchParams.get("text")).toBe("Hola Ana & Co? ¡Sí!");
    expect(firstName("  María  del Carmen ")).toBe("María");
  });
});

describe("recognising a caller", () => {
  const client = { name: "Carlos Vega", phone: "+34612345678", usualServiceId: null };
  it("needs the phone and a name matching the stored one, ignoring case and accents", () => {
    expect(recognises({ name: "carlos VEGA", phone: "+34612345678" }, client)).toBe(true);
    expect(recognises({ name: "Carlos", phone: "+34612345678" }, client)).toBe(false);
    expect(recognises({ name: "Carlos Vega", phone: "+34612345679" }, client)).toBe(false);
    expect(recognises({ name: "Carlos Vega" }, client)).toBe(false);
    expect(recognises({ phone: "+34612345678" }, client)).toBe(false);
    expect(recognises({ name: "Carlos Vega", phone: "+34612345678" }, null)).toBe(false);
  });
  it("greets by first name and offers the usual in the right words", () => {
    expect(welcomeBack("Carlos Vega", "es")).toBe("¡Hola de nuevo, Carlos!");
    expect(welcomeBack("Carlos Vega", "en")).toBe("Welcome back, Carlos!");
    const services = [
      { id: "corte-hombre", name: { es: "Corte de hombre", en: "Men's haircut" } },
      { id: "degradado", name: { es: "Degradado", en: "Fade" } },
    ];
    expect(usualOffer("corte-hombre+degradado", services, "es")).toBe("¿Lo de siempre, corte de hombre y degradado?");
    expect(usualOffer("corte-hombre+degradado", services, "en")).toBe("The usual, men's haircut and fade?");
    expect(usualOffer("gone", services, "es")).toBeNull();
  });
});

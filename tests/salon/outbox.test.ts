import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { planOutbox, type OutboxBooking, type OutboxClient, type PlanInput } from "@/lib/salon/outbox";
import { OPT_OUT } from "@/lib/salon/outboxCopy";
import { NO_AUTOMATIONS, isReviewUrl } from "@/lib/salon/settings";

const I = (s: string) => Temporal.Instant.from(s);
/** Tuesday 10 November 2026, 09:00 in Madrid. */
const NOW = I("2026-11-10T08:00:00Z");

const booking = (id: string, start: string, o: Partial<OutboxBooking> = {}): OutboxBooking => ({
  id,
  clientId: null,
  name: "Ana Pérez",
  phone: "+34600000001",
  language: "es",
  start: I(start),
  status: "confirmed",
  cancelledAt: null,
  paidAt: null,
  ...o,
});
const person = (id: string, o: Partial<OutboxClient> = {}): OutboxClient => ({
  id,
  name: `Cli ${id}`,
  phone: `+3460000${id.padStart(4, "0")}`,
  language: "es",
  birthday: null,
  promoConsentAt: I("2026-01-01T00:00:00Z"),
  summary: { lastVisit: I("2026-11-01T10:00:00Z"), upcoming: null, intervalDays: null, totalVisits: 1 },
  ...o,
});
const plan = (o: Partial<PlanInput> & { on?: Partial<typeof NO_AUTOMATIONS> }) =>
  planOutbox({
    now: NOW,
    tz: "Europe/Madrid",
    shop: { name: "Salón Lola" },
    settings: { automations: { ...NO_AUTOMATIONS, ...o.on }, googleReviewUrl: "https://g.page/r/lola/review" },
    bookings: [],
    cancellations: [],
    clients: [],
    existingKeys: new Set(),
    ...o,
  });

describe("reminder", () => {
  it("covers tomorrow in shop time, confirmed, whatever the consent", () => {
    const d = plan({
      on: { reminder: true },
      bookings: [
        booking("in1", "2026-11-10T23:00:00Z"), // 00:00 on the 11th in Madrid
        booking("in2", "2026-11-11T22:59:00Z"), // 23:59 on the 11th
        booking("today", "2026-11-10T22:59:00Z"),
        booking("after", "2026-11-11T23:00:00Z"),
        booking("cancelled", "2026-11-11T10:00:00Z", { status: "cancelled", cancelledAt: NOW }),
        booking("walkin", "2026-11-11T10:00:00Z", { phone: "" }),
      ],
    });
    expect(d.map((x) => x.dedupeKey)).toEqual(["reminder:in1", "reminder:in2"]);
    expect(d[1].body).toBe("Salón Lola: Hola Ana, te recordamos tu cita de mañana a las 23:59. Responde 1 para confirmar.");
  });

  it("writes in the client's language", () => {
    const [d] = plan({ on: { reminder: true }, bookings: [booking("x", "2026-11-11T14:30:00Z", { language: "en" })] });
    expect(d.body).toBe("Salón Lola: Hi Ana, a reminder of your appointment tomorrow at 3:30 pm. Reply 1 to confirm.");
  });
});

describe("review", () => {
  it("needs the switch and a link, and only reaches the last 48 hours", () => {
    const b = [
      booking("new", "2026-11-09T10:00:00Z", { paidAt: I("2026-11-09T11:00:00Z") }),
      booking("old", "2026-11-07T10:00:00Z", { paidAt: I("2026-11-08T07:59:00Z") }),
      booking("unpaid", "2026-11-09T10:00:00Z"),
    ];
    const d = plan({ on: { review: true }, bookings: b });
    expect(d.map((x) => x.dedupeKey)).toEqual(["review:new"]);
    expect(d[0].body).toContain("https://g.page/r/lola/review");
    expect(plan({ on: { review: true }, bookings: b, settings: { automations: { ...NO_AUTOMATIONS, review: true }, googleReviewUrl: null } })).toEqual([]);
    expect(plan({ on: {}, bookings: b })).toEqual([]);
  });
});

describe("gap", () => {
  const freed = booking("c1", "2026-11-12T15:00:00Z", { status: "cancelled", cancelledAt: I("2026-11-10T06:00:00Z"), phone: "+34600000099", clientId: "9" });
  it("offers the slot to up to 3 consenting clients, lapsed first then most visits, never the canceller or one with a booking", () => {
    const lapsed = person("1", { summary: { lastVisit: I("2026-08-01T10:00:00Z"), upcoming: null, intervalDays: null, totalVisits: 1 } });
    const frequent = person("2", { summary: { lastVisit: I("2026-11-05T10:00:00Z"), upcoming: null, intervalDays: null, totalVisits: 9 } });
    const casual = person("3");
    const fourth = person("4", { summary: { lastVisit: I("2026-11-06T10:00:00Z"), upcoming: null, intervalDays: null, totalVisits: 0 } });
    const canceller = person("9", { phone: "+34600000099", summary: { lastVisit: I("2026-08-01T10:00:00Z"), upcoming: null, intervalDays: null, totalVisits: 50 } });
    const booked = person("5", { summary: { lastVisit: I("2026-08-01T10:00:00Z"), upcoming: I("2026-11-20T10:00:00Z"), intervalDays: null, totalVisits: 50 } });
    const noConsent = person("6", { promoConsentAt: null, summary: { lastVisit: I("2026-08-01T10:00:00Z"), upcoming: null, intervalDays: null, totalVisits: 50 } });
    const d = plan({ on: { gap: true }, cancellations: [freed], clients: [fourth, casual, frequent, lapsed, canceller, booked, noConsent] });
    expect(d.map((x) => x.dedupeKey)).toEqual(["gap:c1:1", "gap:c1:2", "gap:c1:3"]);
    expect(d[0].body).toBe(`Salón Lola: Hola Cli, se ha liberado un hueco el jueves 12 a las 16:00. ¿Quieres que te lo reserve? ${OPT_OUT.es}`);
    // A second run, with those keys known, adds nobody (the slot was already offered to 3).
    expect(plan({ on: { gap: true }, cancellations: [freed], clients: [fourth, casual, frequent, lapsed], existingKeys: new Set(d.map((x) => x.dedupeKey)) })).toEqual([]);
  });

  it("ignores cancellations older than 24 h, past slots and slots beyond 72 h", () => {
    const c = [person("1")];
    const one = (id: string, start: string, cancelledAt: string) => booking(id, start, { status: "cancelled", cancelledAt: I(cancelledAt), phone: "+34699999999" });
    const d = plan({
      on: { gap: true },
      clients: c,
      cancellations: [
        one("old", "2026-11-12T15:00:00Z", "2026-11-09T07:59:00Z"),
        one("past", "2026-11-10T07:00:00Z", "2026-11-10T06:00:00Z"),
        one("far", "2026-11-13T08:01:00Z", "2026-11-10T06:00:00Z"),
        one("ok", "2026-11-13T08:00:00Z", "2026-11-10T06:00:00Z"),
      ],
    });
    expect(d.map((x) => x.dedupeKey)).toEqual(["gap:ok:1"]);
  });
});

describe("winback and birthday", () => {
  it("winback is for lapsed clients with consent, once per lapse", () => {
    const lapsed = person("1", { summary: { lastVisit: I("2026-08-01T10:00:00Z"), upcoming: null, intervalDays: null, totalVisits: 2 } });
    const quiet = { ...lapsed, id: "2", promoConsentAt: null };
    const d = plan({ on: { winback: true }, clients: [lapsed, quiet, person("3")] });
    expect(d.map((x) => x.dedupeKey)).toEqual(["winback:1:2026-08-01"]);
    expect(d[0].body.endsWith(OPT_OUT.es)).toBe(true);
  });

  it("birthday is for consenting clients today, and 29 February falls on the 28th in a common year", () => {
    const d = plan({ on: { birthday: true }, clients: [person("1", { birthday: "11-10" }), person("2", { birthday: "11-11" }), person("3", { birthday: "11-10", promoConsentAt: null })] });
    expect(d.map((x) => x.dedupeKey)).toEqual(["birthday:1:2026"]);
    const feb28 = (now: string) =>
      planOutbox({ now: I(now), tz: "Europe/Madrid", shop: { name: "S" }, settings: { automations: { ...NO_AUTOMATIONS, birthday: true }, googleReviewUrl: null }, bookings: [], cancellations: [], clients: [person("1", { birthday: "02-29" })], existingKeys: new Set() });
    expect(feb28("2027-02-28T10:00:00Z")).toHaveLength(1);
    expect(feb28("2027-03-01T10:00:00Z")).toHaveLength(0);
    expect(feb28("2028-02-28T10:00:00Z")).toHaveLength(0);
    expect(feb28("2028-02-29T10:00:00Z")).toHaveLength(1);
  });
});

describe("review needs a valid link", () => {
  it("makes no review draft for a link outside the allow-list", () => {
    const b = [booking("new", "2026-11-09T10:00:00Z", { paidAt: I("2026-11-09T11:00:00Z") })];
    const withUrl = (googleReviewUrl: string) =>
      plan({ on: { review: true }, bookings: b, settings: { automations: { ...NO_AUTOMATIONS, review: true }, googleReviewUrl } });
    expect(withUrl("https://www.google.com/url?q=https://evil.example")).toEqual([]);
    expect(withUrl("https://evil.example/")).toEqual([]);
    expect(withUrl("https://www.google.com/maps/place/x")).toHaveLength(1);
  });
});

describe("names in the copy", () => {
  const reminder = (name: string) => plan({ on: { reminder: true }, bookings: [booking("x", "2026-11-11T09:00:00Z", { name })] })[0].body;
  it("strips control characters, collapses spaces and caps the name at 30 characters", () => {
    expect(reminder("  Ana\u0000\u202e \n  Pérez ")).toContain("Hola Ana,");
    expect(reminder("A".repeat(80))).toContain(`Hola ${"A".repeat(30)},`);
    expect(reminder("\u0007\u200b")).toContain("Hola,");
  });
  it("greets neutrally when the name looks like a link, a domain or an address", () => {
    for (const bad of ["https://evil.example/x", "evil.com", "www.evil", "ana@evil.example", "wa.me/3412"]) {
      const body = reminder(bad);
      expect(body, bad).toContain("Salón Lola: Hola, te recordamos");
      expect(body).not.toContain("evil");
    }
    expect(reminder("Ana.")).toContain("Hola Ana.,");
  });
});

describe("review link allow-list", () => {
  it("accepts only the three Google hosts over https", () => {
    for (const ok of ["https://g.page/r/abc/review", "https://search.google.com/local/writereview?placeid=x", "https://www.google.com/maps/place/x"]) expect(isReviewUrl(ok)).toBe(true);
    for (const bad of ["http://g.page/r/x", "https://evil.example/", "https://g.page.evil.example/", "https://www.google.com@evil.example/", "https://google.com/x", "https://g.page/ x", "javascript:alert(1)", "https://g.page/" + "a".repeat(300), "https://www.google.com/url?q=https://evil.example", "https://www.google.com/mapsx", "https://search.google.com/search?q=x", "https://g.page/"]) {
      expect(isReviewUrl(bad), bad).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
  COMBO_SEPARATOR,
  MAX_COMBO_MIN,
  MAX_COMBO_PARTS,
  checkBooking,
  comboId,
  daySlots,
  evaluateBooking,
  findNearestSlots,
  resolveParts,
  resolveService,
  toInstant,
  type RuleContext,
  type Service,
} from "@/lib/booking";
import { lolaPack, lolaRules } from "../fixtures/lola";

// Catalog order: corte-hombre, degradado, barba, tinte, mechas.
const services: Service[] = [
  { id: "corte-hombre", durationMin: 30 },
  { id: "degradado", durationMin: 15 },
  { id: "barba", durationMin: 20 },
  { id: "tinte", durationMin: 90 },
  { id: "mechas", durationMin: 150 },
];

describe("the Combo_Id limits", () => {
  it("are the ones of Requirement 7.3", () => {
    expect(COMBO_SEPARATOR).toBe("+");
    expect(MAX_COMBO_PARTS).toBe(3);
    expect(MAX_COMBO_MIN).toBe(480);
  });
});

describe("resolveService and resolveParts", () => {
  it("one catalog id is that service itself", () => {
    expect(resolveService("barba", services)).toBe(services[2]);
    expect(resolveParts("barba", services)).toEqual([services[2]]);
  });

  it("two parts in catalog order are one service of the summed duration", () => {
    expect(resolveService("corte-hombre+degradado", services)).toEqual({ id: "corte-hombre+degradado", durationMin: 45 });
    expect(resolveParts("corte-hombre+degradado", services)?.map((s) => s.id)).toEqual(["corte-hombre", "degradado"]);
  });

  it("three parts in catalog order sum all three (not all but the last)", () => {
    expect(resolveService("corte-hombre+degradado+barba", services)).toEqual({
      id: "corte-hombre+degradado+barba",
      durationMin: 65,
    });
    expect(resolveService("degradado+tinte+mechas", services)?.durationMin).toBe(255);
  });

  it("parts out of catalog order are rejected, so each combo has one id", () => {
    expect(resolveService("degradado+corte-hombre", services)).toBeNull();
    expect(resolveParts("barba+corte-hombre+degradado", services)).toBeNull();
  });

  it("a repeated part is rejected", () => {
    expect(resolveService("barba+barba", services)).toBeNull();
    expect(resolveService("corte-hombre+barba+barba", services)).toBeNull();
  });

  it("an unknown part is rejected", () => {
    expect(resolveService("corte-hombre+permanente", services)).toBeNull();
    expect(resolveService("permanente", services)).toBeNull();
  });

  it("4 parts are rejected, even in catalog order and under 480 minutes", () => {
    expect(resolveService("corte-hombre+degradado+barba+tinte", services)).toBeNull();
  });

  it("a sum of 481 minutes is rejected and 480 is accepted", () => {
    const long: Service[] = [
      { id: "a", durationMin: 240 },
      { id: "b", durationMin: 240 },
      { id: "c", durationMin: 1 },
    ];
    expect(resolveService("a+b", long)).toEqual({ id: "a+b", durationMin: 480 });
    expect(resolveService("a+b+c", long)).toBeNull();
    expect(comboId(["c", "b", "a"], long)).toBeNull();
  });

  it("an empty string is rejected", () => {
    expect(resolveService("", services)).toBeNull();
    expect(resolveParts("", services)).toBeNull();
  });

  it("a trailing or leading + is rejected", () => {
    expect(resolveService("corte-hombre+", services)).toBeNull();
    expect(resolveService("+corte-hombre", services)).toBeNull();
    expect(resolveService("+", services)).toBeNull();
    expect(resolveService("corte-hombre++degradado", services)).toBeNull();
  });
});

describe("comboId", () => {
  it("one id is that id", () => {
    expect(comboId(["tinte"], services)).toBe("tinte");
  });

  it("two and three ids in any order give the catalog-order id", () => {
    expect(comboId(["degradado", "corte-hombre"], services)).toBe("corte-hombre+degradado");
    expect(comboId(["corte-hombre", "degradado"], services)).toBe("corte-hombre+degradado");
    expect(comboId(["barba", "corte-hombre", "degradado"], services)).toBe("corte-hombre+degradado+barba");
    expect(comboId(["degradado", "barba", "corte-hombre"], services)).toBe("corte-hombre+degradado+barba");
  });

  it("its result always resolves", () => {
    const id = comboId(["mechas", "barba"], services);
    expect(id).toBe("barba+mechas");
    expect(resolveService(id!, services)?.durationMin).toBe(170);
  });

  it("rejects no ids, a repeated id, an unknown id and 4 ids", () => {
    expect(comboId([], services)).toBeNull();
    expect(comboId(["barba", "barba"], services)).toBeNull();
    expect(comboId(["barba", "permanente"], services)).toBeNull();
    expect(comboId(["corte-hombre", "degradado", "barba", "tinte"], services)).toBeNull();
  });
});

// Peluquería Lola: haircut 30, colour 90, beard 20 (catalog order), Tue–Sat 10–14 and 17–20.
describe("the Booking_Rules take a Combo_Id where they take a service id", () => {
  const TZ = "Europe/Madrid";
  const at = (d: string, time: string) => toInstant(Temporal.PlainDate.from(d), Temporal.PlainTime.from(time), TZ);
  const local = (i: Temporal.Instant) => i.toZonedDateTimeISO(TZ).toString({ timeZoneName: "never" }).slice(0, 16);
  const ctx = (existing: RuleContext["existing"] = []): RuleContext => ({
    now: at("2026-11-11", "09:00"),
    shop: lolaRules,
    pack: lolaPack,
    existing,
  });

  it("haircut+colour at 12:00 is accepted and ends at the 14:00 close", () => {
    const v = checkBooking({ serviceId: "haircut+colour", start: at("2026-11-11", "12:00") }, ctx());
    expect(v.ok).toBe(true);
    expect(v.ok && local(v.end)).toBe("2026-11-11T14:00");
  });

  it("haircut+colour at 12:15 does not fit, and the alternatives last the summed 120 minutes", () => {
    const v = checkBooking({ serviceId: "haircut+colour", start: at("2026-11-11", "12:15") }, ctx());
    expect(!v.ok && v.reason).toBe("does_not_fit");
    expect(!v.ok && v.alternatives.length).toBe(3);
    for (const a of v.ok ? [] : v.alternatives) {
      expect(a.end.epochMilliseconds - a.start.epochMilliseconds).toBe(120 * 60_000);
    }
  });

  it("the summed range makes a chair busy: a booking at 13:30 on chair-1 moves the combo to chair-2", () => {
    const busy = [{ id: "b", resourceId: "chair-1", start: at("2026-11-11", "13:30"), end: at("2026-11-11", "14:00") }];
    const e = evaluateBooking({ serviceId: "haircut+colour", start: at("2026-11-11", "12:00") }, ctx(busy));
    expect(e.ok && e.resourceId).toBe("chair-2");
  });

  it("a Combo_Id out of catalog order is unknown_service with no alternatives", () => {
    expect(checkBooking({ serviceId: "colour+haircut", start: at("2026-11-11", "12:00") }, ctx())).toEqual({
      ok: false,
      reason: "unknown_service",
      alternatives: [],
    });
  });

  it("findNearestSlots offers 18:00 for a 21:00 haircut+colour (the last start that ends by 20:00)", () => {
    const slots = findNearestSlots({ serviceId: "haircut+colour", start: at("2026-11-11", "21:00") }, ctx(), { limit: 1 });
    expect(slots.map((s) => local(s.start))).toEqual(["2026-11-11T18:00"]);
  });

  it("daySlots lists haircut+colour starts up to 12:00 and 18:00, and nothing for an invalid id", () => {
    const starts = daySlots({ serviceId: "haircut+colour" }, Temporal.PlainDate.from("2026-11-14"), ctx()).map((s) =>
      local(s.start).slice(11),
    );
    expect(starts[0]).toBe("10:00");
    expect(starts).toContain("12:00");
    expect(starts).not.toContain("12:15");
    expect(starts.at(-1)).toBe("18:00");
    expect(daySlots({ serviceId: "haircut+haircut" }, Temporal.PlainDate.from("2026-11-14"), ctx())).toEqual([]);
  });
});

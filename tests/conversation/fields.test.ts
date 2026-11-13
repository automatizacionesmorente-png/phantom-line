import { describe, expect, it } from "vitest";
import { matchService, mergeFields, normalizePhone } from "@/lib/conversation/fields";
import { initialCallState, type CallState } from "@/lib/conversation/types";
import type { ModelTurn } from "@/lib/receptionist/schema";
import { lolaProfile } from "../fixtures/lola";

const turn = (over: Partial<ModelTurn> = {}): ModelTurn => ({
  reply: "Vale.",
  language: "es",
  wantsLanguage: null,
  intent: "booking",
  name: null,
  phone: null,
  service: null,
  date: null,
  time: null,
  callerConfirmed: false,
  callerWantsToEnd: false,
  outOfProfile: false,
  reason: "Quiere cita",
  urgency: "normal",
  ...over,
});
const state = (over: Partial<CallState> = {}): CallState => ({ ...initialCallState("es"), ...over });

describe("normalizePhone", () => {
  it("accepts Spanish national numbers with spaces, dashes and dots", () => {
    expect(normalizePhone("612 34 56 78", "ES")).toBe("+34612345678");
    expect(normalizePhone("612-345-678", "ES")).toBe("+34612345678");
    expect(normalizePhone("91.123.45.67", "ES")).toBe("+34911234567");
  });
  it("handles +34, 0034 and 34 prefixes", () => {
    expect(normalizePhone("+34 612 345 678", "ES")).toBe("+34612345678");
    expect(normalizePhone("0034612345678", "ES")).toBe("+34612345678");
    expect(normalizePhone("34612345678", "ES")).toBe("+34612345678");
  });
  it("keeps other international numbers", () => {
    expect(normalizePhone("+44 20 7946 0958", "ES")).toBe("+442079460958");
  });
  it("rejects short numbers, letters, a bad Spanish prefix and national numbers without a country", () => {
    expect(normalizePhone("612 345", "ES")).toBeNull();
    expect(normalizePhone("seis uno dos", "ES")).toBeNull();
    expect(normalizePhone("512345678", "ES")).toBeNull();
    expect(normalizePhone("+34 512 345 678", "ES")).toBeNull();
    expect(normalizePhone("+1234", "ES")).toBeNull();
    expect(normalizePhone("612345678", null)).toBeNull();
  });
});

describe("matchService", () => {
  it("matches names in both languages, ignoring case and accents", () => {
    expect(matchService("Corte", lolaProfile)).toBe("haircut");
    expect(matchService("un TINTE", lolaProfile)).toBe("colour");
    expect(matchService("haircut", lolaProfile)).toBe("haircut");
    expect(matchService("a beard trim", lolaProfile)).toBe("beard");
    expect(matchService("teñir", lolaProfile)).toBe("colour");
    expect(matchService("tenir", lolaProfile)).toBe("colour");
  });
  it("matches synonyms (aliases)", () => {
    expect(matchService("quiero cortarme el pelo", lolaProfile)).toBe("haircut");
    expect(matchService("arreglarme la barba", lolaProfile)).toBe("beard");
    expect(matchService("hair color", lolaProfile)).toBe("colour");
  });
  it("matches the words people use for colour: pintar el pelo, teñir, tinte, color, mechas (owner's real call, 2026-11-13)", () => {
    for (const said of [
      "pintar el pelo de rosa",
      "me puedo pintar el pelo",
      "pintarme el pelo",
      "teñirme",
      "un tinte",
      "color",
      "mechas",
      "unas mechas rubias",
      "dye my hair pink",
      "highlights",
      "hair colour",
    ]) {
      expect(matchService(said, lolaProfile), said).toBe("colour");
    }
  });
  it("returns null for services the shop does not offer and for empty text", () => {
    expect(matchService("manicura", lolaProfile)).toBeNull();
    expect(matchService("depilación", lolaProfile)).toBeNull();
    expect(matchService("   ", lolaProfile)).toBeNull();
  });
  it("does not match inside other words", () => {
    expect(matchService("recortes de prensa", lolaProfile)).toBeNull();
  });
  it("returns null when two services match equally (ambiguous)", () => {
    expect(matchService("corte y barba", lolaProfile)).toBeNull();
  });
});

describe("mergeFields", () => {
  it("keeps the server value when the model returns null", () => {
    const s = state({ fields: { name: "Ana", phone: "+34612345678", serviceId: "haircut", requested: { date: "2026-11-12", time: "19:30" } } });
    expect(mergeFields(s, turn(), lolaProfile).fields).toEqual(s.fields);
  });
  it("replaces a value with a new valid one and normalizes it", () => {
    const r = mergeFields(state({ fields: { name: "Ana" } }), turn({ name: "  Ana   María ", phone: "612 345 678", service: "tinte" }), lolaProfile);
    expect(r.fields).toEqual({ name: "Ana María", phone: "+34612345678", serviceId: "colour" });
  });
  it("drops an invalid phone and keeps the old one", () => {
    const r = mergeFields(state({ fields: { phone: "+34612345678" } }), turn({ phone: "123456" }), lolaProfile);
    expect(r.fields.phone).toBe("+34612345678");
    expect(r.invalidPhone).toBe(true);
  });
  it("reports a service that is not offered without touching the known one", () => {
    const r = mergeFields(state({ fields: { serviceId: "haircut" } }), turn({ service: "manicura" }), lolaProfile);
    expect(r.fields.serviceId).toBe("haircut");
    expect(r.unknownService).toBe("manicura");
  });
  it("a new time keeps the known date; an invalid date is dropped", () => {
    const s = state({ fields: { requested: { date: "2026-11-12", time: "21:00" } } });
    expect(mergeFields(s, turn({ time: "19:30" }), lolaProfile).fields.requested).toEqual({ date: "2026-11-12", time: "19:30" });
    expect(mergeFields(state(), turn({ date: "2026-02-30", time: "10:00" }), lolaProfile).fields.requested).toBeUndefined();
    expect(mergeFields(state(), turn({ time: "10:00" }), lolaProfile).fields.requested).toBeUndefined();
  });
  it("a time that matches an offered slot takes that slot's date", () => {
    // Asked for Sunday 29 March; offered Saturday 28 March 19:30 (18:30Z) and Tuesday 31 March 10:00.
    const s = state({
      fields: { requested: { date: "2026-03-29", time: "12:00" } },
      lastOffer: ["2026-03-28T18:30:00Z", "2026-03-31T08:00:00Z"],
    });
    expect(mergeFields(s, turn({ time: "19:30" }), lolaProfile).fields.requested).toEqual({ date: "2026-03-28", time: "19:30" });
    expect(mergeFields(s, turn({ time: "10:00" }), lolaProfile).fields.requested).toEqual({ date: "2026-03-31", time: "10:00" });
  });
});

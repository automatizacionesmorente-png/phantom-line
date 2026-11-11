import { describe, expect, it } from "vitest";
import { matchesCaller, normalizeName } from "@/lib/conversation/matchCaller";

const booking = { customerName: "María José", customerPhone: "+34612345678" };

describe("normalizeName", () => {
  it("ignores case, accents and extra spaces", () => {
    expect(normalizeName("  María   JOSÉ ")).toBe("maria jose");
    expect(normalizeName("Núñez")).toBe("nunez");
  });
});

describe("matchesCaller", () => {
  it('"maria jose" matches "María José" with the same phone', () => {
    expect(matchesCaller({ name: "maria jose", phone: "+34612345678" }, booking)).toBe(true);
  });
  it("the right phone with another name does not match", () => {
    expect(matchesCaller({ name: "María", phone: "+34612345678" }, booking)).toBe(false);
    expect(matchesCaller({ name: "Ana López", phone: "+34612345678" }, booking)).toBe(false);
  });
  it("the right name with another phone does not match", () => {
    expect(matchesCaller({ name: "María José", phone: "+34612345679" }, booking)).toBe(false);
  });
  it("empty names or phones never match", () => {
    expect(matchesCaller({ name: "  ", phone: "+34612345678" }, { customerName: " ", customerPhone: "+34612345678" })).toBe(false);
    expect(matchesCaller({ name: "Ana", phone: "" }, { customerName: "Ana", customerPhone: "" })).toBe(false);
  });
});

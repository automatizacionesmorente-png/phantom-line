import { describe, expect, it } from "vitest";
import {
  digitGroups,
  parseNumber,
  parsePhone,
  parsePrice,
  speakDigits,
  speakNumber,
  speakOrdinal,
  speakPhone,
  speakPrice,
} from "@/lib/receptionist/spoken";

describe("speakNumber, Spanish (design.md, Numbers)", () => {
  it.each([
    [0, "cero"],
    [1, "uno"],
    [16, "dieciséis"],
    [21, "veintiuno"],
    [22, "veintidós"],
    [23, "veintitrés"],
    [26, "veintiséis"],
    [30, "treinta"],
    [31, "treinta y uno"],
    [45, "cuarenta y cinco"],
    [99, "noventa y nueve"],
    [100, "cien"],
    [101, "ciento uno"],
    [115, "ciento quince"],
    [200, "doscientos"],
    [500, "quinientos"],
    [700, "setecientos"],
    [900, "novecientos"],
    [1000, "mil"],
    [1001, "mil uno"],
    [2000, "dos mil"],
    [21000, "veintiún mil"],
    [31000, "treinta y un mil"],
    [100000, "cien mil"],
    [101000, "ciento un mil"],
    [999999, "novecientos noventa y nueve mil novecientos noventa y nueve"],
  ])("%i → %s", (n, words) => {
    expect(speakNumber(n, "es")).toBe(words);
  });

  it.each([
    [1, "un"],
    [21, "veintiún"],
    [31, "treinta y un"],
    [101, "ciento un"],
    [1001, "mil un"],
    [15, "quince"],
  ])("with apocope, %i → %s", (n, words) => {
    expect(speakNumber(n, "es", { apocope: true })).toBe(words);
  });

  it("rejects numbers it cannot say", () => {
    expect(() => speakNumber(-1, "es")).toThrow(RangeError);
    expect(() => speakNumber(1_000_000, "es")).toThrow(RangeError);
    expect(() => speakNumber(1.5, "en")).toThrow(RangeError);
  });
});

describe("speakNumber, English", () => {
  it.each([
    [0, "zero"],
    [13, "thirteen"],
    [21, "twenty-one"],
    [40, "forty"],
    [100, "one hundred"],
    [105, "one hundred five"],
    [1000, "one thousand"],
    [21000, "twenty-one thousand"],
    [999999, "nine hundred ninety-nine thousand nine hundred ninety-nine"],
  ])("%i → %s", (n, words) => {
    expect(speakNumber(n, "en")).toBe(words);
  });

  it.each([
    [1, "first"],
    [2, "second"],
    [3, "third"],
    [5, "fifth"],
    [8, "eighth"],
    [12, "twelfth"],
    [13, "thirteenth"],
    [20, "twentieth"],
    [21, "twenty-first"],
    [30, "thirtieth"],
    [31, "thirty-first"],
  ])("ordinal %i → %s", (n, words) => {
    expect(speakOrdinal(n)).toBe(words);
  });
});

describe("speakPrice", () => {
  it.each([
    [1500, "es", "quince euros"],
    [4500, "es", "cuarenta y cinco euros"],
    [100, "es", "un euro"],
    [2100, "es", "veintiún euros"],
    [1550, "es", "quince euros con cincuenta"],
    [50, "es", "cincuenta céntimos"],
    [1, "es", "un céntimo"],
    [0, "es", "cero euros"],
    [1500, "en", "fifteen euros"],
    [100, "en", "one euro"],
    [1550, "en", "fifteen euros fifty"],
    [50, "en", "fifty cents"],
    [1, "en", "one cent"],
  ] as const)("%i cents in %s → %s", (cents, lang, words) => {
    expect(speakPrice(cents, lang)).toBe(words);
  });
});

describe("speakDigits and speakPhone", () => {
  it("reads a Spanish phone in 3 groups of 3, digit by digit", () => {
    expect(speakPhone("+34612345678", "es")).toBe("seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho");
    expect(speakPhone("+34612345678", "en")).toBe("six, one, two; three, four, five; six, seven, eight");
  });

  it("reads another country's code first, then groups with a final group of 4", () => {
    expect(speakPhone("+447911123456", "es")).toBe(
      "más cuarenta y cuatro; siete, nueve, uno; uno, uno, dos; tres, cuatro, cinco, seis",
    );
    expect(speakPhone("+15551234567", "en")).toBe("plus one; five, five, five; one, two, three; four, five, six, seven");
  });

  it("groups digit runs without leaving one digit alone", () => {
    expect(digitGroups(9)).toEqual([3, 3, 3]);
    expect(digitGroups(10)).toEqual([3, 3, 4]);
    expect(digitGroups(7)).toEqual([3, 4]);
    expect(digitGroups(8)).toEqual([3, 3, 2]);
    expect(digitGroups(4)).toEqual([4]);
    expect(speakDigits("612 34 56", "es")).toBe("seis, uno, dos; tres, cuatro, cinco, seis");
  });
});

describe("parse back", () => {
  it("parses the exact forms", () => {
    expect(parseNumber("veintiún mil", "es")).toBe(21000);
    expect(parseNumber("ciento uno", "es")).toBe(101);
    expect(parseNumber("cien mil", "es")).toBe(100000);
    expect(parseNumber("one hundred five", "en")).toBe(105);
    expect(parseNumber("twenty-one thousand", "en")).toBe(21000);
    expect(parsePrice("quince euros con cincuenta", "es")).toBe(1550);
    expect(parsePrice("veintiún euros", "es")).toBe(2100);
    expect(parsePrice("fifteen euros fifty", "en")).toBe(1550);
    expect(parsePrice("fifty cents", "en")).toBe(50);
    expect(parsePhone("seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho", "es")).toBe("+34612345678");
    expect(parsePhone("plus forty-four; seven, nine, one; one, one, two; three, four, five, six", "en")).toBe(
      "+447911123456",
    );
  });

  it("returns null for words it does not know", () => {
    expect(parseNumber("", "es")).toBeNull();
    expect(parseNumber("quince patatas", "es")).toBeNull();
    expect(parseNumber("hundred", "en")).toBeNull();
    expect(parsePrice("quince", "es")).toBeNull();
    expect(parsePhone("seis, banana", "es")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { fnv1a32, pickVariant } from "@/lib/receptionist/variants";

describe("fnv1a32", () => {
  it("matches the published FNV-1a 32-bit test vectors", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("hashes the UTF-8 bytes, so accented letters differ from their plain form", () => {
    // "ñ" is the two bytes C3 B1 in UTF-8.
    let h = 0x811c9dc5;
    for (const b of [0xc3, 0xb1]) h = Math.imul(h ^ b, 0x01000193);
    expect(fnv1a32("ñ")).toBe(h >>> 0);
    expect(fnv1a32("ñ")).not.toBe(fnv1a32("n"));
  });

  it("is always an unsigned 32-bit integer", () => {
    for (const s of ["", "x", "call-1:0:greeting", "Peluquería Lola"]) {
      const h = fnv1a32(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe("pickVariant", () => {
  const variants = ["uno", "dos", "tres"] as const;

  it("uses variant 0 when no seed is given", () => {
    expect(pickVariant(undefined, "greeting", variants)).toBe("uno");
    expect(pickVariant(undefined, "offer", ["only"])).toBe("only");
  });

  it("follows the formula in design.md: fnv1a32(callId:turn:key) mod length", () => {
    const seed = { callId: "c-42", turn: 3 };
    const expected = variants[fnv1a32("c-42:3:offer") % variants.length];
    expect(pickVariant(seed, "offer", variants)).toBe(expected);
  });

  it("returns the only variant of a one-variant template for any seed", () => {
    expect(pickVariant({ callId: "abc", turn: 7 }, "askPhone", ["¿Y un teléfono?"])).toBe("¿Y un teléfono?");
  });
});

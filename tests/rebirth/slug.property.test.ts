import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { randomSuffix, SLUG_PATTERN, slugCandidates, slugify, uniqueId } from "@/lib/rebirth/slug";

describe("slugify", () => {
  it("turns a name into a URL slug", () => {
    expect(slugify("Peluquería  Lola!")).toBe("peluqueria-lola");
    expect(slugify("¡Ñandú & Hijos, S.L.!")).toBe("nandu-hijos-s-l");
    expect(slugify("123 Cortes")).toBe("n-123-cortes");
    expect(slugify("   ")).toBe("negocio");
    expect(slugify("日本語")).toBe("negocio");
  });

  it("always gives a valid slug, never longer than the limit, and is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 300 }), fc.integer({ min: 5, max: 60 }), (input, max) => {
        const s = slugify(input, max);
        expect(s).toMatch(SLUG_PATTERN);
        expect(s.length).toBeLessThanOrEqual(max);
        expect(slugify(s, max)).toBe(s);
      }),
    );
  });

  it("never contains markup, slashes, dots or spaces, whatever was typed", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 100 }), (input) => {
        expect(slugify(input)).toMatch(/^[a-z0-9-]+$/);
      }),
    );
  });
});

describe("uniqueId and slugCandidates", () => {
  it("never repeats an id, however many names collapse to the same slug", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 20 }), { maxLength: 30 }), (names) => {
        const taken = new Set<string>();
        const ids = names.map((n) => uniqueId(n, taken));
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(SLUG_PATTERN);
      }),
    );
  });

  it("skips ids already taken", () => {
    const taken = new Set(["corte", "corte-2"]);
    expect(uniqueId("Corte", taken)).toBe("corte-3");
  });

  it("candidates start with the plain slug and are all distinct valid slugs", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), fc.uint8Array({ minLength: 4, maxLength: 4 }), (name, bytes) => {
        const base = slugify(name);
        const c = slugCandidates(base, [randomSuffix(bytes), randomSuffix(bytes.map((b) => b + 1))]);
        expect(c[0]).toBe(base);
        for (const slug of c) expect(slug).toMatch(SLUG_PATTERN);
      }),
    );
  });
});

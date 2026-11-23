import { describe, expect, it } from "vitest";
import { extractionJsonSchema, parseExtraction } from "@/lib/rebirth/extraction";

// Gemini answers 400 "too many states" to every call when the response schema carries bounds,
// lengths or patterns. The schema sent to the model must stay plain; strictness lives in parseExtraction.
describe("extraction wire schema", () => {
  it("carries no constraint keywords Gemini cannot serve", () => {
    const text = JSON.stringify(extractionJsonSchema);
    for (const k of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "maxItems", "minItems", "pattern", "format"]) {
      expect(text).not.toContain(`"${k}"`);
    }
  });
  it("still rejects out-of-range items in the parser", () => {
    const out = parseExtraction(JSON.stringify({ hours: [{ day: 9, open: "25:00", close: "10:00" }], services: [{ name: "Corte", durationMin: 30, priceEur: -5, from: false }], faq: [] }));
    expect(out?.hours).toEqual({});
    expect(out?.services).toEqual([]);
    expect(out?.dropped).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { signSpeech, SPEECH_TOKEN_TTL_MS, verifySpeech } from "@/lib/receptionist/speechToken";

/**
 * N11. Speech tokens bind the exact text. For all shop ids, languages, texts and cacheable
 * flags: verify(sign(x)) holds before exp, and fails after exp or when any one of shop,
 * language, cacheable or text (even one character) is changed. Validates 1.4.
 */

const SECRET = "n11-secret";
const shopId = fc.string({ minLength: 1, maxLength: 100 });
const lang = fc.constantFrom("es" as const, "en" as const);
const text = fc.string({ minLength: 1, maxLength: 600, unit: "grapheme" });
const nowMs = fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 0, 1) });

/** `s` with one character changed, inserted or removed: always a different string. */
const oneCharChange = (s: string) =>
  fc
    .tuple(fc.nat({ max: s.length }), fc.constantFrom("insert", "delete", "replace"), fc.string({ minLength: 1, maxLength: 1 }))
    .map(([i, op, c]) => {
      const at = Math.min(i, s.length - 1);
      if (op === "insert") return s.slice(0, i) + c + s.slice(i);
      if (op === "delete" && s.length > 1) return s.slice(0, at) + s.slice(at + 1);
      return s.slice(0, at) + c + s.slice(at + 1);
    })
    .filter((t) => t !== s);

describe("N11: speech tokens bind the exact text", () => {
  it("verifies before exp and carries the flag", () => {
    fc.assert(
      fc.property(shopId, lang, text, fc.boolean(), nowMs, fc.nat({ max: SPEECH_TOKEN_TTL_MS - 1 }), (s, l, t, cacheable, now, dt) => {
        const token = signSpeech({ shopId: s, language: l, text: t, cacheable }, SECRET, now);
        expect(token.length).toBeLessThanOrEqual(200);
        const v = verifySpeech(token, { shopId: s, language: l, text: t }, SECRET, now + dt);
        expect(v).toEqual({ ok: true, cacheable, expiresAtMs: now + SPEECH_TOKEN_TTL_MS });
      }),
      { numRuns: 300 },
    );
  });

  it("fails at or after exp", () => {
    fc.assert(
      fc.property(shopId, lang, text, fc.boolean(), nowMs, fc.nat({ max: 10 * 24 * 3_600_000 }), (s, l, t, cacheable, now, late) => {
        const token = signSpeech({ shopId: s, language: l, text: t, cacheable }, SECRET, now);
        expect(verifySpeech(token, { shopId: s, language: l, text: t }, SECRET, now + SPEECH_TOKEN_TTL_MS + late)).toEqual({
          ok: false,
          reason: "expired",
        });
      }),
      { numRuns: 200 },
    );
  });

  it("fails when the text changes by one character", () => {
    fc.assert(
      fc.property(
        shopId,
        lang,
        text.chain((t) => fc.tuple(fc.constant(t), oneCharChange(t))),
        fc.boolean(),
        nowMs,
        (s, l, [t, changed], cacheable, now) => {
          const token = signSpeech({ shopId: s, language: l, text: t, cacheable }, SECRET, now);
          expect(verifySpeech(token, { shopId: s, language: l, text: changed }, SECRET, now).ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("fails when the shop or the language changes", () => {
    fc.assert(
      fc.property(shopId, shopId, lang, text, fc.boolean(), nowMs, (s, other, l, t, cacheable, now) => {
        fc.pre(s !== other);
        const token = signSpeech({ shopId: s, language: l, text: t, cacheable }, SECRET, now);
        expect(verifySpeech(token, { shopId: other, language: l, text: t }, SECRET, now).ok).toBe(false);
        const otherLang = l === "es" ? "en" : "es";
        expect(verifySpeech(token, { shopId: s, language: otherLang, text: t }, SECRET, now).ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("fails when the cacheable flag is flipped in the token", () => {
    fc.assert(
      fc.property(shopId, lang, text, fc.boolean(), nowMs, (s, l, t, cacheable, now) => {
        const [exp, , mac] = signSpeech({ shopId: s, language: l, text: t, cacheable }, SECRET, now).split(".");
        const flipped = [exp, Buffer.from(cacheable ? "0" : "1").toString("base64url"), mac].join(".");
        expect(verifySpeech(flipped, { shopId: s, language: l, text: t }, SECRET, now)).toEqual({ ok: false, reason: "signature" });
      }),
      { numRuns: 200 },
    );
  });
});

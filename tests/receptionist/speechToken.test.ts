import { describe, expect, it } from "vitest";
import { signSpeech, SPEECH_TOKEN_TTL_MS, verifySpeech } from "@/lib/receptionist/speechToken";

/** Task 8.2: the speech token, unit cases. N11 is in speechToken.property.test.ts. */

const SECRET = "test-speech-secret";
const NOW = Date.UTC(2026, 10, 13, 15, 0, 0);
const claims = { shopId: "peluqueria-lola", language: "es" as const, text: "¡Hola! Estás llamando a Peluquería Lola." };

describe("signSpeech / verifySpeech", () => {
  it("a fresh token verifies for the exact claims and carries the cacheable flag", () => {
    for (const cacheable of [true, false]) {
      const token = signSpeech({ ...claims, cacheable }, SECRET, NOW);
      expect(verifySpeech(token, claims, SECRET, NOW)).toEqual({ ok: true, cacheable, expiresAtMs: NOW + SPEECH_TOKEN_TTL_MS });
    }
  });

  it("expires after 5 minutes", () => {
    const token = signSpeech({ ...claims, cacheable: true }, SECRET, NOW);
    expect(SPEECH_TOKEN_TTL_MS).toBe(300_000);
    expect(verifySpeech(token, claims, SECRET, NOW + SPEECH_TOKEN_TTL_MS - 1).ok).toBe(true);
    expect(verifySpeech(token, claims, SECRET, NOW + SPEECH_TOKEN_TTL_MS)).toEqual({ ok: false, reason: "expired" });
  });

  it("is refused for another text, shop or language, or with another secret", () => {
    const token = signSpeech({ ...claims, cacheable: true }, SECRET, NOW);
    expect(verifySpeech(token, { ...claims, text: claims.text + " " }, SECRET, NOW)).toEqual({ ok: false, reason: "signature" });
    expect(verifySpeech(token, { ...claims, shopId: "otra" }, SECRET, NOW)).toEqual({ ok: false, reason: "signature" });
    expect(verifySpeech(token, { ...claims, language: "en" }, SECRET, NOW)).toEqual({ ok: false, reason: "signature" });
    expect(verifySpeech(token, claims, "another-secret", NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("a browser cannot turn a non-cacheable line into a cacheable one", () => {
    const token = signSpeech({ ...claims, cacheable: false }, SECRET, NOW);
    const [exp, , mac] = token.split(".");
    const forged = [exp, Buffer.from("1").toString("base64url"), mac].join(".");
    expect(verifySpeech(forged, claims, SECRET, NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("a browser cannot extend the expiry", () => {
    const token = signSpeech({ ...claims, cacheable: true }, SECRET, NOW);
    const [, flag, mac] = token.split(".");
    const later = Buffer.from(String(NOW + 10 * SPEECH_TOKEN_TTL_MS)).toString("base64url");
    expect(verifySpeech([later, flag, mac].join("."), claims, SECRET, NOW + 2 * SPEECH_TOKEN_TTL_MS)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("malformed tokens are refused without throwing", () => {
    for (const bad of ["", "abc", "a.b", "a.b.c.d", "!!.MQ.xx", `${Buffer.from("soon").toString("base64url")}.MQ.AAAA`, "MTI.Mg.AAAA"]) {
      expect(verifySpeech(bad, claims, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    }
    const token = signSpeech({ ...claims, cacheable: true }, SECRET, NOW);
    expect(verifySpeech(token.slice(0, -4), claims, SECRET, NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("fits the schema's 10–200 characters and never contains the text or the secret", () => {
    const token = signSpeech({ ...claims, text: "x".repeat(600), cacheable: true }, SECRET, NOW);
    expect(token.length).toBeGreaterThanOrEqual(10);
    expect(token.length).toBeLessThanOrEqual(200);
    expect(token).not.toContain(SECRET);
    expect(Buffer.from(token.split(".").join(""), "base64url").toString("latin1")).not.toContain("xxxx");
  });

  it("an empty secret is a configuration error, never an unsigned token", () => {
    expect(() => signSpeech({ ...claims, cacheable: true }, "", NOW)).toThrow("SPEECH_TOKEN_SECRET is not set");
    expect(() => verifySpeech("a.b.c", claims, "", NOW)).toThrow("SPEECH_TOKEN_SECRET is not set");
  });
});

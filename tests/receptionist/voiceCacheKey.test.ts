import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cacheKey, isCacheKey, lineKeys, primaryVoiceModels } from "@/lib/receptionist/voiceCacheKey";
import { getSectorPack } from "@/lib/sectors";

/** Task 9.2: the content-addressed key of a stored line. */

const MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview"];
const voiceFor = (model: string, p: { voice: string; classicVoice: string }) => (model.includes("3.8") ? p.voice : p.classicVoice);
const pack = getSectorPack("hair-salon");
const ES = pack.voice.es;
const EN = pack.voice.en;
const GREETING = "¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual. ¿En qué te puedo ayudar?";

describe("cacheKey", () => {
  it("is the first 32 hex characters of sha256 over the five inputs as a JSON array", () => {
    const key = cacheKey(MODELS[0], ES.voice, ES.style, ES.languageCode, GREETING);
    const expected = createHash("sha256")
      .update(JSON.stringify([MODELS[0], ES.voice, ES.style, ES.languageCode, GREETING]))
      .digest("hex")
      .slice(0, 32);
    expect(key).toBe(expected);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(isCacheKey(key)).toBe(true);
  });

  it("changes with the model, the voice, the style, the language and one character of the text", () => {
    const base = cacheKey(MODELS[0], ES.voice, ES.style, ES.languageCode, GREETING);
    expect(cacheKey(MODELS[1], ES.voice, ES.style, ES.languageCode, GREETING)).not.toBe(base);
    expect(cacheKey(MODELS[0], "Kore", ES.style, ES.languageCode, GREETING)).not.toBe(base);
    expect(cacheKey(MODELS[0], ES.voice, `${ES.style} `, ES.languageCode, GREETING)).not.toBe(base);
    expect(cacheKey(MODELS[0], ES.voice, ES.style, "en-US", GREETING)).not.toBe(base);
    expect(cacheKey(MODELS[0], ES.voice, ES.style, ES.languageCode, GREETING.replace("Lola", "Lolo"))).not.toBe(base);
  });

  it("a '|' cannot move a field boundary", () => {
    expect(cacheKey("a|b", "c", "s", "es-ES", "t")).not.toBe(cacheKey("a", "b|c", "s", "es-ES", "t"));
  });

  it("isCacheKey refuses anything but 32 lowercase hex characters", () => {
    for (const bad of ["", "abc", "A".repeat(32), "g".repeat(32), "0".repeat(31), "0".repeat(33), `${"0".repeat(31)}/`, "../etc/passwd"]) {
      expect(isCacheKey(bad)).toBe(false);
    }
  });
});

describe("primaryVoiceModels and lineKeys", () => {
  it("Spanish (es-es-commercial-3) is stored only for the two 3.8 models, in GEMINI_TTS_MODEL order", () => {
    expect(primaryVoiceModels(MODELS, ES, voiceFor)).toEqual(["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]);
    expect(primaryVoiceModels([...MODELS].reverse(), ES, voiceFor)).toEqual(["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"]);
    const keys = lineKeys(GREETING, ES, MODELS, voiceFor);
    expect(keys.map((k) => k.model)).toEqual(["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]);
    expect(keys[0].key).toBe(cacheKey(MODELS[0], ES.voice, ES.style, ES.languageCode, GREETING));
  });

  it("a classic voice on every model (the provisional English profile) can be stored for all three", () => {
    expect(primaryVoiceModels(MODELS, EN, voiceFor)).toEqual(MODELS);
  });

  it("no model with the primary voice: no key", () => {
    expect(lineKeys(GREETING, ES, ["gemini-3.1-flash-tts-preview"], voiceFor)).toEqual([]);
  });
});

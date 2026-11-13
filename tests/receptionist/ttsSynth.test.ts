import { describe, expect, it, vi } from "vitest";
import type { VoiceProfile } from "@/lib/sectors/types";

// `server-only` throws outside a React Server environment; the synthesizer itself is what is tested here.
vi.mock("server-only", () => ({}));

const { audioBlocksOf, createTtsSynthesizer, ttsSynthesizerFromEnv } = await import("@/lib/receptionist/ttsClient");
const { GeminiCallError } = await import("@/lib/receptionist/geminiClient");
type TtsOnceSdk = import("@/lib/receptionist/ttsClient").TtsOnceSdk;
type TtsOnceParams = import("@/lib/receptionist/ttsClient").TtsOnceParams;
type TtsInteraction = import("@/lib/receptionist/ttsClient").TtsInteraction;

/** Task 9.10: one non-streamed MP3 per line, for the pre-generation script. No real request is made. */

const KEY = "AIzaTEST-secret-key-0123456789";
const ES: VoiceProfile = {
  voice: "es-es-commercial-3",
  classicVoice: "Kore",
  languageCode: "es-ES",
  style: "Una peluquera simpática de Madrid, relajada, a ritmo natural y sonriendo.",
};
const TEXT = "¿Me dices tu nombre?";
const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 7, 7]);

function sdk(answer: () => TtsInteraction) {
  const calls: { params: TtsOnceParams; options: unknown }[] = [];
  const fake: TtsOnceSdk = {
    interactions: {
      create: (params, options) => {
        calls.push({ params, options });
        return Promise.resolve().then(answer);
      },
    },
  };
  return { fake, calls };
}
const signal = () => new AbortController().signal;

describe("createTtsSynthesizer", () => {
  it("sends one non-streamed request for MP3, the style as a speech_metadata annotation, the catalog voice, no SDK retries", async () => {
    const { fake, calls } = sdk(() => ({ output_audio: { data: MP3.toString("base64"), mime_type: "audio/mp3" } }));
    const s = createTtsSynthesizer({ apiKey: KEY, sdk: fake });
    const out = await s.synthesize({ text: TEXT, profile: ES, model: "gemini-3.8-flash-tts", signal: signal() });
    expect([...out.bytes]).toEqual([...MP3]);
    expect(out.mime).toBe("audio/mpeg");
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({
      model: "gemini-3.8-flash-tts",
      store: false,
      input: [
        {
          type: "text",
          text: TEXT,
          annotations: [{ type: "speech_metadata", style: ES.style, start_index: 0, end_index: Buffer.byteLength(TEXT) }],
        },
      ],
      response_format: { type: "audio", mime_type: "audio/mp3" },
      generation_config: { speech_config: [{ voice: "es-es-commercial-3", language: "es-ES" }] },
    });
    expect(calls[0].params).not.toHaveProperty("stream");
    expect(calls[0].options).toMatchObject({ retries: { strategy: "none" } });
  });

  it("uses the classic voice on a model without the catalog", async () => {
    const { fake, calls } = sdk(() => ({ output_audio: { data: MP3.toString("base64") } }));
    await createTtsSynthesizer({ apiKey: KEY, sdk: fake }).synthesize({
      text: TEXT,
      profile: ES,
      model: "gemini-3.1-flash-tts-preview",
      signal: signal(),
    });
    expect(calls[0].params.generation_config.speech_config[0].voice).toBe("Kore");
  });

  it("a 429 leaves as a GeminiCallError with its status and the key redacted", async () => {
    const err = Object.assign(new Error(`429 quota exceeded key=${KEY}`), { status: 429 });
    const { fake } = sdk(() => {
      throw err;
    });
    const p = createTtsSynthesizer({ apiKey: KEY, sdk: fake }).synthesize({ text: TEXT, profile: ES, model: "gemini-3.8-flash-tts", signal: signal() });
    await expect(p).rejects.toBeInstanceOf(GeminiCallError);
    await expect(p).rejects.toMatchObject({ status: 429 });
    await p.catch((e: Error) => expect(e.message).not.toContain(KEY));
  });

  it("an answer with no audio is an error, not an empty file", async () => {
    const { fake } = sdk(() => ({ steps: [] }));
    await expect(
      createTtsSynthesizer({ apiKey: KEY, sdk: fake }).synthesize({ text: TEXT, profile: ES, model: "gemini-3.8-flash-tts", signal: signal() }),
    ).rejects.toMatchObject({ errorClass: "NoAudio" });
  });

  it("an aborted request spends nothing", async () => {
    const { fake, calls } = sdk(() => ({}));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      createTtsSynthesizer({ apiKey: KEY, sdk: fake }).synthesize({ text: TEXT, profile: ES, model: "gemini-3.8-flash-tts", signal: ctrl.signal }),
    ).rejects.toBeInstanceOf(GeminiCallError);
    expect(calls).toEqual([]);
  });

  it("needs the key from the environment, and never puts it in the message", () => {
    expect(() => ttsSynthesizerFromEnv({})).toThrow("GEMINI_API_KEY is not set");
  });
});

describe("audioBlocksOf", () => {
  it("collects audio from output_audio and the steps, each payload once", () => {
    const a = Buffer.from([1]).toString("base64");
    const b = Buffer.from([2]).toString("base64");
    expect(
      audioBlocksOf({
        output_audio: { data: b, mime_type: "audio/mp3" },
        steps: [{ content: [{ type: "text" }, { type: "audio", data: a }] }, { content: [{ type: "audio", data: b }] }],
      }).map((x) => x.data),
    ).toEqual([b, a]);
  });
});

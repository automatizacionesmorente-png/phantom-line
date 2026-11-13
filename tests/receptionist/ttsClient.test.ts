import { describe, expect, it, vi } from "vitest";
import type { VoiceProfile } from "@/lib/sectors/types";

// `server-only` throws outside a React Server environment; the client itself is what is tested here.
vi.mock("server-only", () => ({}));

const { createTtsClient, parseTtsModelList, statusOfEventCode, ttsClientFromEnv, usesCatalogVoice, DEFAULT_TTS_MODELS } =
  await import("@/lib/receptionist/ttsClient");
const { GeminiCallError } = await import("@/lib/receptionist/geminiClient");
type TtsSdk = import("@/lib/receptionist/ttsClient").TtsSdk;
type TtsStreamEvent = import("@/lib/receptionist/ttsClient").TtsStreamEvent;

/** Task 8.1: the TTS client against a fake `interactions` that streams, fails with the SDK's real shapes, or hangs. */

const KEY = "AIzaTEST-secret-key-0123456789";
const PROFILE: VoiceProfile = {
  voice: "es-es-commercial-3",
  classicVoice: "Kore",
  languageCode: "es-ES",
  style: "Una peluquera simpática de Madrid, relajada, a ritmo natural y sonriendo.",
};
const TEXT = "¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual. ¿En qué te puedo ayudar?";

/**
 * The SDK's error classes are not exported, so these copy their shape from
 * node_modules/@google/genai/dist/node/index.cjs (`APIError.generate`): the class name, `status`
 * and `statusCode`, the parsed `error` body, and a message "<status> <error.message>".
 */
class APIError extends Error {
  readonly status: number;
  readonly statusCode: number;
  readonly error: unknown;
  readonly headers: Headers;
  constructor(status: number, error: { code: number; message: string; status: string }) {
    super(`${status} ${error.message}`);
    this.status = status;
    this.statusCode = status;
    this.error = error;
    this.headers = new Headers({ "content-type": "application/json" });
    this.name = this.constructor.name;
  }
}
class RateLimitError extends APIError {}
class BadRequestError extends APIError {}

/** The 429 the free tier sent in the spike (design.md, "Quota"), with the key echoed to prove redaction. */
const real429 = () =>
  new RateLimitError(429, {
    code: 429,
    message:
      `You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generate_requests_per_model_per_day, limit: 10 requests per day on Free Tier, model: gemini-3.8-flash-tts. Please retry in 9h20m25s. key=${KEY}`,
    status: "RESOURCE_EXHAUSTED",
  });
/** The 400 `gemini-3.1-flash-tts-preview` sent for a catalog voice in the spike. */
const real400 = () =>
  new BadRequestError(400, {
    code: 400,
    message: "No matching speaker voice found for name: es-es-commercial-3 and language: es-ES",
    status: "INVALID_ARGUMENT",
  });

const audio = (bytes: number[], rate = 24000): TtsStreamEvent => ({
  event_type: "step.delta",
  delta: { type: "audio", data: Buffer.from(bytes).toString("base64"), mime_type: "audio/l16", sample_rate: rate },
});

async function* events(list: TtsStreamEvent[]): AsyncIterable<TtsStreamEvent> {
  for (const e of list) yield e;
}

function fakeSdk(impl: TtsSdk["interactions"]["create"]) {
  const create = vi.fn(impl);
  return { sdk: { interactions: { create } } satisfies TtsSdk, create };
}

async function collect(it: AsyncIterable<{ pcm: Uint8Array; sampleRate: number }>) {
  const out: { pcm: number[]; sampleRate: number }[] = [];
  for await (const c of it) out.push({ pcm: [...c.pcm], sampleRate: c.sampleRate });
  return out;
}

const caught = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as InstanceType<typeof GeminiCallError>);

describe("createTtsClient: streaming", () => {
  it("streams each audio delta as PCM, in order, and skips other events", async () => {
    const { sdk } = fakeSdk(async () =>
      events([
        { event_type: "interaction.created" },
        { event_type: "step.start" },
        audio([1, 2, 3, 4]),
        { event_type: "step.delta", delta: { type: "text", data: undefined } },
        audio([5, 6]),
        { event_type: "step.stop" },
        { event_type: "interaction.completed" },
      ]),
    );
    const client = createTtsClient({ apiKey: KEY, models: "gemini-3.8-flash-tts", sdk });
    const chunks = await collect(
      client.stream({ text: TEXT, profile: PROFILE, model: "gemini-3.8-flash-tts", signal: new AbortController().signal }),
    );
    expect(chunks).toEqual([
      { pcm: [1, 2, 3, 4], sampleRate: 24000 },
      { pcm: [5, 6], sampleRate: 24000 },
    ]);
  });

  it("sends store: false, stream, the style as a speech_metadata annotation over the whole text in bytes, the signal and no retries", async () => {
    const { sdk, create } = fakeSdk(async () => events([audio([0, 0])]));
    const client = createTtsClient({ apiKey: KEY, sdk });
    const signal = new AbortController().signal;
    await collect(client.stream({ text: TEXT, profile: PROFILE, model: "gemini-3.8-flash-tts", signal }));

    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0];
    expect(params).toEqual({
      model: "gemini-3.8-flash-tts",
      store: false,
      stream: true,
      input: [
        {
          type: "text",
          text: TEXT,
          annotations: [{ type: "speech_metadata", style: PROFILE.style, start_index: 0, end_index: Buffer.byteLength(TEXT, "utf8") }],
        },
      ],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "es-es-commercial-3", language: "es-ES" }] },
    });
    // The text has "¡", "í", "é", "¿": the annotation counts bytes, not UTF-16 code units.
    expect(Buffer.byteLength(TEXT, "utf8")).toBeGreaterThan(TEXT.length);
    expect(options.signal).toBe(signal);
    expect(options.retries).toEqual({ strategy: "none" });
    // The style is never part of the words (Requirement 3.5).
    expect(params.input[0].text).not.toContain(PROFILE.style);
    expect(JSON.stringify(params)).not.toContain("system_instruction");
  });

  it("sends the catalog voice to the 3.8 models and the classic voice to the others", async () => {
    const { sdk, create } = fakeSdk(async () => events([audio([0, 0])]));
    const client = createTtsClient({ apiKey: KEY, sdk });
    const signal = new AbortController().signal;
    for (const model of DEFAULT_TTS_MODELS) await collect(client.stream({ text: "Hola.", profile: PROFILE, model, signal }));
    expect(create.mock.calls.map((c) => c[0].generation_config.speech_config[0].voice)).toEqual([
      "es-es-commercial-3",
      "es-es-commercial-3",
      "Kore",
    ]);
    expect(DEFAULT_TTS_MODELS.map((m) => client.voiceFor(m, PROFILE))).toEqual(["es-es-commercial-3", "es-es-commercial-3", "Kore"]);
  });

  it("keeps the sample rate the API reports", async () => {
    const { sdk } = fakeSdk(async () => events([audio([9, 9], 16000)]));
    const chunks = await collect(
      createTtsClient({ apiKey: KEY, sdk }).stream({ text: "Hola.", profile: PROFILE, model: "m", signal: new AbortController().signal }),
    );
    expect(chunks[0].sampleRate).toBe(16000);
  });
});

describe("createTtsClient: errors", () => {
  it("the real 429 shape: rethrown as GeminiCallError with status 429, the class name kept and the key redacted", async () => {
    const { sdk, create } = fakeSdk(async () => {
      throw real429();
    });
    const client = createTtsClient({ apiKey: KEY, sdk });
    const err = await caught(
      collect(client.stream({ text: TEXT, profile: PROFILE, model: "gemini-3.8-flash-tts", signal: new AbortController().signal })),
    );
    expect(err).toBeInstanceOf(GeminiCallError);
    expect(err?.status).toBe(429);
    expect(err?.statusCode).toBe(429);
    expect(err?.errorClass).toBe("RateLimitError");
    expect(err?.message).toContain("limit: 10 requests per day");
    expect(err?.message).toContain("key=***");
    expect(JSON.stringify(err) + String(err?.message)).not.toContain(KEY);
    // No retry inside the client: one request, whatever the error.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("the real 400 for a catalog voice: status 400, and the model gets the classic voice from then on", async () => {
    let calls = 0;
    const { sdk, create } = fakeSdk(async () => {
      calls++;
      if (calls === 1) throw real400();
      return events([audio([1, 1])]);
    });
    const client = createTtsClient({ apiKey: KEY, sdk });
    const signal = new AbortController().signal;
    const model = "gemini-3.8-flash-tts";
    const err = await caught(collect(client.stream({ text: "Hola.", profile: PROFILE, model, signal })));
    expect(err?.status).toBe(400);
    expect(err?.errorClass).toBe("BadRequestError");
    expect(client.voiceFor(model, PROFILE)).toBe("Kore");
    await collect(client.stream({ text: "Hola.", profile: PROFILE, model, signal }));
    expect(create.mock.calls.map((c) => c[0].generation_config.speech_config[0].voice)).toEqual(["es-es-commercial-3", "Kore"]);
    // Another 3.8 model keeps the catalog voice.
    expect(client.voiceFor("gemini-3.8-flash-lite-tts", PROFILE)).toBe("es-es-commercial-3");
  });

  it("a 400 for another reason does not change the voice", async () => {
    const { sdk } = fakeSdk(async () => {
      throw new BadRequestError(400, { code: 400, message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" });
    });
    const client = createTtsClient({ apiKey: KEY, sdk });
    const err = await caught(
      collect(client.stream({ text: "Hola.", profile: PROFILE, model: "gemini-3.8-flash-tts", signal: new AbortController().signal })),
    );
    expect(err?.status).toBe(400);
    expect(client.voiceFor("gemini-3.8-flash-tts", PROFILE)).toBe("es-es-commercial-3");
  });

  it("a streamed error event (the 2.5 model's 429) becomes a GeminiCallError with its status, key redacted", async () => {
    const { sdk } = fakeSdk(async () =>
      events([{ event_type: "error", error: { code: "RESOURCE_EXHAUSTED", message: `quota (key ${KEY})` } }]),
    );
    const err = await caught(
      collect(createTtsClient({ apiKey: KEY, sdk }).stream({ text: "Hola.", profile: PROFILE, model: "m", signal: new AbortController().signal })),
    );
    expect(err).toBeInstanceOf(GeminiCallError);
    expect(err?.status).toBe(429);
    expect(err?.errorClass).toBe("StreamErrorEvent");
    expect(err?.message).not.toContain(KEY);
  });

  it("an error after the first chunk is thrown after that chunk was yielded", async () => {
    const { sdk } = fakeSdk(async () =>
      (async function* () {
        yield audio([7, 7]);
        throw Object.assign(new Error("socket hang up"), { name: "APIConnectionError" });
      })(),
    );
    const got: number[][] = [];
    const err = await caught(
      (async () => {
        for await (const c of createTtsClient({ apiKey: KEY, sdk }).stream({
          text: "Hola.",
          profile: PROFILE,
          model: "m",
          signal: new AbortController().signal,
        }))
          got.push([...c.pcm]);
      })(),
    );
    expect(got).toEqual([[7, 7]]);
    expect(err).toBeInstanceOf(GeminiCallError);
  });
});

describe("createTtsClient: a hang", () => {
  it("a request that never answers and ignores the abort still rejects as soon as the signal aborts", async () => {
    const { sdk } = fakeSdk(() => new Promise<never>(() => undefined));
    const ctrl = new AbortController();
    const pending = caught(collect(createTtsClient({ apiKey: KEY, sdk }).stream({ text: "Hola.", profile: PROFILE, model: "m", signal: ctrl.signal })));
    setTimeout(() => ctrl.abort(new DOMException("deadline", "TimeoutError")), 20);
    const t0 = Date.now();
    const err = await pending;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(err).toBeInstanceOf(GeminiCallError);
    expect(err?.errorClass).toBe("TimeoutError");
    expect(err?.status).toBeUndefined();
  });

  it("a stream that stops sending chunks rejects when the signal aborts", async () => {
    const { sdk } = fakeSdk(async () => ({
      [Symbol.asyncIterator]() {
        let sent = false;
        return {
          next: () => (sent ? new Promise<never>(() => undefined) : ((sent = true), Promise.resolve({ done: false, value: audio([3, 3]) }))),
        };
      },
    }));
    const ctrl = new AbortController();
    const got: number[][] = [];
    const run = caught(
      (async () => {
        for await (const c of createTtsClient({ apiKey: KEY, sdk }).stream({ text: "Hola.", profile: PROFILE, model: "m", signal: ctrl.signal }))
          got.push([...c.pcm]);
      })(),
    );
    setTimeout(() => ctrl.abort(), 20);
    const err = await run;
    expect(got).toEqual([[3, 3]]);
    expect(err?.errorClass).toBe("AbortError");
  });

  it("an already aborted signal never calls the model", async () => {
    const { sdk, create } = fakeSdk(async () => events([audio([1])]));
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await caught(collect(createTtsClient({ apiKey: KEY, sdk }).stream({ text: "Hola.", profile: PROFILE, model: "m", signal: ctrl.signal })));
    expect(err).toBeInstanceOf(GeminiCallError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("configuration", () => {
  it("GEMINI_TTS_MODEL: a comma-separated list, deduplicated; empty or missing gives the default list", () => {
    expect(parseTtsModelList(undefined)).toEqual([...DEFAULT_TTS_MODELS]);
    expect(parseTtsModelList(" , ")).toEqual([...DEFAULT_TTS_MODELS]);
    expect(parseTtsModelList(" a , b,,a ")).toEqual(["a", "b"]);
    expect(DEFAULT_TTS_MODELS).toEqual(["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview"]);
    expect(createTtsClient({ apiKey: "k", models: "x,y", sdk: fakeSdk(async () => events([])).sdk }).models).toEqual(["x", "y"]);
  });

  it("only the 3.8 family takes catalog voices", () => {
    expect(usesCatalogVoice("gemini-3.8-flash-tts")).toBe(true);
    expect(usesCatalogVoice("gemini-3.8-flash-lite-tts")).toBe(true);
    expect(usesCatalogVoice("gemini-3.1-flash-tts-preview")).toBe(false);
    expect(usesCatalogVoice("gemini-2.5-flash-preview-tts")).toBe(false);
  });

  it("maps streamed error codes to HTTP statuses", () => {
    expect(statusOfEventCode("429")).toBe(429);
    expect(statusOfEventCode("RESOURCE_EXHAUSTED")).toBe(429);
    expect(statusOfEventCode("INVALID_ARGUMENT")).toBe(400);
    expect(statusOfEventCode("UNAVAILABLE")).toBe(503);
    expect(statusOfEventCode("something-else")).toBeUndefined();
    expect(statusOfEventCode(undefined)).toBeUndefined();
  });

  it("from the environment: a missing key fails without printing anything secret", () => {
    expect(() => ttsClientFromEnv({})).toThrow("GEMINI_API_KEY is not set");
  });
});

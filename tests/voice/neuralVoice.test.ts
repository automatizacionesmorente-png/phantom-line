import { describe, expect, it } from "vitest";
import {
  createNeuralVoicePort,
  pcm16ToFloat,
  sampleRateOf,
  tokenCacheable,
  type AudioBufferLike,
  type AudioBufferSourceLike,
  type AudioContextLike,
  type AudioElementLike,
  type NeuralWindowLike,
} from "@/lib/voice/neuralVoice";
import { createFakeSpeechPort, type SpeakResult } from "@/lib/voice/speechPort";
import type { SpeechHint } from "@/lib/voice/speechRequest";

/**
 * natural-voice 10.5: the neural SpeechPort with fake browser objects. A manual clock drives
 * `now`, `setTimeout` and the AudioContext's `currentTime`, so the 4.5 s deadline, the 300 ms
 * buffer and the end of the audio are tested exactly.
 */
const SHOP = "peluqueria-lola";
const TEXT = "Mañana a las cuatro estamos cerrados, abrimos a las cinco.";
const LIVE: SpeechHint = { kind: "live", token: "MTc2MzA0.MQ.c2lnbmF0dXJl", rate: 1.1 };
const CACHED: SpeechHint = { kind: "cached", url: "/api/voice/0123456789abcdef0123456789abcdef", rate: 1.1 };

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

class FakeBuffer implements AudioBufferLike {
  data: Float32Array;
  constructor(
    public length: number,
    public sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  copyToChannel(source: Float32Array) {
    this.data.set(source);
  }
}
class FakeSource implements AudioBufferSourceLike {
  buffer: AudioBufferLike | null = null;
  playbackRate = { value: 1 };
  startedAt: number | null = null;
  stopped = false;
  connect() {
    return undefined;
  }
  start(when = 0) {
    this.startedAt = when;
  }
  stop() {
    this.stopped = true;
  }
}
class FakeAudio implements AudioElementLike {
  static last: FakeAudio | null = null;
  src = "";
  preservesPitch = false;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  paused = true;
  listeners = new Map<string, (() => void)[]>();
  constructor() {
    FakeAudio.last = this;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  fire(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

interface Sent {
  url: string;
  body: Record<string, unknown>;
  signal?: AbortSignal | null;
}

function world(answer: (body: Record<string, unknown>) => Response | Promise<Response>) {
  let clock = 0;
  const timers: { id: number; due: number; fn: () => void }[] = [];
  let nextId = 1;
  const sources: FakeSource[] = [];
  const ctx: AudioContextLike & { resumed: number } = {
    get currentTime() {
      return clock / 1000;
    },
    destination: {},
    resumed: 0,
    createBuffer: (_c, length, sampleRate) => new FakeBuffer(length, sampleRate),
    createBufferSource: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    resume() {
      this.resumed++;
      return Promise.resolve();
    },
  };
  const sent: Sent[] = [];
  const win: NeuralWindowLike = {
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push({ url: String(url), body, signal: init?.signal });
      return answer(body);
    }) as typeof fetch,
    AudioContext: class {
      constructor() {
        return ctx;
      }
    } as unknown as new () => AudioContextLike,
    Audio: FakeAudio,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, due: clock + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  async function advance(ms: number) {
    const target = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.due - b.due || a.id - b.id);
      const t = timers[0];
      if (!t || t.due > target) break;
      timers.shift();
      clock = t.due;
      t.fn();
      await flush();
    }
    clock = target;
    await flush();
  }
  return { win, ctx, sources, sent, advance, now: () => clock };
}

/** A /api/speech answer whose PCM chunks the test pushes by hand. */
function pcmStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const response = new Response(body, { status: 200, headers: { "content-type": "audio/L16; rate=24000; channels=1" } });
  /** `ms` of a 200 Hz tone as 16-bit little-endian PCM at 24 kHz. */
  const push = (ms: number) => {
    const n = Math.round((ms / 1000) * 24_000);
    const bytes = new Uint8Array(2 * n);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < n; i++) view.setInt16(2 * i, Math.round(8000 * Math.sin((2 * Math.PI * 200 * i) / 24_000)), true);
    controller.enqueue(bytes);
  };
  return { response, push, end: () => controller.close(), fail: () => controller.error(new TypeError("network")) };
}

function setup(answer: (body: Record<string, unknown>) => Response | Promise<Response>, fallbackSpeaks: SpeakResult[] = []) {
  const w = world(answer);
  const fallback = createFakeSpeechPort({ speaks: fallbackSpeaks });
  const port = createNeuralVoicePort(w.win, fallback, { shopId: SHOP, now: w.now });
  return { ...w, fallback, port };
}

const reports = (sent: Sent[]) => sent.filter((s) => s.body.kind === "report").map((s) => s.body);

describe("neuralVoice: cached lines through an <audio> element", () => {
  it("plays the URL with preservesPitch and the shop's rate, and resolves when the element ends", async () => {
    const { port, fallback, sent, advance } = setup(() => new Response(null, { status: 500 }));
    let result: SpeakResult | null = null;
    void port.speak(TEXT, "es", CACHED).then((r) => (result = r));
    const el = FakeAudio.last!;
    expect(el).toMatchObject({ src: CACHED.url, preservesPitch: true, playbackRate: 1.1, defaultPlaybackRate: 1.1, paused: false });
    await advance(200);
    el.fire("playing");
    await advance(4000); // past the deadline: it started in time, so nothing changes
    expect(result).toBeNull();
    el.fire("ended");
    await flush();
    expect(result).toEqual({ type: "done" });
    expect(fallback.spoken).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("a playback error is spoken by the browser voice and reported as a Fixed_Phrase", async () => {
    const { port, fallback, sent, advance } = setup(() => new Response(null, { status: 204 }));
    const p = port.speak(TEXT, "es", CACHED);
    await advance(300);
    FakeAudio.last!.fire("error");
    await flush();
    expect(await p).toEqual({ type: "done" });
    expect(fallback.spoken).toEqual([{ text: TEXT, lang: "es" }]); // rate 1.0: no hint to the browser voice
    expect(reports(sent)).toEqual([{ kind: "report", shopId: SHOP, language: "es", reason: "playback_error", fixed: true, latencyMs: 300 }]);
    expect(FakeAudio.last!.paused).toBe(true);
  });
});

describe("neuralVoice: live lines streamed from /api/speech", () => {
  it("posts the reply with its token, stretches at 1.1, plays once 300 ms are buffered, and resolves after the last sample", async () => {
    const stream = pcmStream();
    const { port, fallback, sent, sources, advance } = setup(() => stream.response);
    let result: SpeakResult | null = null;
    void port.speak(TEXT, "es", LIVE).then((r) => (result = r));
    await flush();
    expect(sent[0]).toMatchObject({ url: "/api/speech", body: { kind: "say", shopId: SHOP, language: "es", text: TEXT, token: LIVE.token } });

    await advance(600);
    stream.push(200); // ~182 ms of output: still buffering
    await flush();
    expect(sources).toHaveLength(0);
    await advance(100);
    stream.push(200); // ~364 ms buffered: play
    await flush();
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].startedAt).toBeCloseTo(0.7, 5);
    await advance(100);
    stream.push(1000);
    stream.end();
    await flush();

    const played = sources.reduce((s, x) => s + x.buffer!.duration, 0);
    expect(played).toBeCloseTo(1.4 / 1.1, 2); // 1.4 s of PCM at 1.1
    expect(sources.every((s) => s.playbackRate.value === 1)).toBe(true); // the pitch is kept by WSOLA, not by resampling
    const end = Math.max(...sources.map((s) => s.startedAt! + s.buffer!.duration));
    await advance(end * 1000 - 800 - 10);
    expect(result).toBeNull(); // still playing: no listening yet (1.8)
    await advance(200);
    expect(result).toEqual({ type: "done" });
    expect(fallback.spoken).toEqual([]);
    expect(reports(sent)).toEqual([]);
  });

  it("no audio by 4.5 s: the request is aborted, the browser voice speaks, a deadline report is sent, and late audio is dropped", async () => {
    const stream = pcmStream();
    const { port, fallback, sent, sources, advance } = setup(() => stream.response);
    const p = port.speak(TEXT, "es", LIVE);
    await advance(2000);
    stream.push(100);
    await advance(2500);
    expect(sent[0].signal?.aborted).toBe(true);
    expect(fallback.spoken).toEqual([{ text: TEXT, lang: "es" }]);
    expect(reports(sent)).toEqual([{ kind: "report", shopId: SHOP, language: "es", reason: "deadline", fixed: true, latencyMs: 4500 }]);
    expect(await p).toEqual({ type: "done" });
    expect(sources).toHaveLength(0);
  });

  it("a 429 quota answer: the browser voice now and for the rest of the Call, with no more TTS requests", async () => {
    const { port, fallback, sent, advance } = setup(() => Response.json({ fallback: "quota" }, { status: 429 }));
    const p = port.speak(TEXT, "es", LIVE);
    await advance(10);
    expect(await p).toEqual({ type: "done" });
    expect(port.quotaOut).toBe(true);
    expect(await port.speak("¿A nombre de quién?", "es", CACHED)).toEqual({ type: "done" });
    expect(fallback.spoken.map((s) => s.text)).toEqual([TEXT, "¿A nombre de quién?"]);
    expect(sent.map((s) => s.body.kind)).toEqual(["say"]); // no report: the server logged the 429
  });

  it("a rate-limit 429 or a 503 falls back for this reply only", async () => {
    const answers = [Response.json({ fallback: "rate_limit" }, { status: 429 }), Response.json({ fallback: "unavailable" }, { status: 503 })];
    const { port, fallback, advance } = setup(() => answers.shift()!);
    const a = port.speak("uno", "es", LIVE);
    await advance(10);
    await a;
    const b = port.speak("dos", "es", { ...LIVE, token: "MTc2.MA.c2ln" });
    await advance(10);
    await b;
    expect(port.quotaOut).toBe(false);
    expect(fallback.spoken.map((s) => s.text)).toEqual(["uno", "dos"]);
  });

  it("a stream that breaks after it started is a stall: the audio stops and the whole reply is spoken again", async () => {
    const stream = pcmStream();
    const { port, fallback, sent, sources, advance } = setup(() => stream.response);
    const p = port.speak(TEXT, "es", { ...LIVE, token: "MTc2.MA.c2ln" });
    await advance(500);
    stream.push(500);
    await flush();
    expect(sources.length).toBeGreaterThan(0);
    stream.fail();
    await flush();
    expect(sources.every((s) => s.stopped)).toBe(true);
    expect(fallback.spoken).toEqual([{ text: TEXT, lang: "es" }]);
    expect(reports(sent)).toEqual([{ kind: "report", shopId: SHOP, language: "es", reason: "stall", fixed: false, latencyMs: 500 }]);
    expect(await p).toEqual({ type: "done" });
  });

  it("stop() during playback stops the audio and settles the reply as aborted", async () => {
    const stream = pcmStream();
    const { port, fallback, sources, advance } = setup(() => stream.response);
    const p = port.speak(TEXT, "es", LIVE);
    await advance(300);
    stream.push(500);
    await flush();
    port.stop();
    expect(await p).toEqual({ type: "error", kind: "aborted" });
    expect(sources.every((s) => s.stopped)).toBe(true);
    expect(fallback.stops).toBe(1);
  });
});

describe("neuralVoice: the port around it", () => {
  it("with no hint the browser voice speaks, and recognition is the fallback's", async () => {
    const { port, fallback } = setup(() => new Response(null, { status: 500 }));
    expect(await port.speak(TEXT, "es")).toEqual({ type: "done" });
    expect(fallback.spoken).toEqual([{ text: TEXT, lang: "es" }]);
    void port.listen({ lang: "en" });
    expect(fallback.listened).toEqual(["en"]);
    expect(port.supports).toEqual({ recognition: true, synthesis: true });
  });

  it("after a neural failure, a missing browser voice does not mute the language for the Call", async () => {
    const { port, advance } = setup(() => Response.json({ fallback: "unavailable" }, { status: 503 }), [
      { type: "error", kind: "synthesis-unavailable" },
      { type: "error", kind: "synthesis-unavailable" },
    ]);
    const p = port.speak(TEXT, "es", LIVE);
    await advance(10);
    expect(await p).toEqual({ type: "error", kind: "synthesis-failed" });
    expect(await port.speak(TEXT, "es")).toEqual({ type: "error", kind: "synthesis-unavailable" });
  });

  it("unlock creates and resumes the AudioContext inside the gesture", () => {
    const { port, ctx } = setup(() => new Response(null, { status: 500 }));
    port.unlock?.();
    expect(ctx.resumed).toBe(1);
  });

  it("helpers: 16-bit PCM with an odd byte across chunks, the content type's rate, the token's cacheable flag", () => {
    const a = pcm16ToFloat(new Uint8Array([0x00, 0x40, 0xff]), null);
    expect(Array.from(a.samples)).toEqual([0.5]);
    expect(a.carry).toBe(0xff);
    const b = pcm16ToFloat(new Uint8Array([0xff]), a.carry);
    expect(Array.from(b.samples)).toEqual([-1 / 32768]);
    expect(b.carry).toBeNull();
    expect(sampleRateOf("audio/L16; rate=24000; channels=1")).toBe(24_000);
    expect(sampleRateOf("audio/L16; rate=16000")).toBe(16_000);
    expect(sampleRateOf(null)).toBe(24_000);
    expect(tokenCacheable("MTc2.MQ.c2ln")).toBe(true);
    expect(tokenCacheable("MTc2.MA.c2ln")).toBe(false);
  });
});

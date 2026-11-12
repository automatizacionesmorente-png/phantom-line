import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSpeechPort,
  createTypedOnlyPort,
  createWebSpeechPort,
  listenEvent,
  pickVoice,
  speakEvent,
  type RecognitionLike,
  type RecognitionResultEventLike,
  type SpeechWindowLike,
  type UtteranceLike,
  type VoiceLike,
} from "@/lib/voice/speechPort";

/** A stand-in for Chrome's SpeechRecognition: tests drive its handlers by hand. */
class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  phrases?: unknown = [];
  onresult: ((ev: RecognitionResultEventLike) => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  aborted = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  abort() {
    this.aborted = true;
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  }
  say(text: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
  }
}

class FakeSynthesis {
  voices: VoiceLike[] = [];
  spoken: UtteranceLike[] = [];
  cancels = 0;
  private listeners = new Set<() => void>();
  getVoices() {
    return this.voices;
  }
  speak(u: UtteranceLike) {
    this.spoken.push(u);
  }
  cancel() {
    this.cancels++;
  }
  addEventListener(_: "voiceschanged", fn: () => void) {
    this.listeners.add(fn);
  }
  removeEventListener(_: "voiceschanged", fn: () => void) {
    this.listeners.delete(fn);
  }
  loadVoices(v: VoiceLike[]) {
    this.voices = v;
    for (const fn of [...this.listeners]) fn();
  }
}

class FakeUtterance implements UtteranceLike {
  lang = "";
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

function fakeWindow(extra: Partial<SpeechWindowLike> = {}): SpeechWindowLike & { synth: FakeSynthesis } {
  const synth = new FakeSynthesis();
  return {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
    setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
    ...extra,
    synth,
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const ES = { lang: "es-ES", name: "Mónica" };
const EN = { lang: "en-US", name: "Samantha" };

afterEach(() => {
  FakeRecognition.instances = [];
  vi.useRealTimers();
});

describe("createWebSpeechPort: recognition", () => {
  it("detects the standard and the webkit-prefixed constructor, or none", () => {
    expect(createWebSpeechPort(fakeWindow({ SpeechRecognition: FakeRecognition })).supports.recognition).toBe(true);
    expect(createWebSpeechPort(fakeWindow({ webkitSpeechRecognition: FakeRecognition })).supports.recognition).toBe(true);
    expect(createWebSpeechPort(fakeWindow()).supports).toEqual({ recognition: false, synthesis: true });
    expect(createWebSpeechPort({ setTimeout: () => 0, clearTimeout: () => {} }).supports).toEqual({
      recognition: false,
      synthesis: false,
    });
  });

  it("without a constructor, listen reports unavailable (the reducer switches to Typed_Mode)", async () => {
    expect(await createWebSpeechPort(fakeWindow()).listen({ lang: "es" })).toEqual({ type: "error", kind: "unavailable" });
  });

  it("configures one utterance in es-ES with interim results, reports interim text and returns the final text", async () => {
    const port = createWebSpeechPort(fakeWindow({ webkitSpeechRecognition: FakeRecognition }));
    const interim: string[] = [];
    const p = port.listen({ lang: "es", onInterim: (t) => interim.push(t) });
    await tick();
    const rec = FakeRecognition.instances[0];
    expect(rec).toMatchObject({ lang: "es-ES", continuous: false, interimResults: true, started: true });
    rec.say("quiero un", false);
    rec.say(" quiero un corte ", true);
    rec.onend!();
    expect(interim).toEqual(["quiero un"]);
    expect(await p).toEqual({ type: "final", text: "quiero un corte" });
  });

  it("an end without words is no-speech; Chrome error codes pass through; unknown codes count as network", async () => {
    const port = createWebSpeechPort(fakeWindow({ SpeechRecognition: FakeRecognition }));
    const a = port.listen({ lang: "en" });
    await tick();
    expect(FakeRecognition.instances[0].lang).toBe("en-US");
    FakeRecognition.instances[0].onend!();
    expect(await a).toEqual({ type: "error", kind: "no-speech" });

    const b = port.listen({ lang: "es" });
    await tick();
    FakeRecognition.instances[1].onerror!({ error: "not-allowed" });
    expect(await b).toEqual({ type: "error", kind: "not-allowed" });

    const c = port.listen({ lang: "es" });
    await tick();
    FakeRecognition.instances[2].onerror!({ error: "something-new" });
    expect(await c).toEqual({ type: "error", kind: "network" });
  });

  it("calls available() once per language when it exists, and treats 'unavailable' as no recognition", async () => {
    const available = vi.fn(
      async ({ langs }: { langs: string[] }): Promise<"available" | "unavailable"> => (langs[0] === "en-US" ? "unavailable" : "available"),
    );
    const Ctor = Object.assign(class extends FakeRecognition {}, { available });
    const port = createWebSpeechPort(fakeWindow({ SpeechRecognition: Ctor }));

    expect(await port.listen({ lang: "en" })).toEqual({ type: "error", kind: "unavailable" });
    expect(await port.listen({ lang: "en" })).toEqual({ type: "error", kind: "unavailable" });
    expect(available).toHaveBeenCalledTimes(1);
    expect(available).toHaveBeenCalledWith({ langs: ["en-US"], processLocally: false });

    const p = port.listen({ lang: "es" });
    await tick();
    expect(FakeRecognition.instances).toHaveLength(1);
    FakeRecognition.instances[0].say("hola", true);
    FakeRecognition.instances[0].onend!();
    expect(await p).toEqual({ type: "final", text: "hola" });
  });

  it("passes service names as phrases when SpeechRecognitionPhrase exists, and retries without them if rejected", async () => {
    class Phrase {
      constructor(
        public phrase: string,
        public boost = 1,
      ) {}
    }
    const port = createWebSpeechPort(fakeWindow({ SpeechRecognition: FakeRecognition, SpeechRecognitionPhrase: Phrase }), {
      phrases: ["corte", "tinte"],
    });
    const p = port.listen({ lang: "es" });
    await tick();
    const first = FakeRecognition.instances[0];
    expect(first.phrases).toEqual([new Phrase("corte"), new Phrase("tinte")]);
    first.onerror!({ error: "phrases-not-supported" });
    await tick();
    const second = FakeRecognition.instances[1];
    expect(second.phrases).toEqual([]); // untouched default
    second.say("un tinte", true);
    second.onend!();
    expect(await p).toEqual({ type: "final", text: "un tinte" });
  });

  it("does not set phrases when the browser has no SpeechRecognitionPhrase", async () => {
    const port = createWebSpeechPort(fakeWindow({ SpeechRecognition: FakeRecognition }), { phrases: ["corte"] });
    void port.listen({ lang: "es" });
    await tick();
    expect(FakeRecognition.instances[0].phrases).toEqual([]);
  });

  it("a new listen or stop() aborts the current one, which settles as aborted", async () => {
    const port = createWebSpeechPort(fakeWindow({ SpeechRecognition: FakeRecognition }));
    const a = port.listen({ lang: "es" });
    await tick();
    const b = port.listen({ lang: "en" });
    expect(await a).toEqual({ type: "error", kind: "aborted" });
    expect(FakeRecognition.instances[0].aborted).toBe(true);
    await tick();
    port.stop();
    expect(await b).toEqual({ type: "error", kind: "aborted" });
  });
});

describe("createWebSpeechPort: synthesis", () => {
  it("speaks with the first voice for the locale and resolves done at the end", async () => {
    const w = fakeWindow();
    w.synth.voices = [{ lang: "en-GB", name: "Daniel" }, EN, ES];
    const port = createWebSpeechPort(w);
    const p = port.speak("Hola", "es");
    await tick();
    const u = w.synth.spoken[0] as FakeUtterance;
    expect(u).toMatchObject({ text: "Hola", lang: "es-ES", voice: ES });
    u.onend!();
    expect(await p).toEqual({ type: "done" });
  });

  it("waits for voiceschanged when no voice is loaded yet", async () => {
    const w = fakeWindow();
    const port = createWebSpeechPort(w);
    const p = port.speak("Hello", "en");
    await tick();
    expect(w.synth.spoken).toEqual([]);
    w.synth.loadVoices([ES, EN]);
    await tick();
    const u = w.synth.spoken[0] as FakeUtterance;
    expect(u.voice).toEqual(EN);
    u.onend!();
    expect(await p).toEqual({ type: "done" });
  });

  it("gives up after 1 second without voices: synthesis unavailable for this language", async () => {
    vi.useFakeTimers();
    const w = fakeWindow();
    const p = createWebSpeechPort(w).speak("Hola", "es");
    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ type: "error", kind: "synthesis-unavailable" });
  });

  it("no voice for the selected language, or no speechSynthesis at all, is synthesis-unavailable", async () => {
    const w = fakeWindow();
    w.synth.voices = [EN];
    expect(await createWebSpeechPort(w).speak("Hola", "es")).toEqual({ type: "error", kind: "synthesis-unavailable" });
    expect(await createWebSpeechPort({ setTimeout: () => 0, clearTimeout: () => {} }).speak("Hola", "es")).toEqual({
      type: "error",
      kind: "synthesis-unavailable",
    });
  });

  it("an interrupted utterance is aborted; any other synthesis error is synthesis-failed; stop() cancels", async () => {
    const w = fakeWindow();
    w.synth.voices = [ES];
    const port = createWebSpeechPort(w);
    const a = port.speak("uno", "es");
    await tick();
    (w.synth.spoken[0] as FakeUtterance).onerror!({ error: "interrupted" });
    expect(await a).toEqual({ type: "error", kind: "aborted" });

    const b = port.speak("dos", "es");
    await tick();
    (w.synth.spoken[1] as FakeUtterance).onerror!({ error: "synthesis-failed" });
    expect(await b).toEqual({ type: "error", kind: "synthesis-failed" });

    const c = port.speak("tres", "es");
    await tick();
    const before = w.synth.cancels;
    port.stop();
    expect(await c).toEqual({ type: "error", kind: "aborted" });
    expect(w.synth.cancels).toBe(before + 1);
  });
});

describe("pickVoice, typed-only and fake ports, event mapping", () => {
  it("prefers the exact locale, then any voice of the language (also with an underscore), else null", () => {
    expect(pickVoice([{ lang: "es-MX", name: "a" }, ES], "es")).toEqual(ES);
    expect(pickVoice([{ lang: "es_MX", name: "a" }], "es")).toEqual({ lang: "es_MX", name: "a" });
    expect(pickVoice([{ lang: "eu-ES", name: "basque" }], "es")).toBeNull();
    expect(pickVoice([], "en")).toBeNull();
  });

  it("the typed-only port can neither listen nor speak", async () => {
    const port = createTypedOnlyPort();
    expect(port.supports).toEqual({ recognition: false, synthesis: false });
    expect(listenEvent(await port.listen({ lang: "es" }))).toEqual({ type: "SPEECH_ERROR", kind: "unavailable" });
    expect(speakEvent(await port.speak("x", "es"))).toEqual({ type: "SPEECH_ERROR", kind: "synthesis-unavailable" });
  });

  it("the fake port replays its script, records what was spoken and heard, and waits forever when the script runs out", async () => {
    const port = createFakeSpeechPort({ listens: [{ type: "final", text: "hola" }] });
    expect(await port.listen({ lang: "es" })).toEqual({ type: "final", text: "hola" });
    let settled = false;
    void port.listen({ lang: "en" }).then(() => (settled = true));
    await tick();
    expect(settled).toBe(false);
    expect(await port.speak("Buenas", "es")).toEqual({ type: "done" });
    port.stop();
    expect(port.listened).toEqual(["es", "en"]);
    expect(port.spoken).toEqual([{ text: "Buenas", lang: "es" }]);
    expect(port.stops).toBe(1);
    expect(listenEvent({ type: "final", text: "hola" })).toEqual({ type: "RECOGNIZED", text: "hola" });
    expect(speakEvent({ type: "done" })).toEqual({ type: "SPOKEN" });
  });
});

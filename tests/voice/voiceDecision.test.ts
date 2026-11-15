import { describe, expect, it } from "vitest";
import {
  initialVoiceDecision,
  START_BUFFER_MS,
  STALL_LIMIT_MS,
  TTS_DEADLINE_MS,
  voiceDecision,
  type VoiceDecisionState,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceMode,
} from "@/lib/voice/voiceDecision";

function run(mode: VoiceMode, events: VoiceEvent[]): { state: VoiceDecisionState; effects: VoiceEffect[][] } {
  let state = initialVoiceDecision(mode);
  const effects: VoiceEffect[][] = [];
  for (const e of events) {
    const [next, out] = voiceDecision(state, e);
    state = next;
    effects.push(out);
  }
  return { state, effects };
}

describe("voiceDecision: the constants from the spike", () => {
  it("2.5 s deadline, 300 ms start buffer, 3 s stall limit", () => {
    expect([TTS_DEADLINE_MS, START_BUFFER_MS, STALL_LIMIT_MS]).toEqual([2500, 300, 3000]);
  });
});

describe("voiceDecision: live stream", () => {
  it("buffers 300 ms of output audio, plays, and is done when the last audio has played", () => {
    const { state, effects } = run("stream", [
      { type: "CHUNK", at: 900, ms: 200 },
      { type: "CHUNK", at: 1000, ms: 200 }, // 400 ms buffered: play at 1 000, scheduled until 1 400
      { type: "CHUNK", at: 1100, ms: 500 }, // until 1 900
      { type: "ENDED", at: 1200 },
      { type: "STALL_TICK", at: 1899 },
      { type: "STALL_TICK", at: 1900 },
    ]);
    expect(effects).toEqual([[], [{ type: "play" }], [], [], [], [{ type: "finish", by: "neural" }]]);
    expect(state).toMatchObject({ phase: "done", doneBy: "neural", fallback: null });
  });

  it("a short stream that ends below the buffer is played anyway", () => {
    const { effects } = run("stream", [
      { type: "CHUNK", at: 800, ms: 120 },
      { type: "ENDED", at: 850 },
    ]);
    expect(effects).toEqual([[], [{ type: "play" }]]);
  });

  it("no audio started by 2.5 s: browser voice, a deadline report, and later chunks are dropped", () => {
    const { state, effects } = run("stream", [
      { type: "CHUNK", at: 2000, ms: 200 },
      { type: "CHUNK", at: 2500, ms: 400 },
      { type: "CHUNK", at: 2600, ms: 400 },
      { type: "ENDED", at: 2700 },
      { type: "FALLBACK_ENDED", at: 6000 },
    ]);
    expect(effects[1]).toEqual([
      { type: "stopNeural" },
      { type: "fallback", reason: "deadline" },
      { type: "report", reason: "deadline", latencyMs: 2500 },
    ]);
    expect(effects.slice(2, 4)).toEqual([[], []]);
    expect(effects[4]).toEqual([{ type: "finish", by: "browser" }]);
    expect(state.neuralStarted).toBe(false);
  });

  it("a 429 quota answer: browser voice and quotaOut, but no report (the server logged it)", () => {
    const { effects } = run("stream", [{ type: "ERROR", at: 300, kind: "quota" }]);
    expect(effects[0]).toEqual([{ type: "stopNeural" }, { type: "quotaOut" }, { type: "fallback", reason: "quota" }]);
  });

  it("a 503 or a 403 falls back without a report; a network failure is reported", () => {
    expect(run("stream", [{ type: "ERROR", at: 300, kind: "unavailable" }]).effects[0]).toEqual([
      { type: "stopNeural" },
      { type: "fallback", reason: "unavailable" },
    ]);
    expect(run("stream", [{ type: "ERROR", at: 300, kind: "token" }]).effects[0]).toEqual([
      { type: "stopNeural" },
      { type: "fallback", reason: "token" },
    ]);
    expect(run("stream", [{ type: "ERROR", at: 450, kind: "network" }]).effects[0]).toEqual([
      { type: "stopNeural" },
      { type: "fallback", reason: "network" },
      { type: "report", reason: "network", latencyMs: 450 },
    ]);
  });

  it("a stream that closes with no audio at all is a network failure", () => {
    expect(run("stream", [{ type: "ENDED", at: 700 }]).state.fallback).toBe("network");
  });

  it("a stall: nothing to play for more than 3 s before the end stops the audio and repeats the reply", () => {
    const { state, effects } = run("stream", [
      { type: "CHUNK", at: 1000, ms: 400 }, // plays until 1 400
      { type: "STALL_TICK", at: 4400 }, // empty for exactly 3 s: not yet
      { type: "STALL_TICK", at: 4401 },
    ]);
    expect(effects[1]).toEqual([]);
    expect(effects[2]).toEqual([
      { type: "stopNeural" },
      { type: "fallback", reason: "stall" },
      { type: "report", reason: "stall", latencyMs: 4401 },
    ]);
    expect(state).toMatchObject({ neuralStarted: true, fallback: "stall" });
  });

  it("the body breaking after the first chunk is a stall", () => {
    const { state } = run("stream", [
      { type: "CHUNK", at: 1000, ms: 400 },
      { type: "ERROR", at: 1200, kind: "network" },
    ]);
    expect(state.fallback).toBe("stall");
  });

  it("a chunk after a short gap plays at once and pushes the end", () => {
    const { effects } = run("stream", [
      { type: "CHUNK", at: 1000, ms: 300 }, // until 1 300
      { type: "CHUNK", at: 2000, ms: 300 }, // gap: until 2 300
      { type: "ENDED", at: 2100 },
      { type: "STALL_TICK", at: 2299 },
      { type: "STALL_TICK", at: 2300 },
    ]);
    expect(effects[3]).toEqual([]);
    expect(effects[4]).toEqual([{ type: "finish", by: "neural" }]);
  });
});

describe("voiceDecision: cached line in an <audio> element", () => {
  it("plays and is done on the element's ended event", () => {
    const { state, effects } = run("element", [
      { type: "STARTED", at: 150 },
      { type: "STALL_TICK", at: 4000 },
      { type: "PLAYBACK_ENDED", at: 5200 },
    ]);
    expect(effects).toEqual([[], [], [{ type: "finish", by: "neural" }]]);
    expect(state.doneBy).toBe("neural");
  });

  it("a playback error before it starts is reported and spoken by the browser voice", () => {
    const { effects } = run("element", [{ type: "ERROR", at: 200, kind: "playback_error" }]);
    expect(effects[0]).toEqual([
      { type: "stopNeural" },
      { type: "fallback", reason: "playback_error" },
      { type: "report", reason: "playback_error", latencyMs: 200 },
    ]);
  });

  it("waiting for data for more than 3 s is a stall; resuming in time is not", () => {
    expect(
      run("element", [
        { type: "STARTED", at: 100 },
        { type: "UNDERRUN", at: 1000 },
        { type: "STARTED", at: 3500 },
        { type: "STALL_TICK", at: 4500 },
      ]).state.phase,
    ).toBe("playing");
    expect(
      run("element", [
        { type: "STARTED", at: 100 },
        { type: "UNDERRUN", at: 1000 },
        { type: "STALL_TICK", at: 4001 },
      ]).state.fallback,
    ).toBe("stall");
  });

  it("no playing event by 2.5 s is the deadline", () => {
    expect(run("element", [{ type: "STARTED", at: 2500 }]).state).toMatchObject({ fallback: "deadline", neuralStarted: false });
  });
});

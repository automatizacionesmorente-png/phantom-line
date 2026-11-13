import { describe, expect, it } from "vitest";
import { PACE_RULE, median, medianF0, paceVerdict, parseWav } from "../../scripts/lib/audioAnalysis.mjs";

/** natural-voice task 3.7: the helpers check-tts.mjs `pace` uses to measure samples. */
const RATE = 24000;

function tone(hz: number[], seconds: number, rate = RATE, amp = 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) {
    out[i] = hz.reduce((s, f, k) => s + (amp / (k + 1)) * Math.sin((2 * Math.PI * f * i) / rate), 0);
  }
  return out;
}

/** A 16-bit mono WAV, optionally followed by an extra chunk (the API appends a C2PA one). */
function wav(samples: Float32Array, rate = RATE, extra?: { id: string; bytes: number }, declaredSize?: number): Uint8Array {
  const data = samples.length * 2;
  const extraLen = extra ? 8 + extra.bytes : 0;
  const buf = new Uint8Array(44 + data + extraLen);
  const v = new DataView(buf.buffer);
  const put = (o: number, s: string) => [...s].forEach((c, k) => (buf[o + k] = c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + data + extraLen, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, "data");
  v.setUint32(40, declaredSize ?? data, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  if (extra) {
    put(44 + data, extra.id);
    v.setUint32(48 + data, extra.bytes, true);
    for (let i = 0; i < extra.bytes; i++) buf[52 + data + i] = 0x7f; // loud bytes: must not count as audio
  }
  return buf;
}

describe("parseWav", () => {
  it("reads rate, channels and the exact duration", () => {
    const w = parseWav(wav(tone([200], 1.5)));
    expect(w.sampleRate).toBe(RATE);
    expect(w.channels).toBe(1);
    expect(w.bitsPerSample).toBe(16);
    expect(w.frames).toBe(36000);
    expect(w.durationMs).toBe(1500);
  });

  it("uses the declared data size, so a trailing C2PA chunk is not counted as audio", () => {
    const w = parseWav(wav(tone([200], 1), RATE, { id: "C2PA", bytes: 7656 }));
    expect(w.durationMs).toBe(1000);
    expect(w.dataBytes).toBe(48000);
  });

  it("a streaming-style size (0 or 0xFFFFFFFF) uses the bytes that are there", () => {
    expect(parseWav(wav(tone([200], 0.5), RATE, undefined, 0)).durationMs).toBe(500);
    expect(parseWav(wav(tone([200], 0.5), RATE, undefined, 0xffffffff)).durationMs).toBe(500);
  });

  it("rejects what is not a 16-bit PCM WAV", () => {
    expect(() => parseWav(new TextEncoder().encode("ID3 not a wav file"))).toThrow(/RIFF/);
    const float = wav(tone([200], 0.1));
    new DataView(float.buffer).setUint16(20, 3, true);
    expect(() => parseWav(float)).toThrow(/unsupported/);
  });
});

describe("median", () => {
  it("odd, even, empty, and ignores non-finite values", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([Number.NaN, 5, Number.POSITIVE_INFINITY])).toBe(5);
  });
});

describe("medianF0", () => {
  it("finds the pitch of pure and harmonic tones within 1 %", () => {
    for (const hz of [90, 120, 180, 205, 260, 350]) {
      const pure = medianF0(tone([hz], 1), RATE).medianHz;
      expect(pure, `${hz} Hz`).not.toBeNull();
      expect(Math.abs((pure as number) / hz - 1), `${hz} Hz pure`).toBeLessThan(0.01);
      // A voice-like tone: fundamental plus the 2nd and 3rd harmonics, which tempt octave errors.
      const rich = medianF0(tone([hz, 2 * hz, 3 * hz], 1), RATE).medianHz as number;
      expect(Math.abs(rich / hz - 1), `${hz} Hz harmonic`).toBeLessThan(0.01);
    }
  });

  it("a 10 % rise in pitch reads as a 10 % rise", () => {
    const a = medianF0(tone([200, 400], 1), RATE).medianHz as number;
    const b = medianF0(tone([220, 440], 1), RATE).medianHz as number;
    expect(b / a).toBeGreaterThan(1.09);
    expect(b / a).toBeLessThan(1.11);
  });

  it("silence and noise have no voiced frames", () => {
    expect(medianF0(new Float32Array(RATE), RATE)).toEqual(expect.objectContaining({ medianHz: null, voicedFrames: 0 }));
    let seed = 1;
    const noise = Float32Array.from({ length: RATE }, () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 0.6);
    expect(medianF0(noise, RATE).voicedFrames).toBeLessThan(5);
  });

  it("quiet gaps between voiced parts do not move the median", () => {
    const voiced = tone([200], 0.5);
    const gap = new Float32Array(RATE / 2);
    const joined = new Float32Array(voiced.length * 2 + gap.length);
    joined.set(voiced, 0);
    joined.set(gap, voiced.length);
    joined.set(voiced, voiced.length + gap.length);
    expect(Math.abs((medianF0(joined, RATE).medianHz as number) / 200 - 1)).toBeLessThan(0.01);
  });
});

describe("paceVerdict (design.md 'Pace', option 1)", () => {
  const base = (ms: number, hz = 200) => ({ condition: "base" as const, durationMs: ms, medianHz: hz });
  const agil = (ms: number, hz = 200) => ({ condition: "agil" as const, durationMs: ms, medianHz: hz });

  it("uses the design's numbers", () => {
    expect(PACE_RULE).toEqual({ minShorterPct: 5, maxShorterPct: 15, maxPitchChangePct: 3, baseRuns: 2, paceRuns: 3 });
  });

  it("passes at 10 % shorter, no pace run over the baseline median, pitch within 3 %", () => {
    const v = paceVerdict([base(7000), base(7000), agil(6300), agil(6250), agil(6400, 204)]);
    expect(v).toEqual(
      expect.objectContaining({ complete: true, baseMedianMs: 7000, paceMedianMs: 6300, shorterPct: 10, inBand: true, noneLonger: true, pitchOk: true, rulePasses: true }),
    );
  });

  it("fails below 5 % and above 15 % shorter", () => {
    expect(paceVerdict([base(7000), base(7000), agil(6700), agil(6700), agil(6700)]).inBand).toBe(false);
    expect(paceVerdict([base(7000), base(7000), agil(5800), agil(5800), agil(5800)]).inBand).toBe(false);
    expect(paceVerdict([base(7000), base(7000), agil(6650), agil(6650), agil(6650)]).inBand).toBe(true); // exactly 5 %
    expect(paceVerdict([base(7000), base(7000), agil(5950), agil(5950), agil(5950)]).inBand).toBe(true); // exactly 15 %
  });

  it("fails when any pace run is longer than the baseline median, even with a good median", () => {
    const v = paceVerdict([base(7000), base(7000), agil(6300), agil(6300), agil(7100)]);
    expect(v.inBand).toBe(true);
    expect(v.noneLonger).toBe(false);
    expect(v.rulePasses).toBe(false);
  });

  it("fails when the median pitch moves by 3 % or more, either way", () => {
    expect(paceVerdict([base(7000), base(7000), agil(6300, 206), agil(6300, 206), agil(6300, 206)]).pitchOk).toBe(false);
    expect(paceVerdict([base(7000), base(7000), agil(6300, 194), agil(6300, 194), agil(6300, 194)]).pitchOk).toBe(false);
    expect(paceVerdict([base(7000), base(7000), agil(6300, 205.8), agil(6300, 205.8), agil(6300, 205.8)]).pitchOk).toBe(true);
  });

  it("is incomplete, and never passes, when runs are missing (a 429 or a failed call)", () => {
    const v = paceVerdict([base(7000), base(7000), agil(6300), agil(6300), { condition: "agil", durationMs: null, medianHz: null }]);
    expect(v.paceRuns).toBe(2);
    expect(v.complete).toBe(false);
    expect(v.rulePasses).toBe(false);
    expect(paceVerdict([]).rulePasses).toBe(false);
  });

  it("counts an extra baseline run (the spike's sample for the lite model) when asked", () => {
    const v = paceVerdict([base(6920), base(7000), base(6800), agil(6300), agil(6250), agil(6200)], { requiredBase: 3 });
    expect(v.baseRuns).toBe(3);
    expect(v.baseMedianMs).toBe(6920);
    expect(v.complete).toBe(true);
    expect(paceVerdict([base(7000), base(7000), agil(6300), agil(6250), agil(6200)], { requiredBase: 3 }).complete).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { createTimeStretcher, stretchAll } from "@/lib/voice/timeStretch";

const SR = 24_000;
const tone = (hz: number, n: number) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / SR));

describe("timeStretch", () => {
  it("at 1.1 one second becomes round(24 000 / 1.1) samples", () => {
    expect(stretchAll(tone(200, SR), 1.1, SR).length).toBe(Math.round(SR / 1.1));
  });

  it("at 0.8 (slower) the output is longer by the same rule", () => {
    expect(stretchAll(tone(200, SR), 0.8, SR).length).toBe(SR / 0.8);
  });

  it("does not fade in: the first 10 ms are the input itself", () => {
    const x = tone(220, SR);
    expect(stretchAll(x, 1.1, SR).subarray(0, 240)).toEqual(x.subarray(0, 240));
  });

  it("streams: a chunk shorter than a frame gives no output yet, and the rest comes on flush", () => {
    const ts = createTimeStretcher(1.1, SR);
    expect(ts.push(tone(200, 100)).length).toBe(0);
    expect(ts.flush().length).toBe(Math.round(100 / 1.1));
    expect(ts.push(tone(200, 1000)).length).toBe(0); // ignored after flush
    expect(ts.flush().length).toBe(0);
  });

  it("silence stays silence, and an empty input gives an empty output", () => {
    const y = stretchAll(new Float32Array(SR), 1.25, SR);
    expect(y.length).toBe(SR / 1.25);
    expect(y.every((v) => v === 0)).toBe(true);
    expect(stretchAll(new Float32Array(0), 1.1, SR).length).toBe(0);
  });

  it("keeps the level of a steady tone (the windows sum to one)", () => {
    const y = stretchAll(tone(250, SR), 1.1, SR);
    const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak(y.subarray(2400, 19000))).toBeGreaterThan(0.45);
    expect(peak(y.subarray(2400, 19000))).toBeLessThan(0.55);
  });

  it("rejects a rate or sample rate that makes no sense", () => {
    expect(() => createTimeStretcher(0, SR)).toThrow(RangeError);
    expect(() => createTimeStretcher(Number.NaN, SR)).toThrow(RangeError);
    expect(() => createTimeStretcher(1.1, 0)).toThrow(RangeError);
  });

  it("keeps the pitch when the search window's edge is the best score (N15 counterexample, catch log 10.4)", () => {
    // 300 ms of 100 Hz at 0.6 plus 145.6 Hz at 0.129, rate 0.9612. The old search picked the edge
    // of the ±5 ms window on 15 hops in a row, 9–10 samples short of a period each time, and the
    // pitch fell 2.5 %.
    const n = Math.round(0.3 * SR);
    const x = Float32Array.from(
      { length: n },
      (_, i) => 0.6 * Math.sin((2 * Math.PI * 100 * i) / SR) + 0.12901814953369992 * Math.sin((2 * Math.PI * 145.60012015261924 * i) / SR + 0.12402202344408408),
    );
    /** Mean period from the upward zero crossings away from the edges; the 100 Hz tone owns them. */
    const period = (a: Float32Array) => {
      const ups: number[] = [];
      for (let i = 720; i < a.length - 720; i++) if (a[i - 1] < 0 && a[i] >= 0) ups.push(i - a[i] / (a[i] - a[i - 1]));
      return (ups[ups.length - 1] - ups[0]) / (ups.length - 1);
    };
    const before = period(x);
    const after = period(stretchAll(x, 0.9612268518518517, SR));
    expect(Math.abs(after - before) / before).toBeLessThan(0.01);
  });
});

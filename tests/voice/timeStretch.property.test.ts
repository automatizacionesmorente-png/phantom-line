import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createTimeStretcher, FRAME_MS, stretchAll } from "@/lib/voice/timeStretch";

/**
 * N15 (natural-voice design.md): time-stretching keeps the pitch and shortens by the rate.
 * For all rates in [0.8, 1.25], sums of 1–3 sine tones between 100 and 400 Hz, and random
 * splits of the signal into stream chunks:
 * - the output length is the input length divided by the rate, within one frame (20 ms);
 * - the dominant period (autocorrelation) of the output is within 2 % of the input's;
 * - the output is the same however the input was chunked;
 * - at rate 1.0 the output equals the input.
 */
const SR = 24_000;
const FRAME = (FRAME_MS / 1000) * SR;

interface Tone {
  hz: number;
  amp: number;
  phase: number;
}
/**
 * The first tone is the dominant one (amplitude 0.6); the others are quieter (0.05–0.2).
 * With two equally loud inharmonic tones there is no dominant period to keep: the first version
 * of this generator gave 274 Hz and 380 Hz at 0.55 and 0.38, and the autocorrelation's best lag
 * was a near-common period (132 Hz) that neither tone has (see the catch log).
 */
const arbHz = fc.double({ min: 100, max: 400, noNaN: true });
const arbPhase = fc.double({ min: 0, max: 2 * Math.PI, noNaN: true });
const arbTones: fc.Arbitrary<Tone[]> = fc
  .tuple(
    fc.record({ hz: arbHz, amp: fc.constant(0.6), phase: arbPhase }),
    fc.array(fc.record({ hz: arbHz, amp: fc.double({ min: 0.05, max: 0.2, noNaN: true }), phase: arbPhase }), { maxLength: 2 }),
  )
  .map(([main, rest]) => [main, ...rest]);
const arbSignal = fc.record({
  tones: arbTones,
  ms: fc.integer({ min: 300, max: 1200 }),
});
const arbRate = fc.double({ min: 0.8, max: 1.25, noNaN: true });
/** Cut points as fractions of the length; 0–8 cuts, so chunks of any size, empty ones included. */
const arbCuts = fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 8 });

function synth({ tones, ms }: { tones: Tone[]; ms: number }): Float32Array {
  const n = Math.round((ms / 1000) * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const t of tones) v += t.amp * Math.sin((2 * Math.PI * t.hz * i) / SR + t.phase);
    x[i] = v;
  }
  return x;
}

function chunked(x: Float32Array, cuts: number[], rate: number): Float32Array {
  const points = [...new Set(cuts.map((c) => Math.round(c * x.length)))].sort((a, b) => a - b);
  const ts = createTimeStretcher(rate, SR);
  const parts: Float32Array[] = [];
  let from = 0;
  for (const p of [...points, x.length]) {
    parts.push(ts.push(x.subarray(from, p)));
    from = p;
  }
  parts.push(ts.flush());
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The dominant period in samples, from the autocorrelation: the lag of the highest normalized
 * autocorrelation within ±15 % of four periods of the dominant tone, over the signal without its
 * first and last 30 ms, refined by a parabola through its neighbours, divided by four.
 * A pitch change of more than 15 % (plain resampling at 0.8 or 1.25 moves it by 20–25 %) lands on
 * the edge of the window and fails the 2 % check.
 * Why four periods: a quieter second tone tilts the autocorrelation near each peak, which moves
 * the peak by a few samples whatever the lag. At one period of a 100 Hz tone that is several
 * percent of the input's own period (100 Hz plus 339.6 Hz at 0.154 read 231.5 samples instead of
 * 240, catch log 10.4); at four periods the same shift is a quarter as large. The neighbouring
 * peaks (three and five periods) stay outside the ±15 % window.
 */
const PERIODS = 4;
function dominantPeriod(x: Float32Array, toneHz: number): number | null {
  const edge = Math.round(0.03 * SR);
  const period = (PERIODS * SR) / toneHz;
  const minLag = Math.floor(period / 1.15);
  const maxLag = Math.ceil(period * 1.15);
  const from = edge;
  const to = x.length - edge - maxLag - 2;
  if (to - from < 2 * maxLag) return null;
  const r = new Float64Array(maxLag + 2);
  let best = -Infinity;
  let pick = -1;
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let num = 0;
    let e0 = 0;
    let e1 = 0;
    for (let i = from; i < to; i++) {
      num += x[i] * x[i + lag];
      e0 += x[i] * x[i];
      e1 += x[i + lag] * x[i + lag];
    }
    r[lag] = e0 > 0 && e1 > 0 ? num / Math.sqrt(e0 * e1) : 0;
    if (lag >= minLag && lag <= maxLag && r[lag] > best) {
      best = r[lag];
      pick = lag;
    }
  }
  if (pick < 0) return null;
  const a = r[pick - 1];
  const b = r[pick];
  const c = r[pick + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  return (pick + Math.max(-0.5, Math.min(0.5, shift))) / PERIODS;
}

describe("N15: time-stretching keeps the pitch and shortens by the rate", () => {
  it("the output length is the input length / rate, within one frame", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(arbSignal, arbRate, arbCuts, (sig, rate, cuts) => {
        const x = synth(sig);
        const y = chunked(x, cuts, rate);
        expect(Math.abs(y.length - x.length / rate)).toBeLessThanOrEqual(FRAME);
        expect(y.every(Number.isFinite)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("the dominant period of the output is within 2 % of the input's", { timeout: 120_000 }, () => {
    let compared = 0;
    const tonesSeen = new Set<number>();
    fc.assert(
      fc.property(arbSignal, arbRate, (sig, rate) => {
        const x = synth(sig);
        const before = dominantPeriod(x, sig.tones[0].hz);
        const after = dominantPeriod(stretchAll(x, rate, SR), sig.tones[0].hz);
        expect(before).not.toBeNull();
        expect(after).not.toBeNull();
        expect(Math.abs(after! - before!) / before!).toBeLessThan(0.02);
        compared++;
        tonesSeen.add(sig.tones.length);
      }),
      { numRuns: 150 },
    );
    expect(compared).toBe(150);
    expect([...tonesSeen].sort()).toEqual([1, 2, 3]);
  });

  it("the output is the same however the input was chunked", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(arbSignal, arbRate, arbCuts, arbCuts, (sig, rate, a, b) => {
        const x = synth(sig);
        const whole = stretchAll(x, rate, SR);
        expect(firstDifference(chunked(x, a, rate), whole)).toBe(-1);
        expect(firstDifference(chunked(x, b, rate), whole)).toBe(-1);
      }),
      { numRuns: 100 },
    );
  });

  it("at rate 1.0 the output equals the input", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(arbSignal, arbCuts, (sig, cuts) => {
        const x = synth(sig);
        expect(firstDifference(chunked(x, cuts, 1), x)).toBe(-1);
      }),
      { numRuns: 200 },
    );
  });
});

/** -1 when both arrays hold the same samples, else the first index where they differ (or the shorter length). */
function firstDifference(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (!Object.is(a[i], b[i])) return i;
  return a.length === b.length ? -1 : n;
}

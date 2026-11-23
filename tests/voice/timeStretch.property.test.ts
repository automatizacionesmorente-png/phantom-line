import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createTimeStretcher, FRAME_MS, stretchAll } from "@/lib/voice/timeStretch";

/**
 * N15 (natural-voice design.md): time-stretching keeps the pitch and shortens by the rate.
 * For all rates in [0.8, 1.25], sums of 1–3 sine tones between 100 and 400 Hz, and random
 * splits of the signal into stream chunks:
 * - the output length is the input length divided by the rate, within one frame (20 ms);
 * - the dominant period (from the spectrum peak of the dominant tone) of the output is within 2 % of the input's;
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
 * The dominant period in samples, as SR / the frequency of the dominant tone. The frequency is the
 * peak of the Hann-windowed spectrum of the signal without its first and last 30 ms: first the
 * strongest bin of a zero-padded FFT between 0.7 and 1.4 times the tone, then a golden-section
 * search of the exact windowed DFT within one padded bin of it.
 *
 * Why not the autocorrelation any more (catch log, front-desk-brain task 4): the first oracle took
 * the autocorrelation peak near four periods. Its error was not floating-point noise. The quieter
 * tones tilt that peak by an amount that depends on the window, and the input and the output have
 * different lengths, so the tilt does not cancel. Seed 1460320275, run 94 (100 Hz with 145 Hz and
 * 288 Hz, 319 ms, rate 1.138) read 2.32 % while the spectrum of the same two signals moved 0.30 %;
 * over 1500 generated cases it read more than 2 % six times. It was also blind to plain
 * resampling at exactly 1.25: five periods of the shifted tone land on four of the original, so a
 * pure 100 Hz tone resampled at 1.25 read 0.00 %. The spectrum peak reads every resampling with
 * |rate − 1| > 0.05 as at least 4.8 % off (1245 cases), because the 0.7–1.4 range holds the
 * shifted tone for every rate in [0.8, 1.25], and the 0.6-amplitude tone has 9 times the power of
 * any quieter one (at most 0.2).
 *
 * Fixed real failure (BACKLOG item 18): with a ±5 ms search the dominant tone at exactly 100 Hz
 * (a 10 ms period, the whole search width) could have no interior similarity peak, and the
 * stretcher moved its pitch (seed -1766375849: 100 Hz + 400 Hz, 300 ms, rate 1.2498, 19 % off).
 * The search is now ±8 ms, wider than one period of any voice pitch, and 1500 runs plus those
 * cases pass.
 */
const SEARCH_LOW = 0.7;
const SEARCH_HIGH = 1.4;
/** "Within 2 %" of the input's period (design N15); the limit itself does not move. */
const PITCH_LIMIT = 0.02;
/**
 * The 2 % bound is inclusive, with 1e-9 of floating-point noise on it. A note for whoever reads a
 * failure: a shrunk counterexample of this property always sits just above 2 %, because the error
 * is continuous in the rate and fast-check shrinks the rate towards the bound. So "0.0200000010"
 * after shrinking is not a rounding problem; replay the seed with the reported path cut to its
 * first number to see the error before shrinking (the 0.020000001 of seed 1460320275 was 2.32 %).
 */
const BOUND_TOLERANCE = 1e-9;

/** Squared magnitude of the Hann-windowed DFT of `seg` at `hz`, by rotation (no cos per sample). */
function windowedPower(seg: Float32Array, hz: number): number {
  const n = seg.length;
  const w = (2 * Math.PI * hz) / SR;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const ch = Math.cos((2 * Math.PI) / n);
  const sh = Math.sin((2 * Math.PI) / n);
  let c = 1;
  let s = 0;
  let hc = 1;
  let hs = 0;
  let re = 0;
  let im = 0;
  for (let k = 0; k < n; k++) {
    const v = seg[k] * (0.5 - 0.5 * hc);
    re += v * c;
    im += v * s;
    const c2 = c * cw - s * sw;
    s = s * cw + c * sw;
    c = c2;
    const h2 = hc * ch - hs * sh;
    hs = hs * ch + hc * sh;
    hc = h2;
  }
  return re * re + im * im;
}

/** The strongest bin between `lowHz` and `highHz` of the Hann-windowed FFT, zero-padded to at least 4 times the length. */
function fftPeakHz(seg: Float32Array, lowHz: number, highHz: number): number {
  let n = 1;
  while (n < seg.length * 4) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < seg.length; k++) re[k] = seg[k] * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / seg.length));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len / 2;
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k + half] * cr - im[i + k + half] * ci;
        const ui = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k + half] = re[i + k] - ur;
        im[i + k + half] = im[i + k] - ui;
        re[i + k] += ur;
        im[i + k] += ui;
        const c2 = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = c2;
      }
    }
  }
  let best = Math.ceil((lowHz * n) / SR);
  let bestPower = -1;
  for (let b = best; b <= Math.floor((highHz * n) / SR); b++) {
    const p = re[b] * re[b] + im[b] * im[b];
    if (p > bestPower) {
      bestPower = p;
      best = b;
    }
  }
  return (best * SR) / n;
}

function dominantPeriod(x: Float32Array, toneHz: number): number | null {
  const edge = Math.round(0.03 * SR);
  if (x.length - 2 * edge < SR / 10) return null;
  const seg = x.subarray(edge, x.length - edge);
  const coarse = fftPeakHz(seg, toneHz * SEARCH_LOW, toneHz * SEARCH_HIGH);
  const bin = SR / (4 * seg.length);
  const g = (Math.sqrt(5) - 1) / 2;
  let lo = coarse - bin;
  let hi = coarse + bin;
  let m1 = hi - g * (hi - lo);
  let m2 = lo + g * (hi - lo);
  let p1 = windowedPower(seg, m1);
  let p2 = windowedPower(seg, m2);
  for (let i = 0; i < 40; i++) {
    if (p1 < p2) {
      lo = m1;
      m1 = m2;
      p1 = p2;
      m2 = lo + g * (hi - lo);
      p2 = windowedPower(seg, m2);
    } else {
      hi = m2;
      m2 = m1;
      p2 = p1;
      m1 = hi - g * (hi - lo);
      p1 = windowedPower(seg, m1);
    }
  }
  return SR / ((lo + hi) / 2);
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
        expect(Math.abs(after! - before!) / before!).toBeLessThanOrEqual(PITCH_LIMIT + BOUND_TOLERANCE);
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

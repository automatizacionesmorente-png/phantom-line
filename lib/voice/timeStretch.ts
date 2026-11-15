/**
 * Streaming WSOLA time-stretching (natural-voice design.md, "Pace", option 2). Pure: no browser
 * API, no dependency. It plays PCM `rate` times faster with the pitch kept, for the live neural
 * voice, whose PCM chunks cannot go through a media element with `preservesPitch`.
 *
 * WSOLA (waveform-similarity overlap-add):
 * - frames of 20 ms with 50 % overlap, so the output advances by a synthesis hop of 10 ms;
 * - the k-th frame is read near input position round(k · hop · rate), shifted by up to ±5 ms to
 *   the similarity peak (over one whole frame) with the natural continuation of the previous frame;
 * - frames are Hann-windowed (periodic Hann at 50 % overlap sums to 1) and added. The first
 *   frame's first half is not windowed, so the reply does not fade in.
 *
 * Streaming: a frame is computed only once every input sample it may read has arrived, so the
 * output does not depend on how the input was chunked (property N15). `flush()` computes the last
 * frames with zeros past the end and trims the output to round(inputLength / rate).
 * At rate 1.0 it is the identity: `push` returns a copy of its input.
 */

export const FRAME_MS = 20;
export const SEARCH_MS = 5;

export interface TimeStretcher {
  readonly rate: number;
  /** Adds input samples and returns the output samples that are now final (possibly none). */
  push(input: Float32Array): Float32Array;
  /** Ends the input and returns the rest of the output. Further pushes are ignored. */
  flush(): Float32Array;
}

export function createTimeStretcher(rate: number, sampleRate: number): TimeStretcher {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`invalid rate ${rate}`);
  if (!Number.isFinite(sampleRate) || sampleRate < 1000) throw new RangeError(`invalid sample rate ${sampleRate}`);
  if (rate === 1) return identity();

  const N = 2 * Math.round((FRAME_MS / 1000) * sampleRate / 2); // even frame length
  const H = N / 2; // synthesis hop
  const S = Math.round((SEARCH_MS / 1000) * sampleRate); // search radius
  const window = new Float32Array(N);
  for (let n = 0; n < N; n++) window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N);

  // Input: samples [base, base + inLen) are held in `inBuf`.
  let inBuf = new Float32Array(Math.max(4 * N, 4096));
  let base = 0;
  let inLen = 0;
  let total = 0; // input samples received
  // Output accumulator: samples [outBase, outBase + out.length) not yet emitted.
  let out = new Float32Array(2 * N);
  let outBase = 0;
  let k = 0; // next frame
  let prevStart = 0; // input position of the previous frame (after its shift)
  let ended = false;

  const nominal = (frame: number) => Math.round(frame * H * rate);
  /** Input sample at absolute position p; zero past the end (only reached after flush). */
  const at = (p: number) => (p >= base && p < base + inLen ? inBuf[p - base] : 0);

  function append(x: Float32Array) {
    if (inLen + x.length > inBuf.length) {
      const next = new Float32Array(Math.max(inBuf.length * 2, inLen + x.length));
      next.set(inBuf.subarray(0, inLen));
      inBuf = next;
    }
    inBuf.set(x, inLen);
    inLen += x.length;
    total += x.length;
  }

  /** The highest input position frame `frame` may read, exclusive. */
  function needs(frame: number): number {
    if (frame === 0) return N;
    return Math.max(nominal(frame) + S + N, prevStart + H + N);
  }

  /**
   * The offset in [nominal − S, nominal + S] whose start best matches the natural continuation of
   * the previous frame. Only a real peak of the similarity counts (an interior local maximum):
   * the window's edge is only a peak cut off by the window, and picking it again and again
   * splices a few samples short of a period on every hop, which moves the pitch (catch log,
   * 10.4, second row). With no interior peak (silence, a flat score), the highest score wins.
   */
  function chooseStart(frame: number): number {
    if (frame === 0) return 0;
    const a = nominal(frame);
    const lo = Math.max(-S, -a);
    const target = prevStart + H; // natural continuation of the previous frame
    const scores = new Float64Array(S - lo + 1);
    for (let d = lo; d <= S; d++) {
      const s = a + d;
      let num = 0;
      let energy = 0;
      for (let i = 0; i < N; i++) {
        const x = at(s + i);
        num += x * at(target + i);
        energy += x * x;
      }
      scores[d - lo] = energy > 0 ? num / Math.sqrt(energy) : 0;
    }
    let best = -Infinity;
    let pick = -1;
    for (let j = 1; j < scores.length - 1; j++) {
      const v = scores[j];
      if (v > scores[j - 1] && v >= scores[j + 1] && v > best + 1e-12) {
        best = v;
        pick = j;
      }
    }
    if (pick < 0) {
      for (let j = 0; j < scores.length; j++) {
        if (scores[j] > best + 1e-12) {
          best = scores[j];
          pick = j;
        }
      }
    }
    return pick < 0 ? a : a + lo + pick;
  }

  function addFrame(frame: number, start: number) {
    const pos = frame * H - outBase;
    if (pos + N > out.length) {
      const next = new Float32Array(Math.max(out.length * 2, pos + N));
      next.set(out);
      out = next;
    }
    for (let n = 0; n < N; n++) {
      const w = frame === 0 && n < H ? 1 : window[n];
      out[pos + n] += w * at(start + n);
    }
  }

  /** Emits the output samples before `upTo` (absolute) that were not emitted yet. */
  function emit(upTo: number): Float32Array {
    const n = Math.max(0, upTo - outBase);
    if (n === 0) return new Float32Array(0);
    const result = out.slice(0, n);
    out.copyWithin(0, n);
    out.fill(0, out.length - n);
    outBase += n;
    return result;
  }

  /** Drops input no future frame can read. */
  function compact() {
    const keepFrom = Math.min(nominal(k) - S, prevStart + H);
    const drop = Math.max(0, keepFrom - base);
    if (drop > inBuf.length / 2) {
      inBuf.copyWithin(0, drop, inLen);
      inLen -= drop;
      base += drop;
    }
  }

  function run(limitOut: number): void {
    while (k * H < limitOut && (ended || needs(k) <= total)) {
      const start = chooseStart(k);
      addFrame(k, start);
      prevStart = start;
      k++;
    }
  }

  return {
    rate,
    push(input) {
      if (ended || input.length === 0) return new Float32Array(0);
      append(input);
      run(Infinity);
      compact();
      // Samples before k·H receive no more frames.
      return emit(k * H);
    },
    flush() {
      if (ended) return new Float32Array(0);
      ended = true;
      const length = Math.round(total / rate);
      run(length);
      return emit(length);
    },
  };
}

function identity(): TimeStretcher {
  let ended = false;
  return {
    rate: 1,
    push: (input) => (ended ? new Float32Array(0) : input.slice()),
    flush: () => {
      ended = true;
      return new Float32Array(0);
    },
  };
}

/** Stretches a whole signal at once (scripts and tests). */
export function stretchAll(input: Float32Array, rate: number, sampleRate: number): Float32Array {
  const ts = createTimeStretcher(rate, sampleRate);
  const a = ts.push(input);
  const b = ts.flush();
  const result = new Float32Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

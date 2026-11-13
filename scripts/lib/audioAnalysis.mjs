// Pure helpers to measure TTS samples: WAV parsing, duration, median pitch, and the pace rule
// of .kiro/specs/natural-voice/design.md ("Pace"). Plain JavaScript so that check-tts.mjs runs
// on Node 20.19 without a build step; tests import it from Vitest. No I/O here.

/**
 * Parses a PCM WAV file (RIFF, format 1, 16-bit). Walks the chunks instead of assuming a 44-byte
 * header, and accepts a streaming-style data size (0 or 0xFFFFFFFF) by using the bytes left.
 * @param {Uint8Array} buf
 * @returns {{ sampleRate: number, channels: number, bitsPerSample: number, dataOffset: number,
 *   dataBytes: number, frames: number, durationMs: number, samples: Float32Array }}
 */
export function parseWav(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (buf.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= buf.byteLength) {
    const id = tag(offset);
    let size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("data chunk before fmt chunk");
      if (fmt.format !== 1 || fmt.bitsPerSample !== 16) throw new Error(`unsupported WAV format ${fmt.format}/${fmt.bitsPerSample}`);
      const left = buf.byteLength - body;
      if (size === 0 || size === 0xffffffff || size > left) size = left;
      const blockAlign = fmt.channels * 2;
      const frames = Math.floor(size / blockAlign);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = view.getInt16(body + i * blockAlign, true) / 32768;
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        bitsPerSample: fmt.bitsPerSample,
        dataOffset: body,
        dataBytes: size,
        frames,
        durationMs: (frames / fmt.sampleRate) * 1000,
        samples,
      };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("no data chunk");
}

/** @param {number[]} values */
export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Median fundamental frequency of the voiced frames, by normalized autocorrelation.
 * Frames quieter than 15 % of the loud frames' level, or with a correlation peak under 0.6,
 * count as unvoiced. The shortest lag within 90 % of the best peak is kept, to avoid octave
 * errors, and refined by parabolic interpolation.
 * @param {Float32Array} samples mono, -1..1
 * @param {number} sampleRate
 * @param {{ minHz?: number, maxHz?: number, frameMs?: number, hopMs?: number }} [opts]
 * @returns {{ medianHz: number | null, voicedFrames: number, frames: number }}
 */
export function medianF0(samples, sampleRate, opts = {}) {
  const { minHz = 70, maxHz = 400, frameMs = 40, hopMs = 10 } = opts;
  const frameLen = Math.round((frameMs / 1000) * sampleRate);
  const hop = Math.round((hopMs / 1000) * sampleRate);
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.ceil(sampleRate / minHz);
  const starts = [];
  for (let s = 0; s + frameLen + maxLag + 2 <= samples.length; s += hop) starts.push(s);
  const rms = starts.map((s) => {
    let e = 0;
    for (let i = 0; i < frameLen; i++) e += samples[s + i] * samples[s + i];
    return Math.sqrt(e / frameLen);
  });
  const sortedRms = [...rms].sort((a, b) => a - b);
  const loud = sortedRms[Math.floor(sortedRms.length * 0.95)] ?? 0;
  const gate = Math.max(loud * 0.15, 1e-4);
  const f0s = [];
  const r = new Float64Array(maxLag + 2);
  for (let k = 0; k < starts.length; k++) {
    if (rms[k] < gate) continue;
    const s = starts[k];
    let e0 = 0;
    for (let i = 0; i < frameLen; i++) e0 += samples[s + i] * samples[s + i];
    let best = -1;
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let num = 0;
      let e1 = 0;
      for (let i = 0; i < frameLen; i++) {
        const b = samples[s + i + lag];
        num += samples[s + i] * b;
        e1 += b * b;
      }
      r[lag] = e0 > 0 && e1 > 0 ? num / Math.sqrt(e0 * e1) : 0;
      if (lag >= minLag && lag <= maxLag && r[lag] > best) best = r[lag];
    }
    if (best < 0.6) continue;
    let pick = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (r[lag] >= 0.9 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
        pick = lag;
        break;
      }
    }
    if (pick < 0) continue;
    const a = r[pick - 1];
    const b = r[pick];
    const c = r[pick + 1];
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    f0s.push(sampleRate / (pick + Math.max(-0.5, Math.min(0.5, shift))));
  }
  return { medianHz: median(f0s), voicedFrames: f0s.length, frames: starts.length };
}

/** The pace rule's figures (design.md "Pace", option 1). */
export const PACE_RULE = { minShorterPct: 5, maxShorterPct: 15, maxPitchChangePct: 3, baseRuns: 2, paceRuns: 3 };

const round = (x, d = 1) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * Applies the acceptance rule for option 1 to one model's runs. The owner's listening test is
 * not part of it: `rulePasses` true means "the numbers pass; now the owner listens".
 * @param {{ condition: "base" | "agil", durationMs: number | null, medianHz: number | null }[]} runs
 * @param {{ requiredBase?: number, requiredPace?: number }} [need]
 */
export function paceVerdict(runs, need = {}) {
  const requiredBase = need.requiredBase ?? PACE_RULE.baseRuns;
  const requiredPace = need.requiredPace ?? PACE_RULE.paceRuns;
  const ok = runs.filter((r) => Number.isFinite(r.durationMs));
  const base = ok.filter((r) => r.condition === "base");
  const pace = ok.filter((r) => r.condition === "agil");
  const baseMedianMs = median(base.map((r) => r.durationMs));
  const paceMedianMs = median(pace.map((r) => r.durationMs));
  const basePitch = median(base.map((r) => r.medianHz));
  const pacePitch = median(pace.map((r) => r.medianHz));
  const complete = base.length >= requiredBase && pace.length >= requiredPace;
  const shorterPct = baseMedianMs && paceMedianMs !== null ? ((baseMedianMs - paceMedianMs) / baseMedianMs) * 100 : null;
  const pitchChangePct = basePitch && pacePitch !== null ? ((pacePitch - basePitch) / basePitch) * 100 : null;
  const longestPaceMs = pace.length ? Math.max(...pace.map((r) => r.durationMs)) : null;
  const inBand = shorterPct !== null && shorterPct >= PACE_RULE.minShorterPct && shorterPct <= PACE_RULE.maxShorterPct;
  const noneLonger = longestPaceMs !== null && baseMedianMs !== null && longestPaceMs <= baseMedianMs;
  const pitchOk = pitchChangePct !== null && Math.abs(pitchChangePct) < PACE_RULE.maxPitchChangePct;
  return {
    baseRuns: base.length,
    paceRuns: pace.length,
    complete,
    baseMedianMs: round(baseMedianMs, 0),
    paceMedianMs: round(paceMedianMs, 0),
    shorterPct: round(shorterPct),
    longestPaceMs: round(longestPaceMs, 0),
    basePitchHz: round(basePitch),
    pacePitchHz: round(pacePitch),
    pitchChangePct: round(pitchChangePct),
    inBand,
    noneLonger,
    pitchOk,
    rulePasses: complete && inBand && noneLonger && pitchOk,
  };
}

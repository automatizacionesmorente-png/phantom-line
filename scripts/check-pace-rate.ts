/**
 * natural-voice task 10.7: pace option 2, measured with no quota. Runs `timeStretch` at 1.1 over
 * the spike's streamed `es-es-commercial-3` offer samples of both 3.8 models, fed in 100 ms
 * chunks as the player receives them, and writes `.measurements/tts/<model>-pace-rate-1.10.wav`
 * for the owner to listen to. Prints and saves (`.measurements/tts/pace-rate.json`) the durations
 * before and after and the median pitch of both. No API call, no key, no database.
 *
 *   node --import tsx scripts/check-pace-rate.ts [--rate=1.1]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createTimeStretcher } from "../lib/voice/timeStretch";
import { medianF0, parseWav } from "./lib/audioAnalysis.mjs";

const DIR = ".measurements/tts";
const MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];
const rateArg = process.argv.find((a) => a.startsWith("--rate="));
const RATE = rateArg ? Number(rateArg.slice("--rate=".length)) : 1.1;

function wav16(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), 2 * i);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const results = [];
for (const model of MODELS) {
  const input = `${DIR}/${model}-es-es-commercial-3-es-offer-stream.wav`;
  const wav = parseWav(new Uint8Array(readFileSync(input)));
  const sr: number = wav.sampleRate;
  const x: Float32Array = wav.samples;
  const ts = createTimeStretcher(RATE, sr);
  const parts: Float32Array[] = [];
  const chunk = Math.round(sr / 10);
  const t0 = performance.now();
  for (let i = 0; i < x.length; i += chunk) parts.push(ts.push(x.subarray(i, Math.min(x.length, i + chunk))));
  parts.push(ts.flush());
  const ms = performance.now() - t0;
  const y = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    y.set(p, at);
    at += p.length;
  }
  const output = `${DIR}/${model}-pace-rate-${RATE.toFixed(2)}.wav`;
  writeFileSync(output, wav16(y, sr));
  const before = medianF0(x, sr).medianHz as number;
  const after = medianF0(y, sr).medianHz as number;
  const r = {
    model,
    input,
    output,
    rate: RATE,
    beforeS: +(x.length / sr).toFixed(3),
    afterS: +(y.length / sr).toFixed(3),
    changePct: +(((y.length - x.length) / x.length) * 100).toFixed(1),
    pitchBeforeHz: +before.toFixed(1),
    pitchAfterHz: +after.toFixed(1),
    pitchChangePct: +(((after - before) / before) * 100).toFixed(2),
    stretchMs: Math.round(ms),
  };
  results.push(r);
  console.log(JSON.stringify(r));
}
writeFileSync(`${DIR}/pace-rate.json`, JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2) + "\n");

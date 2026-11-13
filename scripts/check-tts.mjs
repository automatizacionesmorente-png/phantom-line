// Verification spike for task 1 of .kiro/specs/natural-voice/tasks.md: Gemini text-to-speech
// on the free tier.
//
// Run with:  node --env-file=.env.local scripts/check-tts.mjs <check> [options]
// Checks:
//   models                 TTS-capable models visible to this key (models.list)
//   voices                 prebuilt voices for es-ES and en-US (voices.list)
//   once                   one call per model and mode, prints format, size, duration, latency
//   style                  the same line plain / style in system_instruction / style in the input,
//                          to see whether the style prompt changes the length (is it read aloud?)
//   formats                which response_format mime types the API accepts
//   repeat                 --n=N calls per model, spaced by --gap=ms in round robin, streaming;
//                          prints time to first audio and totals per model
//   burst                  --n=N calls back to back on one model, to find the per-minute cap
//   pace                   task 3.7: the offer sentence, not streamed, voice es-es-commercial-3, on
//                          both 3.8 models: 2 runs with the current style and 3 with the "algo ágil"
//                          style per model, interleaved and spaced by --gap (default 20 000 ms).
//                          10 TTS requests in total, no retries; a model that answers 429 gets no
//                          more requests. Saves .measurements/tts/<model>-pace-<base|agil>-<n>.wav
//                          and writes durations and median pitch to .measurements/tts/pace.json.
//                          --plan prints the 10 requests and makes no call. --offline makes no call
//                          and measures the files already in .measurements/tts/ (pace-offline.json).
// Options: --model=a,b (default: the TTS models in the SDK's model list), --voice=Name,
//          --lang=es|en, --stream, --gap=ms, --n=N, --save (writes audio to .measurements/tts/)
//
// Node loads .env.local itself; this script never prints process.env or the key. Every
// error message goes through redact() before it is printed. Audio samples go only to
// .measurements/ (git-ignored). The texts are fixed demo phrases, no personal data.

import { GoogleGenAI } from "@google/genai";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { medianF0, paceVerdict, parseWav, PACE_RULE } from "./lib/audioAnalysis.mjs";

const check = process.argv[2] ?? "models";
const flag = (name) => process.argv.includes(`--${name}`);
// Only the offline parts of `pace` run without a key: they make no API call.
const needsKey = !(check === "pace" && (flag("plan") || flag("offline")));
const apiKey = process.env.GEMINI_API_KEY ?? "";
if (needsKey && !apiKey) {
  console.log(JSON.stringify({ outcome: "missing GEMINI_API_KEY" }));
  process.exit(1);
}

const arg = (name, fallback) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
};

const DEFAULT_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview"];
const models = arg("model", DEFAULT_MODELS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const lang = arg("lang", "es");
const voice = arg("voice", "Kore");
const gapMs = Number(arg("gap", "20000"));
const n = Number(arg("n", "6"));
const save = flag("save");
const CALL_CAP_MS = 30000;

const TEXT = {
  es: {
    greeting:
      "¡Hola! Estás llamando a Peluquería Lola. Soy su asistente virtual: ahora mismo no pueden atenderte, pero yo te ayudo. ¿Qué necesitas?",
    offer:
      "A las nueve ya hemos cerrado. ¿Te viene bien a las siete y media? También tengo a las siete y cuarto o a las siete.",
    short: "Vale, perfecto. ¿Me dices tu nombre?",
  },
  en: {
    greeting:
      "Hi! You've reached Peluquería Lola. I'm the salon's virtual assistant: nobody can pick up right now, but I can help. What do you need?",
    offer: "We're closed by nine. Does half past seven work for you? I also have quarter past seven or seven.",
    short: "Great. Can I have your name?",
  },
};
const STYLE = {
  es: "Una peluquera simpática de Madrid, relajada, a ritmo natural y sonriendo.",
  en: "A friendly hairdresser in Madrid speaking English, relaxed, natural pace, smiling.",
};
const LOCALE = { es: "es-ES", en: "en-US" };

function redact(text) {
  const s = String(text);
  return apiKey ? s.split(apiKey).join("***") : s;
}
function errorInfo(err) {
  const e = /** @type {any} */ (err);
  const message = redact(e?.message ?? "");
  return {
    errorClass: e?.constructor?.name ?? typeof e,
    status: e?.status ?? e?.statusCode ?? null,
    // The quota numbers live in the 429 message ("limit: N", quotaId); keep enough of it.
    message: message.slice(0, e?.status === 429 ? 900 : 300),
  };
}
function report(fields) {
  console.log(redact(JSON.stringify(fields)));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ai = needsKey ? new GoogleGenAI({ apiKey }) : null;
const options = () => ({ retries: { strategy: "none" }, signal: AbortSignal.timeout(CALL_CAP_MS) });

function params(model, { text, stream = false, mime, style = "none", styleText = STYLE[lang], voiceName = voice, language = lang }) {
  // style: "none" | "system" (system_instruction) | "input" (style line, blank line, text) |
  // "say" ("Say it like this: …: text", the TTS prompt convention) |
  // "annotation" (a text block with a speech_metadata annotation over the whole text).
  const input =
    style === "input"
      ? `${styleText}\n\n${text}`
      : style === "say"
        ? `${language === "es" ? "Dilo así" : "Say it like this"}, ${styleText.replace(/\.$/, "").toLowerCase()}: ${text}`
        : style === "annotation"
          ? [
              {
                type: "text",
                text,
                annotations: [
                  { type: "speech_metadata", style: styleText, start_index: 0, end_index: Buffer.byteLength(text, "utf8") },
                ],
              },
            ]
          : text;
  const p = {
    model,
    input,
    store: false,
    response_format: { type: "audio", ...(mime ? { mime_type: mime } : {}) },
    generation_config: { speech_config: [{ voice: voiceName, language: LOCALE[language] }] },
  };
  if (style === "system") p.system_instruction = styleText;
  if (stream) p.stream = true;
  return p;
}

/** Duration in ms for raw 16-bit mono PCM; null for compressed formats. */
function pcmDurationMs(bytes, mime, rate) {
  if (!/l16|pcm/i.test(mime ?? "")) return null;
  const r = rate || Number(/rate=(\d+)/.exec(mime ?? "")?.[1]) || 24000;
  return Math.round((bytes / 2 / r) * 1000);
}

function wavHeader(dataBytes, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

function saveAudio(label, buf, mime, rate) {
  if (!save || buf.length === 0) return null;
  mkdirSync(".measurements/tts", { recursive: true });
  const pcm = /l16|pcm/i.test(mime ?? "");
  const ext = pcm ? "wav" : /mp3|mpeg/.test(mime ?? "") ? "mp3" : /ogg|opus/.test(mime ?? "") ? "ogg" : /wav/.test(mime ?? "") ? "wav" : "bin";
  const file = `.measurements/tts/${label.replace(/[^a-z0-9.-]+/gi, "_")}.${ext}`;
  const r = rate || Number(/rate=(\d+)/.exec(mime ?? "")?.[1]) || 24000;
  writeFileSync(file, pcm ? Buffer.concat([wavHeader(buf.length, r), buf]) : buf);
  return file;
}

/** Finds audio blocks in a non-streaming interaction, wherever the SDK puts them. */
function audioOf(interaction) {
  const blocks = [];
  if (interaction?.output_audio?.data) blocks.push(interaction.output_audio);
  for (const step of interaction?.steps ?? []) {
    for (const c of step?.content ?? []) if (c?.type === "audio" && c.data) blocks.push(c);
  }
  // output_audio may repeat the last step's block: keep distinct payloads only.
  const seen = new Set();
  return blocks.filter((b) => (seen.has(b.data) ? false : (seen.add(b.data), true)));
}

async function callOnce(model, opts) {
  const t0 = performance.now();
  try {
    if (!opts.stream) {
      const it = await ai.interactions.create(params(model, opts), options());
      const latencyMs = Math.round(performance.now() - t0);
      const blocks = audioOf(it);
      const buf = Buffer.concat(blocks.map((b) => Buffer.from(b.data, "base64")));
      const mime = blocks[0]?.mime_type;
      const rate = blocks[0]?.sample_rate;
      return {
        ok: true,
        latencyMs,
        firstAudioMs: latencyMs,
        chunks: blocks.length,
        bytes: buf.length,
        mime,
        rate,
        channels: blocks[0]?.channels,
        audioMs: pcmDurationMs(buf.length, mime, rate),
        status: it?.status,
        usage: it?.usage ? { in: it.usage.total_input_tokens, out: it.usage.total_output_tokens } : undefined,
        buf,
      };
    }
    const stream = await ai.interactions.create(params(model, opts), options());
    let firstAudioMs = null;
    let chunks = 0;
    let mime;
    let rate;
    const parts = [];
    const chunkTimes = [];
    const eventTypes = {};
    let audioBytes = 0;
    let minLeadMs = Infinity;
    let maxGapMs = 0;
    for await (const ev of stream) {
      eventTypes[ev.event_type] = (eventTypes[ev.event_type] ?? 0) + 1;
      if (ev.event_type === "error") throw Object.assign(new Error(JSON.stringify(ev).slice(0, 300)), { status: ev?.error?.code });
      const d = ev.event_type === "step.delta" ? ev.delta : null;
      if (d?.type === "audio" && d.data) {
        const t = Math.round(performance.now() - t0);
        if (firstAudioMs === null) firstAudioMs = t;
        chunks += 1;
        chunkTimes.push(t);
        mime ??= d.mime_type;
        rate ??= d.sample_rate;
        const b = Buffer.from(d.data, "base64");
        // Playing from the first chunk on: how far ahead of the playhead is this chunk?
        // Negative means the caller would hear a gap of that many ms.
        const playedMs = t - firstAudioMs;
        const queuedMs = (audioBytes / 2 / (rate || 24000)) * 1000;
        minLeadMs = Math.min(minLeadMs, Math.round(queuedMs - playedMs));
        maxGapMs = Math.max(maxGapMs, chunkTimes.length > 1 ? t - chunkTimes[chunkTimes.length - 2] : 0);
        audioBytes += b.length;
        parts.push(b);
      }
    }
    const buf = Buffer.concat(parts);
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - t0),
      firstAudioMs,
      chunks,
      chunkTimes: chunkTimes.length > 6 ? [...chunkTimes.slice(0, 3), "…", ...chunkTimes.slice(-2)] : chunkTimes,
      bytes: buf.length,
      mime,
      rate,
      audioMs: pcmDurationMs(buf.length, mime, rate),
      minLeadMs: Number.isFinite(minLeadMs) ? minLeadMs : null,
      maxGapMs,
      eventTypes,
      buf,
    };
  } catch (err) {
    return { ok: false, latencyMs: Math.round(performance.now() - t0), ...errorInfo(err) };
  }
}

function printable(r) {
  const rest = { ...r };
  delete rest.buf;
  return rest;
}

async function checkModels() {
  const found = [];
  const pager = await ai.models.list({ config: { pageSize: 200 } });
  for await (const m of pager) {
    if (/tts|audio|speech|live/i.test(m.name ?? "")) {
      found.push({ name: m.name, actions: m.supportedActions, inputTokens: m.inputTokenLimit, outputTokens: m.outputTokenLimit });
    }
  }
  report({ check: "models", count: found.length, models: found });
}

async function checkVoices() {
  for (const code of ["es-ES", "en-US"]) {
    try {
      const res = await ai.voices.list({ language_code: [code], type: ["prebuilt"], page_size: 200 }, options());
      const voices = (res.voices ?? []).map((v) =>
        [v.display_name, v.gender, v.pitch, v.persona, v.accent, v.context, (v.description ?? "").slice(0, 90)].filter(Boolean).join(" | "),
      );
      report({ check: "voices", language: code, count: voices.length, voices });
    } catch (err) {
      report({ check: "voices", language: code, outcome: "error", ...errorInfo(err) });
    }
  }
}

async function checkOnce() {
  for (const model of models) {
    for (const stream of [false, true]) {
      const r = await callOnce(model, { text: TEXT[lang].offer, stream });
      const file = r.ok ? saveAudio(`${model}-${voice}-${lang}-offer-${stream ? "stream" : "plain"}`, r.buf, r.mime, r.rate) : null;
      report({ check: "once", model, voice, lang, stream, ...printable(r), file });
      await sleep(gapMs);
    }
  }
}

async function checkStyle() {
  const model = models[0];
  const styles = arg("styles", "none,system,input,say,annotation").split(",");
  for (const style of styles) {
    const r = await callOnce(model, { text: TEXT[lang].offer, stream: flag("stream"), style });
    const file = r.ok ? saveAudio(`${model}-${voice}-${lang}-style-${style}`, r.buf, r.mime, r.rate) : null;
    report({ check: "style", model, voice, lang, style, ...printable(r), file });
    await sleep(gapMs);
  }
}

async function checkFormats() {
  const model = models[0];
  for (const mime of [undefined, "audio/l16", "audio/wav", "audio/mp3", "audio/ogg_opus"]) {
    const r = await callOnce(model, { text: TEXT[lang].short, mime });
    const file = r.ok ? saveAudio(`${model}-${voice}-${lang}-format-${mime ?? "default"}`, r.buf, r.mime, r.rate) : null;
    report({ check: "formats", model, requested: mime ?? "(default)", ...printable(r), file });
    await sleep(gapMs);
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function checkRepeat() {
  const style = arg("style", "none");
  const stats = Object.fromEntries(
    models.map((m) => [m, { ok: 0, s429: 0, s5xx: 0, timeout: 0, other: 0, first: [], total: [], ratio: [], stalls: 0, worstLead: 0, maxGap: 0 }]),
  );
  const texts = [TEXT[lang].short, TEXT[lang].offer, TEXT[lang].greeting];
  for (let k = 0; k < n; k++) {
    for (const model of models) {
      const text = texts[k % texts.length];
      const r = await callOnce(model, { text, stream: true, style });
      const s = stats[model];
      if (r.ok && r.bytes > 0) {
        s.ok += 1;
        s.first.push(r.firstAudioMs);
        s.total.push(r.latencyMs);
        if (r.audioMs) s.ratio.push(Math.round((r.latencyMs / r.audioMs) * 100) / 100);
        if (r.minLeadMs < 0) s.stalls += 1;
        s.worstLead = Math.min(s.worstLead, r.minLeadMs ?? 0);
        s.maxGap = Math.max(s.maxGap, r.maxGapMs ?? 0);
      } else if (r.status === 429) s.s429 += 1;
      else if (typeof r.status === "number" && r.status >= 500) s.s5xx += 1;
      else if (/timeout|abort/i.test(`${r.errorClass} ${r.message}`)) s.timeout += 1;
      else s.other += 1;
      const short = printable(r);
      delete short.eventTypes;
      delete short.chunkTimes;
      report({ check: "repeat", k, model, style, chars: text.length, ...short, at: new Date().toISOString() });
      await sleep(gapMs);
    }
  }
  for (const [model, s] of Object.entries(stats)) {
    const f = [...s.first].sort((a, b) => a - b);
    const t = [...s.total].sort((a, b) => a - b);
    report({
      check: "repeat-summary",
      model,
      calls: n,
      ok: s.ok,
      "429": s.s429,
      "5xx": s.s5xx,
      timeout: s.timeout,
      other: s.other,
      firstAudio: { p50: pct(f, 50), p90: pct(f, 90), max: f[f.length - 1] ?? null },
      total: { p50: pct(t, 50), p90: pct(t, 90), max: t[t.length - 1] ?? null },
      generationOverAudio: s.ratio,
      stalledCalls: s.stalls,
      worstLeadMs: s.worstLead,
      maxChunkGapMs: s.maxGap,
    });
  }
}

async function checkBurst() {
  const model = models[0];
  for (let k = 0; k < n; k++) {
    const r = await callOnce(model, { text: TEXT[lang].short, stream: true });
    report({ check: "burst", k, model, ...printable(r), at: new Date().toISOString() });
    if (!r.ok && r.status === 429) break;
  }
}

/**
 * The Live API as a text-to-speech engine: one session per reply, the model is told to read
 * the text exactly, and the output transcription shows whether it did.
 */
async function liveOnce(model, text, voiceName) {
  const { Modality } = await import("@google/genai");
  const t0 = performance.now();
  let connectedMs = null;
  let sentAt = null;
  let firstAudioMs = null;
  let bytes = 0;
  let chunks = 0;
  let transcript = "";
  let mime;
  let session;
  try {
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("live timeout")), CALL_CAP_MS);
      ai.live
        .connect({
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } }, languageCode: LOCALE[lang] },
            systemInstruction:
              lang === "es"
                ? `Eres una voz que lee en voz alta. Lee exactamente el texto del usuario, palabra por palabra, sin añadir ni quitar nada, en español de España. Estilo: ${STYLE.es}`
                : `You are a voice that reads aloud. Read the user's text exactly, word for word, adding or removing nothing. Style: ${STYLE.en}`,
            outputAudioTranscription: {},
          },
          callbacks: {
            onmessage: (m) => {
              const sc = m.serverContent;
              for (const p of sc?.modelTurn?.parts ?? []) {
                if (p.inlineData?.data) {
                  if (firstAudioMs === null) firstAudioMs = Math.round(performance.now() - sentAt);
                  mime ??= p.inlineData.mimeType;
                  bytes += Buffer.from(p.inlineData.data, "base64").length;
                  chunks += 1;
                }
              }
              if (sc?.outputTranscription?.text) transcript += sc.outputTranscription.text;
              if (sc?.turnComplete) {
                clearTimeout(timer);
                resolve();
              }
            },
            onerror: (e) => {
              clearTimeout(timer);
              reject(new Error(e?.message ?? "live error"));
            },
            onclose: (e) => {
              if (e?.code && e.code !== 1000) {
                clearTimeout(timer);
                reject(Object.assign(new Error(`closed ${e.code} ${e.reason ?? ""}`), { status: e.code }));
              }
            },
          },
        })
        .then((s) => {
          session = s;
          connectedMs = Math.round(performance.now() - t0);
          sentAt = performance.now();
          s.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
        }, reject);
    });
    await done;
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
    return {
      ok: true,
      connectedMs,
      firstAudioMs,
      totalMs: Math.round(performance.now() - t0),
      chunks,
      mime,
      audioMs: Math.round((bytes / 2 / 24000) * 1000),
      wordsMatch: norm(transcript) === norm(text),
      transcriptWords: norm(transcript).split(" ").length,
      textWords: norm(text).split(" ").length,
    };
  } catch (err) {
    return { ok: false, latencyMs: Math.round(performance.now() - t0), ...errorInfo(err) };
  } finally {
    try {
      session?.close();
    } catch {
      /* closed */
    }
  }
}

async function checkLive() {
  const texts = [TEXT[lang].short, TEXT[lang].offer, TEXT[lang].greeting];
  for (let k = 0; k < n; k++) {
    for (const model of models) {
      const r = await liveOnce(model, texts[k % texts.length], voice);
      report({ check: "live", k, model, voice, ...r, at: new Date().toISOString() });
      await sleep(gapMs);
    }
  }
}

// ---- pace (task 3.7) ----------------------------------------------------------------------

const PACE_MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];
const PACE_VOICE = "es-es-commercial-3";
const PACE_STYLE = {
  base: STYLE.es,
  agil: "Una peluquera simpática de Madrid, relajada, a un ritmo algo ágil, natural, y sonriendo.",
};
// The spike's annotated sample with the current style counts as a third baseline run (design.md).
const SPIKE_BASELINE = {
  "gemini-3.8-flash-lite-tts": ".measurements/tts/gemini-3.8-flash-lite-tts-es-es-commercial-3-es-style-annotation.wav",
};
const TTS_DIR = ".measurements/tts";

/** 10 requests: the conditions interleaved over time, the two models alternating. */
function pacePlan(paceModels) {
  const order = [
    ["base", 1],
    ["agil", 1],
    ["base", 2],
    ["agil", 2],
    ["agil", 3],
  ];
  return order.flatMap(([condition, k]) =>
    paceModels.map((model) => ({ model, condition, n: k, file: `${TTS_DIR}/${model}-pace-${condition}-${k}.wav` })),
  );
}

function analyzeFile(file) {
  const wav = parseWav(new Uint8Array(readFileSync(file)));
  const f0 = medianF0(wav.samples, wav.sampleRate);
  return {
    durationMs: Math.round(wav.durationMs),
    medianHz: f0.medianHz === null ? null : Math.round(f0.medianHz * 10) / 10,
    voicedFrames: f0.voicedFrames,
    sampleRate: wav.sampleRate,
    channels: wav.channels,
  };
}

function paceSummary(paceModels, runs) {
  return paceModels.map((model) => {
    const mine = runs.filter((r) => r.model === model && r.ok);
    const spike = SPIKE_BASELINE[model] && existsSync(SPIKE_BASELINE[model]) ? { condition: "base", source: "spike", file: SPIKE_BASELINE[model], ...analyzeFile(SPIKE_BASELINE[model]) } : null;
    const all = spike ? [...mine, spike] : mine;
    return {
      model,
      spikeBaseline: spike ? { file: spike.file, durationMs: spike.durationMs, medianHz: spike.medianHz } : null,
      ...paceVerdict(all, { requiredBase: PACE_RULE.baseRuns + (spike ? 1 : 0), requiredPace: PACE_RULE.paceRuns }),
    };
  });
}

async function checkPace() {
  const paceModels = arg("model", PACE_MODELS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const plan = pacePlan(paceModels);
  const text = TEXT.es.offer;
  const voiceName = arg("voice", PACE_VOICE);

  if (flag("plan")) {
    report({ check: "pace", mode: "plan", requests: plan.length, gapMs, voice: voiceName, text, styles: PACE_STYLE, plan });
    return;
  }

  if (flag("offline")) {
    // No API call: measure the pace files that exist, plus every spike sample of the offer
    // sentence with this voice, so the helper and the baseline can be checked without quota.
    const runs = plan.filter((j) => existsSync(j.file)).map((j) => ({ ...j, ok: true, ...analyzeFile(j.file) }));
    const reference = readdirSync(TTS_DIR)
      .filter((f) => f.includes(`${voiceName}-es-`) && /-(offer|style)-/.test(f) && f.endsWith(".wav"))
      .sort()
      .map((f) => ({ file: `${TTS_DIR}/${f}`, ...analyzeFile(`${TTS_DIR}/${f}`) }));
    const out = { check: "pace", mode: "offline", at: new Date().toISOString(), requests: 0, runs, reference, summary: paceSummary(paceModels, runs) };
    writeFileSync(`${TTS_DIR}/pace-offline.json`, JSON.stringify(out, null, 2));
    report({ ...out, written: `${TTS_DIR}/pace-offline.json` });
    return;
  }

  mkdirSync(TTS_DIR, { recursive: true });
  const exhausted = new Set();
  const runs = [];
  let requests = 0;
  for (const [k, job] of plan.entries()) {
    if (exhausted.has(job.model)) {
      runs.push({ ...job, ok: false, skipped: "model answered 429 earlier in this run" });
      continue;
    }
    if (requests > 0) await sleep(gapMs);
    requests += 1;
    const r = await callOnce(job.model, { text, style: "annotation", styleText: PACE_STYLE[job.condition], voiceName, language: "es" });
    const at = new Date().toISOString();
    if (r.ok && r.bytes > 0) {
      const pcm = /l16|pcm/i.test(r.mime ?? "");
      writeFileSync(job.file, pcm ? Buffer.concat([wavHeader(r.buf.length, r.rate || 24000), r.buf]) : r.buf);
      const run = { ...job, ok: true, at, latencyMs: r.latencyMs, mime: r.mime, bytes: r.bytes, ...analyzeFile(job.file) };
      runs.push(run);
      report({ check: "pace", k, ...run });
    } else {
      // Never retried: a failure is recorded as it is.
      if (r.status === 429) exhausted.add(job.model);
      const run = { ...job, file: null, ok: false, at, latencyMs: r.latencyMs, status: r.status ?? null, errorClass: r.errorClass ?? null, message: r.message ?? null };
      runs.push(run);
      report({ check: "pace", k, ...run });
    }
  }
  const out = {
    check: "pace",
    mode: "live",
    at: new Date().toISOString(),
    voice: voiceName,
    text,
    styles: PACE_STYLE,
    gapMs,
    requests,
    runs,
    summary: paceSummary(paceModels, runs),
    rule: { ...PACE_RULE, note: "rulePasses means the numbers pass on that model; the owner still listens to one pace sample per model" },
  };
  writeFileSync(`${TTS_DIR}/pace.json`, JSON.stringify(out, null, 2));
  report({ check: "pace-summary", requests, summary: out.summary, written: `${TTS_DIR}/pace.json` });
}

const checks = { models: checkModels, voices: checkVoices, once: checkOnce, style: checkStyle, formats: checkFormats, repeat: checkRepeat, burst: checkBurst, live: checkLive, pace: checkPace };
if (!checks[check]) {
  report({ outcome: `unknown check ${check}`, checks: Object.keys(checks) });
  process.exit(1);
}
await checks[check]();

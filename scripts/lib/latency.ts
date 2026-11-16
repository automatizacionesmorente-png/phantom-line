/**
 * The Latency_Script's logic (front-desk-brain Requirement 22.2, design.md "L6: measuring"),
 * kept out of scripts/measure-latency.ts so it can be tested with a fake `fetch` and a fake clock.
 *
 * It drives scripted Calls against a base URL, through the same HTTP contract as the Call_Page,
 * and measures each Turn from the moment its `/api/turn` request is sent:
 *   - `server.*`: the stages of the `Server-Timing` header (brain, db, model, total), or null when
 *     the header is missing (today's deploy has none), reported as "n/a", never as 0;
 *   - `replyMs`: the reply text is in hand (the JSON body, or the stream's first line);
 *   - `audioHeaderMs`: the audio's status is known (the `/api/speech` response headers in legacy
 *     mode, the stream's second line in inline mode);
 *   - `firstAudioByteMs`: the first PCM byte (after the WAV header for a cached line);
 *   - `audio150Ms`: 150 ms of audio buffered, the Start_Buffer of Requirement 21;
 *   - `underruns`: how often a real-time player starting at the Start_Buffer would have run dry
 *     (150 ms until the Call's first underrun, 300 ms after it, as design.md "L5").
 *
 * Only durations are kept: no utterance, reply, name or phone ends up in the output (22.5's rule
 * for the Timing_Panel, applied here too).
 */

export type Lang = "es" | "en";
export type Mode = "legacy" | "inline";
/** What the new build is expected to do with a Turn: `start` is the greeting. */
export type Expect = "start" | "sure" | "model";

/** The demo shop (lib/owner/demo.ts DEMO_SHOP_ID; a test keeps them equal). */
export const DEFAULT_SHOP_ID = "peluqueria-lola";
/** The Start_Buffer while the Call's stream is steady, and after an underrun (Requirement 21.1). */
export const START_BUFFER_MS = 150;
export const START_BUFFER_AFTER_UNDERRUN_MS = 300;
/** Default spacing of Turn starts: 6 s keeps one visitor at 10 Turns a minute, under the default 12. */
export const DEFAULT_GAP_MS = 6000;
export const STAGES = ["brain", "db", "model", "total", "replyMs", "audioHeaderMs", "firstAudioByteMs", "audio150Ms"] as const;
export type Stage = (typeof STAGES)[number];

export interface ScriptedTurn {
  utterance: string;
  /** What the new build should do with it: answer it in code (Sure_Reading) or call the model. */
  expect: "sure" | "model";
}
export interface ScriptedCall {
  id: "regression" | "faq" | "price" | "free";
  lang: Lang;
  turns: ScriptedTurn[];
}

/**
 * The scripted Calls. The regression call is Real_Call_2026_11_16 (task 10.1), whose every Turn
 * is a Sure_Reading in the new build; its English twin follows the same steps. The name and the
 * phone are invented test data (the demo says "do not leave real personal data").
 */
export const SCRIPTED_CALLS: Record<Lang, ScriptedCall[]> = {
  es: [
    {
      id: "regression",
      lang: "es",
      turns: [
        { utterance: "Hola Lola quería cortarme el pelo y hacerme un degradado", expect: "sure" },
        { utterance: "sí", expect: "sure" },
        { utterance: "Me llamo Ana Prueba", expect: "sure" },
        { utterance: "612 345 678", expect: "sure" },
        { utterance: "sí", expect: "sure" },
      ],
    },
    { id: "faq", lang: "es", turns: [{ utterance: "¿Hay aparcamiento cerca?", expect: "sure" }] },
    { id: "price", lang: "es", turns: [{ utterance: "¿Cuánto cuesta el tinte?", expect: "sure" }] },
    { id: "free", lang: "es", turns: [{ utterance: "Oye, ¿Lola sigue teniendo el perro en la peluquería?", expect: "model" }] },
  ],
  en: [
    {
      id: "regression",
      lang: "en",
      turns: [
        { utterance: "Hi Lola, I'd like a haircut and a fade", expect: "sure" },
        { utterance: "yes", expect: "sure" },
        { utterance: "My name is Ana Test", expect: "sure" },
        { utterance: "612 345 678", expect: "sure" },
        { utterance: "yes", expect: "sure" },
      ],
    },
    { id: "faq", lang: "en", turns: [{ utterance: "Is there parking nearby?", expect: "sure" }] },
    { id: "price", lang: "en", turns: [{ utterance: "How much is a colour?", expect: "sure" }] },
    { id: "free", lang: "en", turns: [{ utterance: "Does Lola still have the dog at the salon?", expect: "model" }] },
  ],
};

// ---------------------------------------------------------------------------
// Options

export interface Options {
  base: URL;
  allowRemote: boolean;
  /** At least this many `say` Turns per language; the scripted Calls repeat until it is reached. */
  turns: number;
  langs: Lang[];
  mode: Mode;
  shopId: string;
  gapMs: number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalBase(base: URL): boolean {
  return LOCAL_HOSTS.has(base.hostname) || base.hostname.endsWith(".localhost");
}

/** Parses argv (without node and the script). Throws with a readable message on a bad option. */
export function parseOptions(argv: readonly string[]): Options {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const flag = (name: string) => argv.includes(`--${name}`);
  const known = new Set(["base", "allow-remote", "turns", "lang", "legacy", "shop", "gap"]);
  for (const a of argv) {
    const name = a.replace(/^--/, "").split("=")[0];
    if (!a.startsWith("--") || !known.has(name)) throw new Error(`unknown argument: ${a}`);
  }
  const rawBase = value("base") ?? "http://localhost:3000";
  let base: URL;
  try {
    base = new URL(rawBase);
  } catch {
    throw new Error(`--base is not a URL: ${rawBase}`);
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("--base must be http or https");
  const allowRemote = flag("allow-remote");
  if (!isLocalBase(base) && !allowRemote) {
    throw new Error(
      `refusing remote base ${base.origin}: it writes Calls, Messages and bookings to that shop's database and spends its model and TTS quota. Pass --allow-remote if that is what you want.`,
    );
  }
  const whole = (name: string, fallback: number, min: number) => {
    const raw = value(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be a whole number of at least ${min}`);
    return n;
  };
  const lang = value("lang") ?? "both";
  if (lang !== "es" && lang !== "en" && lang !== "both") throw new Error("--lang must be es, en or both");
  return {
    base,
    allowRemote,
    turns: whole("turns", 0, 0),
    langs: lang === "both" ? ["es", "en"] : [lang],
    mode: flag("legacy") ? "legacy" : "inline",
    shopId: value("shop") ?? DEFAULT_SHOP_ID,
    gapMs: whole("gap", DEFAULT_GAP_MS, 0),
  };
}

// ---------------------------------------------------------------------------
// The plan, stated before any request

/** The Calls of one language, repeated until they hold at least `minTurns` `say` Turns (one pass at least). */
export function callsFor(lang: Lang, minTurns: number): ScriptedCall[] {
  const pass = SCRIPTED_CALLS[lang];
  const perPass = pass.reduce((n, c) => n + c.turns.length, 0);
  const passes = Math.max(1, Math.ceil(minTurns / perPass));
  return Array.from({ length: passes }, () => pass).flat();
}

export interface Plan {
  calls: number;
  /** `start` and `say` requests to /api/turn (hang-ups are extra and unmeasured). */
  turns: number;
  sayTurns: number;
  /** The most model calls the scripted Turns can cause on the server under test. */
  maxModelCalls: number;
  /** The most TTS requests: one per reply whose audio is not cached. */
  maxTtsRequests: number;
}

export function plan(opts: Pick<Options, "langs" | "turns" | "mode">): Plan {
  const calls = opts.langs.flatMap((l) => callsFor(l, opts.turns));
  const says = calls.flatMap((c) => c.turns);
  return {
    calls: calls.length,
    turns: calls.length + says.length,
    sayTurns: says.length,
    // Today's deploy (legacy) asks the model on every `say`; the new build only on the free questions.
    maxModelCalls: opts.mode === "legacy" ? says.length : says.filter((t) => t.expect === "model").length,
    // A greeting or a fixed line is usually cached and needs none; this is the ceiling.
    maxTtsRequests: calls.length + says.length,
  };
}

export function describePlan(p: Plan, opts: Pick<Options, "base" | "mode" | "langs" | "gapMs">): string {
  return [
    `Latency_Script against ${opts.base.origin} (${opts.mode === "legacy" ? "legacy: JSON + /api/speech" : "inline audio stream"}), ${opts.langs.join(" + ")}`,
    `  ${p.calls} Calls, ${p.turns} Turns (${p.sayTurns} say), Turns spaced ${opts.gapMs} ms`,
    `  model calls: at most ${p.maxModelCalls}`,
    `  TTS requests: at most ${p.maxTtsRequests} (cached lines need none; the demo's TTS budget is 20 an hour and 30 a day by default)`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Pure measurement helpers

/** Nearest-rank percentile; null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export type ServerTiming = Record<"brain" | "db" | "model" | "total", number | null>;

/**
 * The four stages of a `Server-Timing` header (`brain;dur=1.2, db;dur=30, model;dur=0, total;dur=41`).
 * A missing header gives null; a stage missing from the header, or without a `dur`, is null too.
 */
export function parseServerTiming(header: string | null): ServerTiming | null {
  if (header === null) return null;
  const out: ServerTiming = { brain: null, db: null, model: null, total: null };
  for (const entry of header.split(",")) {
    const [name, ...params] = entry.split(";").map((s) => s.trim());
    if (!(name in out)) continue;
    const dur = params.find((p) => p.toLowerCase().startsWith("dur="));
    const n = dur === undefined ? NaN : Number(dur.slice(4));
    out[name as keyof ServerTiming] = Number.isFinite(n) ? n : null;
  }
  return out;
}

/** The sample rate of `audio/L16; rate=24000; channels=1`, or null. */
export function rateOfContentType(contentType: string | null): number | null {
  const m = /rate=(\d+)/i.exec(contentType ?? "");
  return m ? Number(m[1]) : null;
}

/** 16-bit mono PCM bytes for `ms` milliseconds. */
export const pcmBytesFor = (ms: number, sampleRate: number) => Math.ceil((sampleRate * 2 * ms) / 1000);

/** A chunk of PCM as it arrived, `atMs` from the Turn's send. */
export interface PcmArrival {
  atMs: number;
  bytes: number;
}

export interface PlaybackResult {
  firstAudioByteMs: number | null;
  audio150Ms: number | null;
  underruns: number;
}

/**
 * Plays the arrivals in real time like the Call_Page's stream player: playback starts once
 * `startBufferMs` of audio is buffered (or the stream ended with less), and a chunk that arrives
 * after the scheduled audio ran out is one underrun (design.md "L5").
 */
export function playback(arrivals: readonly PcmArrival[], sampleRate: number, startBufferMs: number): PlaybackResult {
  const real = arrivals.filter((a) => a.bytes > 0);
  if (real.length === 0) return { firstAudioByteMs: null, audio150Ms: null, underruns: 0 };
  const msOf = (bytes: number) => (bytes / (sampleRate * 2)) * 1000;
  const need150 = pcmBytesFor(START_BUFFER_MS, sampleRate);
  const needStart = pcmBytesFor(startBufferMs, sampleRate);
  let total = 0;
  let audio150Ms: number | null = null;
  let startAt: number | null = null;
  let startIndex = real.length - 1;
  for (let i = 0; i < real.length; i++) {
    total += real[i].bytes;
    if (audio150Ms === null && total >= need150) audio150Ms = real[i].atMs;
    if (startAt === null && total >= needStart) {
      startAt = real[i].atMs;
      startIndex = i;
    }
  }
  // A stream shorter than the buffer starts when it ends; it cannot run dry.
  if (startAt === null) return { firstAudioByteMs: real[0].atMs, audio150Ms, underruns: 0 };
  let buffered = real.slice(0, startIndex + 1).reduce((n, a) => n + a.bytes, 0);
  let scheduledUntil = startAt + msOf(buffered);
  let underruns = 0;
  for (let i = startIndex + 1; i < real.length; i++) {
    const a = real[i];
    if (a.atMs > scheduledUntil) {
      underruns++;
      scheduledUntil = a.atMs;
    }
    buffered += a.bytes;
    scheduledUntil += msOf(a.bytes);
  }
  return { firstAudioByteMs: real[0].atMs, audio150Ms, underruns };
}

/** The offset of the PCM inside a WAV file (the `data` chunk), or null if `head` does not reach it yet. */
export function wavDataOffset(head: Uint8Array): { offset: number; sampleRate: number } | null {
  if (head.byteLength < 12) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const tag = (at: number) => String.fromCharCode(...head.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let at = 12;
  let sampleRate = 0;
  while (at + 8 <= head.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt " && at + 16 <= head.byteLength) sampleRate = view.getUint32(at + 12, true);
    if (id === "data") return sampleRate ? { offset: at + 8, sampleRate } : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

// ---------------------------------------------------------------------------
// One Turn over HTTP

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type Clock = () => number;

export interface TurnMeasure {
  call: ScriptedCall["id"];
  lang: Lang;
  /** 0 is the greeting (`start`), 1.. the scripted `say` Turns. */
  index: number;
  expect: Expect;
  status: number;
  server: ServerTiming | null;
  replyMs: number | null;
  audioHeaderMs: number | null;
  firstAudioByteMs: number | null;
  audio150Ms: number | null;
  audio: "live" | "cached" | "none";
  /** Why there was no neural audio: the server's fallback, or "no_hint" when the reply carried none. */
  fallback?: string;
  underruns: number;
  startBufferMs: number;
  error?: string;
}

interface TurnBody {
  callId?: string;
  reply?: string;
  complete?: boolean;
  speech?: { kind: "live"; token: string } | { kind: "cached"; url: string };
}

interface AudioOutcome {
  audioHeaderMs: number | null;
  arrivals: PcmArrival[];
  sampleRate: number | null;
  audio: TurnMeasure["audio"];
  fallback?: string;
}

/** Reads a body to its end, timing each chunk from `t0`. */
async function readTimed(body: ReadableStream<Uint8Array> | null, clock: Clock, t0: number): Promise<{ atMs: number; bytes: Uint8Array }[]> {
  if (!body) return [];
  const reader = body.getReader();
  const out: { atMs: number; bytes: Uint8Array }[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    if (value && value.byteLength > 0) out.push({ atMs: clock() - t0, bytes: value });
  }
}

/** A cached WAV (GET /api/voice/<key>): the PCM arrivals after the header. */
async function fetchCached(url: string, deps: RunDeps, t0: number): Promise<AudioOutcome> {
  const res = await deps.fetch(new URL(url, deps.base).toString());
  const audioHeaderMs = deps.clock() - t0;
  if (!res.ok) return { audioHeaderMs, arrivals: [], sampleRate: null, audio: "none", fallback: `cached_${res.status}` };
  const chunks = await readTimed(res.body, deps.clock, t0);
  let head = new Uint8Array(0);
  let data: { offset: number; sampleRate: number } | null = null;
  const arrivals: PcmArrival[] = [];
  for (const c of chunks) {
    if (data) {
      arrivals.push({ atMs: c.atMs, bytes: c.bytes.byteLength });
      continue;
    }
    const joined = new Uint8Array(head.byteLength + c.bytes.byteLength);
    joined.set(head);
    joined.set(c.bytes, head.byteLength);
    head = joined;
    data = wavDataOffset(head);
    if (data && head.byteLength > data.offset) arrivals.push({ atMs: c.atMs, bytes: head.byteLength - data.offset });
  }
  return { audioHeaderMs, arrivals, sampleRate: data?.sampleRate ?? null, audio: "cached" };
}

/** Legacy: a live reply's audio from POST /api/speech, as the Call_Page asks for it. */
async function fetchSpeech(body: TurnBody, lang: Lang, deps: RunDeps, t0: number): Promise<AudioOutcome> {
  const speech = body.speech;
  if (!speech || !body.reply) return { audioHeaderMs: null, arrivals: [], sampleRate: null, audio: "none", fallback: "no_hint" };
  if (speech.kind === "cached") return fetchCached(speech.url, deps, t0);
  const res = await deps.fetch(new URL("/api/speech", deps.base).toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "say", shopId: deps.shopId, language: lang, text: body.reply, token: speech.token }),
  });
  const audioHeaderMs = deps.clock() - t0;
  if (res.status !== 200) {
    let fallback = `status_${res.status}`;
    try {
      const j = (await res.json()) as { fallback?: unknown };
      if (typeof j.fallback === "string") fallback = j.fallback;
    } catch {
      // A body that is not JSON keeps the status as the reason.
    }
    return { audioHeaderMs, arrivals: [], sampleRate: null, audio: "none", fallback };
  }
  const sampleRate = rateOfContentType(res.headers.get("content-type"));
  const chunks = await readTimed(res.body, deps.clock, t0);
  return { audioHeaderMs, arrivals: chunks.map((c) => ({ atMs: c.atMs, bytes: c.bytes.byteLength })), sampleRate, audio: "live" };
}

/**
 * Inline mode: decodes the Inline_Audio stream of design.md "L4" (a JSON line for the Turn, a JSON
 * line for the audio, then raw PCM), finding the two newlines in whatever chunks arrive.
 * Task 19 writes the app's own decoder (lib/voice/turnStream.ts); this one stays small and
 * script-only so the before numbers do not depend on it.
 */
async function readInline(res: Response, deps: RunDeps, t0: number): Promise<{ body: TurnBody; replyMs: number; audio: AudioOutcome }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let pending = new Uint8Array(0);
  const lines: { atMs: number; json: Record<string, unknown> }[] = [];
  const arrivals: PcmArrival[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    const atMs = deps.clock() - t0;
    if (lines.length >= 2) {
      arrivals.push({ atMs, bytes: value.byteLength });
      continue;
    }
    const joined = new Uint8Array(pending.byteLength + value.byteLength);
    joined.set(pending);
    joined.set(value, pending.byteLength);
    pending = joined;
    let nl: number;
    while (lines.length < 2 && (nl = pending.indexOf(0x0a)) >= 0) {
      lines.push({ atMs, json: JSON.parse(decoder.decode(pending.subarray(0, nl))) as Record<string, unknown> });
      pending = pending.subarray(nl + 1);
    }
    if (lines.length >= 2 && pending.byteLength > 0) {
      arrivals.push({ atMs, bytes: pending.byteLength });
      pending = new Uint8Array(0);
    }
  }
  const turn = lines[0];
  if (!turn || turn.json.kind !== "turn") throw new Error("the stream did not start with a turn line");
  const replyMs = turn.atMs;
  const head = lines[1];
  if (!head) return { body: turn.json as TurnBody, replyMs, audio: { audioHeaderMs: null, arrivals: [], sampleRate: null, audio: "none", fallback: "no_header" } };
  const h = head.json;
  if (h.audio === "pcm") {
    return {
      body: turn.json as TurnBody,
      replyMs,
      audio: { audioHeaderMs: head.atMs, arrivals, sampleRate: typeof h.sampleRate === "number" ? h.sampleRate : null, audio: "live" },
    };
  }
  if (h.audio === "cached" && typeof h.url === "string") {
    const cached = await fetchCached(h.url, deps, t0);
    return { body: turn.json as TurnBody, replyMs, audio: { ...cached, audioHeaderMs: head.atMs } };
  }
  return {
    body: turn.json as TurnBody,
    replyMs,
    audio: { audioHeaderMs: head.atMs, arrivals: [], sampleRate: null, audio: "none", fallback: typeof h.fallback === "string" ? h.fallback : "none" },
  };
}

export interface RunDeps {
  fetch: Fetch;
  clock: Clock;
  base: URL;
  shopId: string;
  mode: Mode;
  /** Waits between Turns; a no-op in tests. */
  sleep: (ms: number) => Promise<void>;
  gapMs: number;
}

/** One scripted Call: start, its `say` Turns, and a hang-up if it did not end by itself. */
export async function runCall(call: ScriptedCall, deps: RunDeps): Promise<TurnMeasure[]> {
  const out: TurnMeasure[] = [];
  const conversation: { caller: string; receptionist: string }[] = [];
  let callId: string | undefined;
  let complete = false;
  let startBufferMs = START_BUFFER_MS;
  const steps: { expect: Expect; utterance?: string }[] = [{ expect: "start" }, ...call.turns];
  let lastStart = -Infinity;

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const wait = lastStart + deps.gapMs - deps.clock();
    if (wait > 0) await deps.sleep(wait);
    lastStart = deps.clock();
    // `start` stays JSON in both modes (the greeting is a pinned cached line, design.md "L4").
    const inline = deps.mode === "inline" && step.expect !== "start";
    const payload =
      step.expect === "start"
        ? { kind: "start", shopId: deps.shopId, language: call.lang }
        : {
            kind: "say",
            shopId: deps.shopId,
            language: call.lang,
            callId,
            utterance: step.utterance,
            conversation,
            ...(inline ? { audio: "inline" } : {}),
          };
    const base: TurnMeasure = {
      call: call.id,
      lang: call.lang,
      index,
      expect: step.expect,
      status: 0,
      server: null,
      replyMs: null,
      audioHeaderMs: null,
      firstAudioByteMs: null,
      audio150Ms: null,
      audio: "none",
      underruns: 0,
      startBufferMs,
    };
    const t0 = deps.clock();
    let m: TurnMeasure = base;
    try {
      const res = await deps.fetch(new URL("/api/turn", deps.base).toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      m = { ...base, status: res.status, server: parseServerTiming(res.headers.get("server-timing")) };
      let body: TurnBody;
      let audio: AudioOutcome;
      let replyMs: number;
      const type = res.headers.get("content-type") ?? "";
      if (res.status === 200 && type.startsWith("application/x-phantom-turn")) {
        ({ body, replyMs, audio } = await readInline(res, deps, t0));
      } else {
        body = (await res.json()) as TurnBody;
        replyMs = deps.clock() - t0;
        if (res.status !== 200) {
          const hint = res.status === 400 && inline ? " (does this server take audio: \"inline\"? use --legacy for today's deploy)" : "";
          out.push({ ...m, replyMs, error: `status ${res.status}${hint}` });
          break;
        }
        audio = await fetchSpeech(body, call.lang, deps, t0);
      }
      const played = audio.sampleRate ? playback(audio.arrivals, audio.sampleRate, startBufferMs) : { firstAudioByteMs: null, audio150Ms: null, underruns: 0 };
      m = {
        ...m,
        replyMs,
        audioHeaderMs: audio.audioHeaderMs,
        ...played,
        audio: audio.audio,
        ...(audio.fallback ? { fallback: audio.fallback } : {}),
      };
      if (played.underruns > 0) startBufferMs = START_BUFFER_AFTER_UNDERRUN_MS;
      out.push(m);
      callId = body.callId ?? callId;
      complete = body.complete === true;
      if (step.utterance !== undefined) conversation.push({ caller: step.utterance, receptionist: body.reply ?? "" });
      if (complete) break;
    } catch (err) {
      out.push({ ...m, error: (err as Error)?.name ?? "Error" });
      break;
    }
  }
  if (callId && !complete) {
    try {
      await deps.fetch(new URL("/api/turn", deps.base).toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "hangup", shopId: deps.shopId, callId }),
      });
    } catch {
      // The stale sweep ends a Call nobody hung up.
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Summary

export interface StageStats {
  /** Turns that had a value for this stage. */
  n: number;
  /** Turns that had none ("n/a": no header, no audio). */
  na: number;
  p50: number | null;
  p90: number | null;
}
export interface GroupSummary {
  turns: number;
  errors: number;
  stages: Record<Stage, StageStats>;
  underruns: { total: number; perReplyP90: number | null };
}

function valueOf(m: TurnMeasure, s: Stage): number | null {
  if (s === "brain" || s === "db" || s === "model" || s === "total") return m.server?.[s] ?? null;
  return m[s];
}

export function summarize(measures: readonly TurnMeasure[]): GroupSummary {
  const stages = Object.fromEntries(
    STAGES.map((s) => {
      const values = measures.map((m) => valueOf(m, s)).filter((v): v is number => v !== null);
      return [s, { n: values.length, na: measures.length - values.length, p50: percentile(values, 50), p90: percentile(values, 90) }];
    }),
  ) as Record<Stage, StageStats>;
  const withAudio = measures.filter((m) => m.firstAudioByteMs !== null);
  return {
    turns: measures.length,
    errors: measures.filter((m) => m.error).length,
    stages,
    underruns: { total: measures.reduce((n, m) => n + m.underruns, 0), perReplyP90: percentile(withAudio.map((m) => m.underruns), 90) },
  };
}

/** Summaries for every group the targets talk about: all, each language, and start / sure / model. */
export function summarizeGroups(measures: readonly TurnMeasure[]): Record<string, GroupSummary> {
  const groups: Record<string, TurnMeasure[]> = { all: [...measures] };
  for (const m of measures) {
    (groups[m.lang] ??= []).push(m);
    (groups[m.expect] ??= []).push(m);
  }
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, summarize(v)]));
}

const cell = (v: number | null) => (v === null ? "n/a" : `${Math.round(v)}`);

/** The printed table: one row per stage, p50 / p90 in ms, "n/a" where there was no value. */
export function formatSummary(groups: Record<string, GroupSummary>): string {
  const names = Object.keys(groups);
  const rows = [["stage", ...names.map((n) => `${n} p50/p90 (n)`)]];
  for (const s of STAGES) {
    rows.push([s, ...names.map((n) => {
      const st = groups[n].stages[s];
      return st.n === 0 ? "n/a" : `${cell(st.p50)}/${cell(st.p90)} (${st.n})`;
    })]);
  }
  rows.push(["underruns", ...names.map((n) => `${groups[n].underruns.total} total, p90 ${cell(groups[n].underruns.perReplyP90)}`)]);
  rows.push(["errors", ...names.map((n) => `${groups[n].errors} of ${groups[n].turns}`)]);
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join("  ")).join("\n");
}

/** `.measurements/latency/<date>-<before|after>.json`, with `-2`, `-3`… when that name is taken. */
export function outputName(date: string, mode: Mode, taken: (name: string) => boolean): string {
  const stem = `${date}-${mode === "legacy" ? "before" : "after"}`;
  if (!taken(`${stem}.json`)) return `${stem}.json`;
  for (let k = 2; ; k++) if (!taken(`${stem}-${k}.json`)) return `${stem}-${k}.json`;
}

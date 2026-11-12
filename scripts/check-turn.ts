// Sends real caller lines through the same path as a `say` Turn of handleTurn:
// the real system instruction and input (lib/receptionist/prompt.ts), the real JSON
// Schema, the real Gemini client, then the pure decideTurn on the validated ModelTurn.
// It never touches the database: the shop is the seed profile, the Call is a fresh
// one, and the agenda is empty.
//
// Run with:
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/check-turn.ts [options] ["es|línea" ...]
// Each argument is "<lang>|<caller line>" (lang es or en). Without arguments it sends
// the three lines of the first end-to-end bugfix.
//
// Modes:
//   (default)          each line once, as the first `say` of a fresh Call, through
//                      callReceptionist (per-attempt deadline, model list), printed in full.
//   --repeat=N         measurement: each line N times per model, one raw model call per
//                      request (no retry, no fallback model), so every hang and every 5xx is
//                      seen as it happens. Prints, per model, ok / timeout / 5xx / 429 /
//                      error / invalid_output, latency percentiles, and what decideTurn did
//                      with each ok answer (for example how many runs offered 19:30).
//   --conversation     the whole booking conversation (CONVERSATION below) through the
//                      production path (callReceptionist with the model list and the
//                      per-attempt deadline, then decideTurn with the state carried from
//                      Turn to Turn), --repeat times. Reports which runs reached a
//                      confirmed booking decision and where the others stopped.
//
// Options:
//   --model=<id[,id…]>  model list (default: GEMINI_MODEL, else the built-in list).
//                       In --repeat mode every model in the list is measured on its own.
//   --now=<ISO instant> the clock (default: now).
//   --gap=<ms>          least time between the starts of two requests (default 5000), so the
//                       measurement does not hit the free tier's per-minute limit itself.
//   --cap=<ms>          --repeat mode: how long one raw call may take before it counts as a
//                       timeout (default 15000, well past the 8 s budget, to see the tail).
//
// `--conditions=react-server` lets `import "server-only"` in geminiClient.ts load, as it
// does inside Next.js. Node loads .env.local itself; this script never prints process.env
// or the key, and every printed line goes through redact(). The caller's name and phone
// are shown only as their length.

import { Temporal } from "temporal-polyfill";
import { decideTurn, type Decision } from "@/lib/conversation/decide";
import { initialCallState, type CallState, type Lang, type Line, type ModelClient } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import {
  callReceptionist,
  inspectModelTurn,
  MODEL_TIMEOUT_MS,
  type ModelFailureInfo,
  type ModelSuccessInfo,
} from "@/lib/receptionist/callModel";
import { createGeminiClient, parseModelList } from "@/lib/receptionist/geminiClient";
import { phrases } from "@/lib/receptionist/phrases";
import { buildInput, buildSystemInstruction } from "@/lib/receptionist/prompt";
import { modelTurnJsonSchema, type ModelTurn } from "@/lib/receptionist/schema";
import { toSpokenReply } from "@/lib/receptionist/speech";
import { getSectorPack } from "@/lib/sectors";

const DEFAULT_LINES: [Lang, string][] = [
  ["es", "Quiero cortarme el pelo mañana a las nueve de la noche"],
  ["en", "I'd like a haircut on Saturday at 11"],
  ["es", "¿Cuánto cuesta el tinte?"],
];
/** The booking conversation of the 2026-11-12 bugfix (after `start`, which needs no model call). */
const CONVERSATION: string[] = [
  "Quiero cortarme el pelo mañana a las nueve de la noche",
  "Vale, a las siete y media",
  "Me llamo Ana Prueba",
  "Mi teléfono es 612 345 678",
  "Sí, correcto",
];
const PERSONAL = new Set(["name", "phone"]);

const apiKey = process.env.GEMINI_API_KEY ?? "";
const redact = (text: string) => (apiKey ? text.split(apiKey).join("***") : text);
const print = (value: unknown) => console.log(redact(JSON.stringify(value, null, 2)));
const say = (text: string) => console.log(redact(text));

/** The model's JSON with name and phone replaced by their length. */
function withoutPersonalData(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, PERSONAL.has(k) && typeof v === "string" ? `<${v.length} chars>` : v]),
  );
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function intArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
}

const shop = lolaSeedProfile;
const pack = getSectorPack(shop.sectorPackId);

/** Spaces requests so that two starts are at least `gapMs` apart. */
function pacer(gapMs: number): () => Promise<void> {
  let last = 0;
  return async () => {
    const wait = last + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  };
}

/** Nearest-rank percentile of sorted values. */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** What decideTurn did with a valid ModelTurn, in one word. */
function decisionKind(d: Decision, turn: ModelTurn): string {
  if (d.effects.some((e) => e.type === "createBooking")) return "booked";
  if (d.complete) return `ended:${d.outcome ?? "?"}`;
  if (d.state.lastOffer?.length) return "offer";
  if (d.state.stage === "awaiting_confirmation") return "read_back";
  return toSpokenReply(d.reply) === toSpokenReply(turn.reply) ? "model_text" : "code_text";
}

function decide(state: CallState, turn: ModelTurn, now: Temporal.Instant): Decision {
  return decideTurn({ state, turn, shop, pack, now, existing: [], callerBookings: [], maxTurns: 20 });
}

// ---------------------------------------------------------------------------
// Default mode: each line once through the production path.

async function single(lines: [Lang, string][], models: string[], now: Temporal.Instant): Promise<void> {
  const gemini = createGeminiClient({ apiKey, model: models.join(",") });
  for (const [lang, utterance] of lines) {
    // Exactly what handleTurn does for the first `say` of a fresh Call: the browser has sent
    // no completed Turns yet, so the conversation is empty.
    const state = { ...initialCallState(lang), language: lang };
    let raw = "";
    const recording: ModelClient = {
      modelFor: gemini.modelFor,
      async generate(req) {
        raw = await gemini.generate(req);
        return raw;
      },
    };
    let failure: ModelFailureInfo | undefined;
    let success: ModelSuccessInfo | undefined;
    const t0 = Date.now();
    const result = await callReceptionist(
      recording,
      {
        systemInstruction: buildSystemInstruction(shop, pack, state.language, now),
        input: buildInput(state, [], utterance, shop),
      },
      { timeoutMs: MODEL_TIMEOUT_MS, onFailure: (info) => (failure = info), onSuccess: (info) => (success = info) },
    );
    const latencyMs = Date.now() - t0;

    say(`\n=== [${lang}] ${utterance}`);
    if (!result.ok) {
      print({ outcome: result.failure, latencyMs, failure });
      if (raw) {
        let json: unknown = null;
        try {
          json = JSON.parse(raw);
        } catch {
          // The failure above already says it is not JSON.
        }
        print({ rawLength: raw.length, rawJson: withoutPersonalData(json) });
      }
      continue;
    }
    const decision = decide(state, result.turn, now);
    print({
      outcome: "ok",
      latencyMs,
      attempts: success?.attempts,
      model: success?.model,
      earlier: success?.earlier,
      modelTurn: withoutPersonalData(result.turn),
      decision: {
        kind: decisionKind(decision, result.turn),
        reply: toSpokenReply(decision.reply),
        stage: decision.state.stage,
        complete: decision.complete,
        lastOffer: decision.state.lastOffer ?? [],
        effects: decision.effects.map((e) => e.type),
      },
    });
    if (!inspectModelTurn(raw).ok) say("unexpected: the raw text no longer validates");
  }
}

// ---------------------------------------------------------------------------
// --repeat=N: raw single calls per model.

type RawOutcome = "ok" | "timeout" | "5xx" | "429" | "error" | "invalid_output";
interface RawStats {
  counts: Record<RawOutcome, number>;
  okLatency: number[];
  failLatency: number[];
  /** Per line: what decideTurn made of each ok answer, and how often time / date came back null. */
  lines: Map<string, { kinds: Map<string, number>; timeNull: number; dateNull: number; replies: Map<string, number> }>;
}

async function rawCall(
  client: ModelClient,
  systemInstruction: string,
  input: string,
  capMs: number,
): Promise<{ outcome: RawOutcome; latencyMs: number; text?: string; status?: number; invalid?: string }> {
  const controller = new AbortController();
  const t0 = Date.now();
  // The abort alone is not enough: on 2026-11-12 one request ignored it and answered after
  // 38 s. The race makes the cap hold, as callReceptionist's race does in production.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("cap"));
    }, capMs);
  });
  try {
    const pending = client.generate({
      systemInstruction,
      input,
      jsonSchema: modelTurnJsonSchema,
      signal: controller.signal,
    });
    pending.catch(() => {});
    const text = await Promise.race([pending, capped]);
    const parsed = inspectModelTurn(text);
    if (parsed.ok) return { outcome: "ok", latencyMs: Date.now() - t0, text };
    const why =
      parsed.invalid.kind === "schema"
        ? `schema ${parsed.invalid.issues.map((i) => `${i.path}:${i.code}`).join(",")}`
        : parsed.invalid.kind === "json"
          ? `json length ${parsed.invalid.length}`
          : "empty";
    return { outcome: "invalid_output", latencyMs: Date.now() - t0, text, invalid: why };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    if (controller.signal.aborted) return { outcome: "timeout", latencyMs };
    const status = (err as { status?: unknown })?.status;
    if (status === 429) return { outcome: "429", latencyMs, status };
    if (typeof status === "number" && status >= 500) return { outcome: "5xx", latencyMs, status };
    return { outcome: "error", latencyMs, ...(typeof status === "number" ? { status } : {}) };
  } finally {
    clearTimeout(timer);
  }
}

async function repeat(
  lines: [Lang, string][],
  models: string[],
  now: Temporal.Instant,
  n: number,
  gapMs: number,
  capMs: number,
): Promise<void> {
  const clients = new Map(models.map((m) => [m, createGeminiClient({ apiKey, model: m })]));
  const stats = new Map<string, RawStats>(
    models.map((m) => [
      m,
      { counts: { ok: 0, timeout: 0, "5xx": 0, "429": 0, error: 0, invalid_output: 0 }, okLatency: [], failLatency: [], lines: new Map() },
    ]),
  );
  const pace = pacer(gapMs);
  const total = n * lines.length * models.length;
  say(`repeat ${n} × ${lines.length} line(s) × ${models.length} model(s) = ${total} calls, gap ${gapMs} ms, cap ${capMs} ms`);
  let k = 0;
  // Round-robin over models inside each repetition, so each model's per-minute quota sees
  // one request every (gap × models) ms.
  for (let r = 0; r < n; r++) {
    for (const [lang, utterance] of lines) {
      const state = { ...initialCallState(lang), language: lang };
      const sys = buildSystemInstruction(shop, pack, lang, now);
      const input = buildInput(state, [], utterance, shop);
      for (const m of models) {
        await pace();
        const res = await rawCall(clients.get(m)!, sys, input, capMs);
        const s = stats.get(m)!;
        s.counts[res.outcome]++;
        (res.outcome === "ok" ? s.okLatency : s.failLatency).push(res.latencyMs);
        let line = s.lines.get(utterance);
        if (!line) s.lines.set(utterance, (line = { kinds: new Map(), timeNull: 0, dateNull: 0, replies: new Map() }));
        let kind = res.outcome as string;
        if (res.outcome === "ok" && res.text) {
          const turn = inspectModelTurn(res.text);
          if (turn.ok) {
            const d = decide(state, turn.turn, now);
            kind = decisionKind(d, turn.turn);
            if (turn.turn.time === null) line.timeNull++;
            if (turn.turn.date === null) line.dateNull++;
            const reply = toSpokenReply(d.reply);
            line.replies.set(reply, (line.replies.get(reply) ?? 0) + 1);
            line.kinds.set(kind, (line.kinds.get(kind) ?? 0) + 1);
          }
        }
        k++;
        say(`[${k}/${total}] ${m} ${res.outcome}${res.status ? ` ${res.status}` : ""}${res.invalid ? ` (${res.invalid})` : ""} ${res.latencyMs} ms ${kind !== res.outcome ? kind : ""}`);
      }
    }
  }

  say("\n=== summary per model (raw single calls, no retry)");
  for (const [m, s] of stats) {
    const ok = [...s.okLatency].sort((a, b) => a - b);
    const within = (ms: number) => ok.filter((x) => x <= ms).length;
    print({
      model: m,
      calls: Object.values(s.counts).reduce((a, b) => a + b, 0),
      ...s.counts,
      okLatencyMs: { p50: percentile(ok, 50), p90: percentile(ok, 90), p95: percentile(ok, 95), max: ok.at(-1) ?? null },
      okWithinMs: { 1500: within(1500), 2000: within(2000), 2500: within(2500), 3000: within(3000), 4000: within(4000), 8000: within(8000) },
      failLatencyMs: [...s.failLatency].sort((a, b) => a - b),
      lines: Object.fromEntries(
        [...s.lines].map(([utt, l]) => [
          utt,
          { decisions: Object.fromEntries(l.kinds), timeNull: l.timeNull, dateNull: l.dateNull, replies: Object.fromEntries(l.replies) },
        ]),
      ),
    });
  }
}

// ---------------------------------------------------------------------------
// --conversation: the whole booking call, production path, state carried.

async function conversation(models: string[], now: Temporal.Instant, runs: number, gapMs: number): Promise<void> {
  const gemini = createGeminiClient({ apiKey, model: models.join(",") });
  // Turns are spaced before callReceptionist starts its clock; retries inside a Turn are not delayed.
  const pace = pacer(gapMs);
  const paced: ModelClient = gemini;
  const results: { run: number; reached: boolean; stoppedAt?: string }[] = [];
  say(`conversation × ${runs}, models ${models.join(", ")}, gap ${gapMs} ms`);
  for (let run = 1; run <= runs; run++) {
    say(`\n=== run ${run}`);
    let state: CallState = initialCallState("es");
    const lines: Line[] = [];
    let reached = false;
    let stoppedAt: string | undefined;
    for (let i = 0; i < CONVERSATION.length; i++) {
      const utterance = CONVERSATION[i];
      let failure: ModelFailureInfo | undefined;
      let success: ModelSuccessInfo | undefined;
      await pace();
      const t0 = Date.now();
      const result = await callReceptionist(
        paced,
        { systemInstruction: buildSystemInstruction(shop, pack, "es", now), input: buildInput(state, lines, utterance, shop) },
        { timeoutMs: MODEL_TIMEOUT_MS, onFailure: (info) => (failure = info), onSuccess: (info) => (success = info) },
      );
      const ms = Date.now() - t0;
      if (!result.ok) {
        const tries = (failure?.earlier ?? []).map((e) => `${e.model ?? "?"}:${e.outcome}@${e.latencyMs}`).join(" ");
        say(`  ${i + 1}. "${utterance}" -> FALLBACK ${result.failure} after ${ms} ms, attempts ${failure?.attempts ?? "?"}${tries ? ` (${tries})` : ""}`);
        if (failure?.message) say(`     last error: ${failure.model ?? "?"} ${failure.status ?? ""} ${failure.errorClass ?? ""}: ${failure.message}`);
        if (result.failure === "invalid_output" && state.consecutiveInvalid + 1 < 2) {
          // handleTurn's retry path: the caller hears the retry line and says the same thing again.
          const retry = toSpokenReply(phrases("es", pack, shop).fallbackRetry());
          lines.push({ caller: utterance, receptionist: retry });
          state = { ...state, consecutiveInvalid: state.consecutiveInvalid + 1, turnCount: state.turnCount + 1 };
          i--;
          continue;
        }
        stoppedAt = `turn ${i + 1} (${utterance}): fallback ${result.failure}`;
        break;
      }
      const d = decide(state, result.turn, now);
      const reply = toSpokenReply(d.reply);
      const kind = decisionKind(d, result.turn);
      const tries = (success?.earlier ?? []).map((e) => `${e.model ?? "?"}:${e.outcome}@${e.latencyMs}`).join(" ");
      say(`  ${i + 1}. "${utterance}" -> [${kind}] ${success?.model ?? "?"} ×${success?.attempts ?? "?"} ${ms} ms${tries ? ` (${tries})` : ""}: ${reply}`);
      lines.push({ caller: utterance, receptionist: reply });
      state = d.state;
      if (kind === "booked") {
        reached = true;
        break;
      }
      if (d.complete) {
        stoppedAt = `turn ${i + 1} (${utterance}): ended ${d.outcome}`;
        break;
      }
    }
    if (!reached && !stoppedAt) stoppedAt = `after the last line, stage ${state.stage}: ${lines.at(-1)?.receptionist ?? ""}`;
    results.push({ run, reached, ...(stoppedAt ? { stoppedAt } : {}) });
  }
  say("\n=== summary");
  print({ runs, reachedConfirmedBooking: results.filter((r) => r.reached).length, results });
}

async function main(): Promise<void> {
  if (!apiKey) {
    say("GEMINI_API_KEY is not set");
    process.exitCode = 1;
    return;
  }
  const models = parseModelList(arg("model") || process.env.GEMINI_MODEL);
  const now = arg("now") ? Temporal.Instant.from(arg("now")!) : Temporal.Now.instant();
  const lines = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"))
    .map((a): [Lang, string] => {
      const [lang, ...rest] = a.split("|");
      if (lang !== "es" && lang !== "en") throw new Error(`argument must start with "es|" or "en|": ${a}`);
      return [lang, rest.join("|")];
    });
  const gapMs = intArg("gap", 5000);
  say(`models ${models.join(", ")}, now ${now.toZonedDateTimeISO(shop.timeZone).toString({ timeZoneName: "never" })} ${shop.timeZone}`);

  if (flag("conversation")) return conversation(models, now, intArg("repeat", 1) || 1, gapMs);
  const n = intArg("repeat", 0);
  if (n > 0) return repeat(lines.length ? lines : DEFAULT_LINES, models, now, n, gapMs, intArg("cap", 15000));
  return single(lines.length ? lines : DEFAULT_LINES, models, now);
}

main().catch((err: unknown) => {
  const e = err as { constructor?: { name?: string }; message?: string } | undefined;
  say(`check-turn failed: ${e?.constructor?.name ?? "Error"} ${e?.message ?? ""}`);
  process.exitCode = 1;
});

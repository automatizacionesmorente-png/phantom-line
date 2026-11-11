// Verification spike for task 1 of .kiro/specs/core-call-loop/tasks.md.
//
// Run with:  node --env-file=.env.local scripts/check-gemini.mjs [check ...] [--timeout=ms]
// Checks:    list | free-tier | generate | abort | nullable   (default: free-tier abort nullable)
// The model comes from GEMINI_MODEL, or from --model=<id> to try another one.
//
// Node loads .env.local itself; this script never prints process.env or the key.
// Every error message goes through redact() before it is printed.
// Plain JavaScript (.mjs), because the machine's default Node 20.19 cannot run
// TypeScript files directly.

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

// The spike started from gemini-3.8-flash; it never answered with this key, so the
// default is the model the spike found working (see design.md, "Verification spike findings").
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const modelArg = process.argv.find((a) => a.startsWith("--model="));
const model = modelArg?.slice(8) || process.env.GEMINI_MODEL || DEFAULT_MODEL;
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.log(JSON.stringify({ outcome: "missing GEMINI_API_KEY" }));
  process.exit(1);
}

function redact(text) {
  return String(text).split(apiKey).join("***");
}

function errorInfo(err) {
  const e = /** @type {any} */ (err);
  return {
    errorClass: e?.constructor?.name ?? typeof e,
    errorName: e?.name,
    status: e?.status ?? e?.statusCode ?? null,
    message: redact(e?.message ?? "").slice(0, 300),
  };
}

function report(fields) {
  console.log(redact(JSON.stringify(fields)));
}

const ai = new GoogleGenAI({ apiKey });

// No SDK retries, so a 429 or 5xx shows up at once instead of being retried with backoff,
// and a 20 s ceiling so the spike never hangs.
const timeoutArg = process.argv.find((a) => a.startsWith("--timeout="));
const BASE_OPTIONS = { retries: { strategy: "none" }, timeout_ms: Number(timeoutArg?.slice(10)) || 20000 };

// Copied from design.md, "Model contract".
const Nullable = (t) => t.nullable();
const ModelTurnSchema = z.strictObject({
  reply: z.string().min(1).max(400),
  language: z.enum(["es", "en"]),
  wantsLanguage: Nullable(z.enum(["es", "en"])),
  intent: z.enum(["booking", "reschedule", "cancel", "question", "order", "other"]),
  name: Nullable(z.string().min(1).max(80)),
  phone: Nullable(z.string().min(6).max(32)),
  service: Nullable(z.string().min(1).max(80)),
  date: Nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  time: Nullable(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)),
  callerConfirmed: z.boolean(),
  callerWantsToEnd: z.boolean(),
  outOfProfile: z.boolean(),
  reason: z.string().min(1).max(160),
  urgency: z.enum(["low", "normal", "urgent"]),
});

async function timed(fn) {
  const t0 = performance.now();
  try {
    const value = await fn();
    return { ok: true, value, latencyMs: Math.round(performance.now() - t0) };
  } catch (err) {
    return { ok: false, err, latencyMs: Math.round(performance.now() - t0) };
  }
}

async function checkList() {
  const r = await timed(async () => {
    const names = [];
    const pager = await ai.models.list();
    for await (const m of pager) {
      if (/flash/i.test(m.name ?? "")) names.push(m.name);
    }
    return names;
  });
  if (r.ok) report({ check: "list", outcome: "ok", flashModels: r.value, latencyMs: r.latencyMs });
  else report({ check: "list", outcome: "error", ...errorInfo(r.err), latencyMs: r.latencyMs });
}

async function checkFreeTier() {
  const r = await timed(() =>
    ai.interactions.create({ model, input: "Reply with the single word OK.", store: false }, BASE_OPTIONS),
  );
  if (r.ok) {
    report({
      check: "free-tier",
      model,
      outcome: "ok",
      status: 200,
      latencyMs: r.latencyMs,
      outputText: (r.value.output_text ?? "").slice(0, 40),
    });
  } else {
    report({ check: "free-tier", model, outcome: "error", ...errorInfo(r.err), latencyMs: r.latencyMs });
  }
}

async function checkAbort() {
  const variants = {
    "signal: AbortSignal.timeout(50)": () => ({ retries: { strategy: "none" }, signal: AbortSignal.timeout(50) }),
    "fetch_options.signal: AbortSignal.timeout(50)": () => ({
      retries: { strategy: "none" },
      fetch_options: { signal: AbortSignal.timeout(50) },
    }),
    "timeout_ms: 50": () => ({ retries: { strategy: "none" }, timeout_ms: 50 }),
    "signal: AbortController.abort() after 50 ms": () => {
      const c = new AbortController();
      setTimeout(() => c.abort(), 50);
      return { retries: { strategy: "none" }, signal: c.signal };
    },
  };
  for (const [label, makeOptions] of Object.entries(variants)) {
    const r = await timed(() =>
      ai.interactions.create(
        { model, input: "Write a 300-word story about a telephone.", store: false },
        makeOptions(),
      ),
    );
    if (r.ok) report({ check: "abort", variant: label, model, outcome: "resolved (not aborted)", latencyMs: r.latencyMs });
    else report({ check: "abort", variant: label, model, outcome: "rejected", ...errorInfo(r.err), latencyMs: r.latencyMs });
  }
}

function toTypeUnions(schema) {
  // Rewrites { anyOf: [{ type: T, ...rest }, { type: "null" }] } into { type: [T, "null"], ...rest }.
  if (Array.isArray(schema)) return schema.map(toTypeUnions);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) out[k] = toTypeUnions(v);
  const any = out.anyOf;
  if (Array.isArray(any) && any.length === 2 && any[1]?.type === "null" && typeof any[0]?.type === "string") {
    const { anyOf: _drop, ...rest } = out;
    void _drop;
    return { ...rest, ...any[0], type: [any[0].type, "null"] };
  }
  return out;
}

async function checkNullable() {
  const zodSchema = z.toJSONSchema(ModelTurnSchema);
  const { $schema: _s, ...anyOfForm } = zodSchema;
  void _s;
  const forms = {
    "zod default (anyOf with null)": zodSchema,
    "zod default without $schema": anyOfForm,
    "type unions [T, null]": toTypeUnions(anyOfForm),
  };
  const system_instruction =
    "You are the answering machine of Peluquería Lola. Reply in Spanish in one short sentence. " +
    "Return only the fields you actually heard; every other nullable field must be null.";
  for (const [label, schema] of Object.entries(forms)) {
    const r = await timed(() =>
      ai.interactions.create({
        model,
        system_instruction,
        input: "Hola, buenas.",
        store: false,
        response_format: { type: "text", mime_type: "application/json", schema },
        generation_config: { thinking_level: "low", max_output_tokens: 400 },
      }, BASE_OPTIONS),
    );
    if (!r.ok) {
      report({ check: "nullable", form: label, model, outcome: "api rejected", ...errorInfo(r.err), latencyMs: r.latencyMs });
      continue;
    }
    const text = r.value.output_text ?? "";
    let parsed;
    try {
      parsed = ModelTurnSchema.safeParse(JSON.parse(text));
    } catch {
      report({ check: "nullable", form: label, model, outcome: "api ok, output not JSON", latencyMs: r.latencyMs });
      continue;
    }
    const nullFields = parsed.success ? Object.keys(parsed.data).filter((k) => parsed.data[k] === null) : [];
    report({
      check: "nullable",
      form: label,
      model,
      outcome: parsed.success ? "api ok, zod ok" : "api ok, zod failed",
      zodIssues: parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`),
      nullFields,
      latencyMs: r.latencyMs,
    });
  }
}

async function checkGenerate() {
  // Comparison with the legacy generateContent endpoint, same model.
  const r = await timed(() =>
    ai.models.generateContent({
      model,
      contents: "Reply with the single word OK.",
      config: { abortSignal: AbortSignal.timeout(BASE_OPTIONS.timeout_ms) },
    }),
  );
  if (r.ok) report({ check: "generate", model, outcome: "ok", status: 200, latencyMs: r.latencyMs, outputText: (r.value.text ?? "").slice(0, 40) });
  else report({ check: "generate", model, outcome: "error", ...errorInfo(r.err), latencyMs: r.latencyMs });
}

const checks = { list: checkList, "free-tier": checkFreeTier, generate: checkGenerate, abort: checkAbort, nullable: checkNullable };
const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
for (const name of requested.length ? requested : ["free-tier", "abort", "nullable"]) {
  const fn = checks[name];
  if (!fn) {
    report({ outcome: `unknown check ${name}` });
    continue;
  }
  await fn();
}

// The Latency_Script (front-desk-brain Requirement 22.2, design.md "L6: measuring").
//
// Drives scripted Calls (the regression call Real_Call_2026_11_16, an FAQ, a price question and a
// free question for the model) against a running Phantom Line, through the same HTTP contract as
// the Call_Page, and prints p50 and p90 per stage: Server-Timing (brain, db, model, total), time to
// the reply text, to the audio header, to the first audio byte and to 150 ms of audio, plus
// underruns per reply. It keeps durations only, never words.
//
// Run with:
//   node --import tsx scripts/measure-latency.ts [options]
// It needs no secret: it is a plain HTTP client of the app. The app it talks to writes Calls,
// Messages and a booking to its own database and spends its model and TTS quota.
//
// Options:
//   --base=<url>      the app (default http://localhost:3000). Anything not on localhost is refused
//                     unless --allow-remote is given.
//   --allow-remote    allow a remote base (the deployed demo: an owner step, never Kiro's).
//   --turns=<n>       at least n `say` Turns per language; the scripted Calls repeat to reach it
//                     (default one pass: 8 per language).
//   --lang=es|en|both (default both).
//   --legacy          today's deploy: JSON replies, then POST /api/speech for the audio. Output is
//                     labelled "before". Without it the script asks for the Inline_Audio stream
//                     (`audio: "inline"`, Requirement 20) and labels its output "after".
//   --gap=<ms>        least time between two Turn starts (default 6000, under the 12 a minute limit).
//   --shop=<id>       the shop (default the demo shop, peluqueria-lola).
//
// Output: the plan before any request, the table at the end, and every Turn's durations in
// .measurements/latency/<date>-<before|after>.json.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  callsFor,
  describePlan,
  formatSummary,
  outputName,
  parseOptions,
  plan,
  runCall,
  summarizeGroups,
  type TurnMeasure,
} from "./lib/latency";

async function main(): Promise<void> {
  let opts;
  try {
    opts = parseOptions(process.argv.slice(2));
  } catch (err) {
    console.error(`measure-latency: ${(err as Error).message}`);
    process.exitCode = 2;
    return;
  }
  const p = plan(opts);
  console.log(describePlan(p, opts));

  const startedAt = new Date();
  const clock = () => performance.now();
  const measures: TurnMeasure[] = [];
  for (const lang of opts.langs) {
    for (const call of callsFor(lang, opts.turns)) {
      const turns = await runCall(call, {
        fetch: (input, init) => fetch(input, init),
        clock,
        base: opts.base,
        shopId: opts.shopId,
        mode: opts.mode,
        gapMs: opts.gapMs,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      });
      for (const t of turns) {
        console.log(
          `[${t.lang}] ${t.call} #${t.index} ${t.expect}: status ${t.status}, reply ${fmt(t.replyMs)} ms, first audio ${fmt(t.firstAudioByteMs)} ms, 150 ms audio ${fmt(t.audio150Ms)} ms, server total ${fmt(t.server?.total ?? null)} ms, ${t.audio}${t.fallback ? ` (${t.fallback})` : ""}${t.underruns ? `, ${t.underruns} underrun(s)` : ""}${t.error ? `, ERROR ${t.error}` : ""}`,
        );
      }
      measures.push(...turns);
    }
  }

  const groups = summarizeGroups(measures);
  console.log(`\n${formatSummary(groups)}`);

  const dir = path.join(process.cwd(), ".measurements", "latency");
  mkdirSync(dir, { recursive: true });
  const date = startedAt.toISOString().slice(0, 10);
  const file = path.join(dir, outputName(date, opts.mode, (name) => existsSync(path.join(dir, name))));
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        label: opts.mode === "legacy" ? "before" : "after",
        mode: opts.mode,
        base: opts.base.origin,
        langs: opts.langs,
        startedAt: startedAt.toISOString(),
        plan: p,
        summary: groups,
        turns: measures,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nwritten ${path.relative(process.cwd(), file)}`);
  if (measures.some((m) => m.error)) process.exitCode = 1;
}

const fmt = (v: number | null) => (v === null ? "n/a" : String(Math.round(v)));

main().catch((err: unknown) => {
  console.error(`measure-latency failed: ${(err as Error)?.name ?? "Error"} ${(err as Error)?.message ?? ""}`);
  process.exitCode = 1;
});

#!/usr/bin/env node
// PostToolUse hook: after Kiro writes a file under lib/booking/, run the booking property tests at once,
// so a broken rule is caught on the write that broke it, not at the end of the task. Output goes back to the agent.
import { spawnSync } from "node:child_process";
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let paths = [];
  try {
    const walk = (v, k) => {
      if (typeof v === "string" && /path|file/i.test(k ?? "")) paths.push(v);
      else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
    };
    walk(JSON.parse(raw).tool_input);
  } catch {}
  if (!paths.some((p) => /(^|\/)lib\/booking\//.test(p))) process.exit(0);
  const r = spawnSync("npx", ["vitest", "run", "tests/booking", "--maxWorkers=2", "--reporter=dot"], { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").slice(-25).join("\n");
  if (r.status === 0) {
    process.stdout.write(`booking properties after your write: green\n${out.split("\n").slice(-6).join("\n")}\n`);
    process.exit(0);
  }
  process.stderr.write(`booking properties FAILED after your write to lib/booking. Fix the code, never the property:\n${out}\n`);
  process.exit(1);
});

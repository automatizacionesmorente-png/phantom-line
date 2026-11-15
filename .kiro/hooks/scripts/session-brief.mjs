#!/usr/bin/env node
// SessionStart hook: gives every headless Kiro session the same starting brief (uncommitted files and the
// next open task of each spec), so a session that resumes after a network cut does not redo finished work.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
const sh = (c) => { try { return execSync(c, { encoding: "utf8" }).trim(); } catch { return ""; } };
const lines = ["Session brief (hook):", `uncommitted: ${sh("git status --short | wc -l").trim()} files`];
for (const spec of readdirSync(".kiro/specs", { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const p = `.kiro/specs/${spec.name}/tasks.md`;
  if (!existsSync(p)) continue;
  const t = readFileSync(p, "utf8");
  const done = (t.match(/^- \[x\] \d+\./gm) ?? []).length;
  const all = (t.match(/^- \[[ x]\] \d+\./gm) ?? []).length;
  const next = t.match(/^- \[ \] (\d+\.[^\n]{0,80})/m)?.[1] ?? "none";
  lines.push(`${spec.name}: ${done}/${all} tasks, next: ${next}`);
}
process.stdout.write(lines.join("\n") + "\n");

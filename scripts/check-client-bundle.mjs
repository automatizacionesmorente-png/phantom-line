// Requirement 8.4 (core-call-loop) and natural-voice 1.2 / task 8.6: the client bundle never
// contains the Gemini key's name, the Gemini SDK, the speech-token secret's name, or the TTS
// client (`ttsClient`, and `speech_metadata`, a string only the TTS request body uses, which
// survives minification). Runs after `next build` (npm "postbuild") over every file the
// browser can download (.next/static). Exits 1 if any string is found.
// It never reads .env files or prints any environment value.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", ".next", "static");
const FORBIDDEN = ["GEMINI_API_KEY", "@google/genai", "SPEECH_TOKEN_SECRET", "ttsClient", "speech_metadata"];

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(p);
    else yield p;
  }
}

let scanned = 0;
const hits = [];
try {
  for await (const file of files(ROOT)) {
    scanned++;
    const text = await readFile(file, "utf8");
    for (const needle of FORBIDDEN) if (text.includes(needle)) hits.push(`${path.relative(ROOT, file)}: ${needle}`);
  }
} catch (err) {
  console.error(`check-client-bundle: cannot read ${ROOT} (${err.code ?? err.name}). Run next build first.`);
  process.exit(1);
}

if (scanned === 0) {
  console.error("check-client-bundle: .next/static is empty; nothing was checked.");
  process.exit(1);
}
if (hits.length > 0) {
  console.error(`check-client-bundle: FAILED, forbidden strings in the client bundle:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-client-bundle: OK, ${scanned} files in .next/static, none contains ${FORBIDDEN.join(", ")}.`);

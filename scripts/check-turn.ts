// Sends real caller lines through the same path as one `say` Turn of handleTurn:
// the real system instruction and input (lib/receptionist/prompt.ts), the real JSON
// Schema, the real createGeminiClient and callReceptionist with the 8 s budget, then
// the pure decideTurn on the validated ModelTurn. It never touches the database:
// the shop is the seed profile, the Call is a fresh one, and the agenda is empty.
//
// Run with:
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/check-turn.ts ["es|línea" ...]
// Each argument is "<lang>|<caller line>" (lang es or en). Without arguments it sends
// the three lines of the end-to-end bugfix. Options: --model=<id>, --now=<ISO instant>.
//
// `--conditions=react-server` lets `import "server-only"` in geminiClient.ts load, as it
// does inside Next.js. Node loads .env.local itself; this script never prints process.env
// or the key, and every printed line goes through redact(). The caller's name and phone
// are shown only as their length.

import { Temporal } from "temporal-polyfill";
import { decideTurn } from "@/lib/conversation/decide";
import { initialCallState, type Lang, type ModelClient } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import { callReceptionist, inspectModelTurn, MODEL_TIMEOUT_MS, type ModelFailureInfo } from "@/lib/receptionist/callModel";
import { createGeminiClient, DEFAULT_GEMINI_MODEL } from "@/lib/receptionist/geminiClient";
import { buildInput, buildSystemInstruction } from "@/lib/receptionist/prompt";
import { toSpokenReply } from "@/lib/receptionist/speech";
import { getSectorPack } from "@/lib/sectors";

const DEFAULT_LINES: [Lang, string][] = [
  ["es", "Quiero cortarme el pelo mañana a las nueve de la noche"],
  ["en", "I'd like a haircut on Saturday at 11"],
  ["es", "¿Cuánto cuesta el tinte?"],
];
const PERSONAL = new Set(["name", "phone"]);

const apiKey = process.env.GEMINI_API_KEY ?? "";
const redact = (text: string) => (apiKey ? text.split(apiKey).join("***") : text);
const print = (value: unknown) => console.log(redact(JSON.stringify(value, null, 2)));

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

async function main(): Promise<void> {
  if (!apiKey) {
    console.log("GEMINI_API_KEY is not set");
    process.exitCode = 1;
    return;
  }
  const model = arg("model") || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const now = arg("now") ? Temporal.Instant.from(arg("now")!) : Temporal.Now.instant();
  const shop = lolaSeedProfile;
  const pack = getSectorPack(shop.sectorPackId);
  const lines = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"))
    .map((a): [Lang, string] => {
      const [lang, ...rest] = a.split("|");
      if (lang !== "es" && lang !== "en") throw new Error(`argument must start with "es|" or "en|": ${a}`);
      return [lang, rest.join("|")];
    });

  const gemini = createGeminiClient({ apiKey, model });
  console.log(`model ${model}, now ${now.toZonedDateTimeISO(shop.timeZone).toString({ timeZoneName: "never" })} ${shop.timeZone}`);

  for (const [lang, utterance] of lines.length ? lines : DEFAULT_LINES) {
    // Exactly what handleTurn does for the first `say` of a fresh Call: the browser has sent
    // no completed Turns yet, so the conversation is empty.
    const state = { ...initialCallState(lang), language: lang };
    let raw = "";
    const recording: ModelClient = {
      async generate(req) {
        raw = await gemini.generate(req);
        return raw;
      },
    };
    let failure: ModelFailureInfo | undefined;
    const t0 = Date.now();
    const result = await callReceptionist(
      recording,
      {
        systemInstruction: buildSystemInstruction(shop, pack, state.language, now),
        input: buildInput(state, [], utterance, shop),
      },
      { timeoutMs: MODEL_TIMEOUT_MS, onFailure: (info) => (failure = info) },
    );
    const latencyMs = Date.now() - t0;

    console.log(`\n=== [${lang}] ${utterance}`);
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

    const decision = decideTurn({
      state,
      turn: result.turn,
      shop,
      pack,
      now,
      existing: [],
      callerBookings: [],
      maxTurns: 20,
    });
    print({
      outcome: "ok",
      latencyMs,
      modelTurn: withoutPersonalData(result.turn),
      decision: {
        reply: toSpokenReply(decision.reply),
        stage: decision.state.stage,
        complete: decision.complete,
        lastOffer: decision.state.lastOffer ?? [],
        effects: decision.effects.map((e) => e.type),
      },
    });
    // Same check the server makes, shown for completeness.
    if (!inspectModelTurn(raw).ok) console.log("unexpected: the raw text no longer validates");
  }
}

main().catch((err: unknown) => {
  const e = err as { constructor?: { name?: string }; message?: string } | undefined;
  console.log(redact(`check-turn failed: ${e?.constructor?.name ?? "Error"} ${e?.message ?? ""}`));
  process.exitCode = 1;
});

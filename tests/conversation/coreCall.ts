import { Temporal } from "temporal-polyfill";
import { handleTurn, handleTurnTimed } from "@/lib/conversation/handleTurn";
import type { FallbackLogEvent } from "@/lib/conversation/fallbackLog";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { CoreConfig, CoreDeps, Lang, Line, ModelClient, TimedTurnOutput, TurnOutput } from "@/lib/conversation/types";
import { geminiHighDemandError } from "@/lib/receptionist/callModel";
import type { ModelTurn } from "@/lib/receptionist/schema";
import { memoryRepository, type MemoryRepository } from "./memoryRepository";

/**
 * `handleTurn` on the in-memory repository (task 9.1), for the conversation-level properties
 * B1, B2, B3, B8 and B11. No HTTP adapter and no database: the PGlite regression tests cover those.
 */

/** What the model does on one Turn (design.md, `arbModelBehaviour`). */
export type ModelBehaviour =
  | { kind: "valid"; turn: ModelTurn }
  | { kind: "503" }
  | { kind: "429" }
  | { kind: "hang" }
  | { kind: "network" }
  | { kind: "invalid_json" }
  | { kind: "schema_invalid" };

export const FAILING_KINDS = ["503", "429", "hang", "network", "invalid_json", "schema_invalid"] as const;
export type FailingKind = (typeof FAILING_KINDS)[number];

/** A ModelTurn with everything null or false; override what the model heard. */
export function modelTurn(over: Partial<ModelTurn> = {}): ModelTurn {
  return {
    reply: "Vale.",
    language: "es",
    wantsLanguage: null,
    intent: "booking",
    name: null,
    phone: null,
    service: null,
    date: null,
    time: null,
    callerConfirmed: false,
    callerWantsToEnd: false,
    outOfProfile: false,
    reason: "Quiere una cita",
    urgency: "normal",
    ...over,
  };
}

/** One attempt of a behaviour, now. A hang never settles and ignores the abort signal. */
export function runBehaviour(b: ModelBehaviour): Promise<string> {
  switch (b.kind) {
    case "valid":
      return Promise.resolve(JSON.stringify(b.turn));
    case "503":
      return Promise.reject(geminiHighDemandError());
    case "429":
      return Promise.reject(Object.assign(new Error("429 RESOURCE_EXHAUSTED: limit: 5 requests per minute"), { status: 429 }));
    case "hang":
      return new Promise<string>(() => {});
    case "network":
      return Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }));
    case "invalid_json":
      return Promise.resolve('{"reply": "hola", "intent": "maybe"');
    case "schema_invalid":
      return Promise.resolve(JSON.stringify({ ...modelTurn(), intent: "maybe" }));
  }
}

/** A model whose behaviour the test sets before each Turn; it counts every attempt. */
export interface SwitchModel extends ModelClient {
  behaviour: ModelBehaviour;
  calls: number;
}

export function switchModel(initial: ModelBehaviour = { kind: "503" }): SwitchModel {
  const m: SwitchModel = {
    behaviour: initial,
    calls: 0,
    generate() {
      m.calls++;
      return runBehaviour(m.behaviour);
    },
  };
  return m;
}

export const coreConfig: CoreConfig = {
  // The brain properties test the brain, not the clock (design.md, "Correctness Properties"); B8 tests the clock.
  modelTimeoutMs: 20,
  maxTurns: 20,
  perVisitorPerMinute: 10_000,
  globalPerHour: 100_000,
  maxConsecutiveInvalid: 2,
};

export interface CoreHarness {
  repo: MemoryRepository;
  deps: CoreDeps;
  events: FallbackLogEvent[];
}

export function coreHarness(opts: {
  shops: readonly ShopProfile[];
  now: Temporal.Instant;
  model: ModelClient;
  config?: Partial<CoreConfig>;
}): CoreHarness {
  const repo = memoryRepository({ shops: opts.shops, clock: () => opts.now });
  const events: FallbackLogEvent[] = [];
  let n = 0;
  const deps: CoreDeps = {
    repo,
    model: opts.model,
    limiter: { hit: (key, now) => repo.hitRateLimits(key, now) },
    clock: () => opts.now,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    config: { ...coreConfig, ...opts.config },
    logFallback: (e) => events.push(e),
  };
  return { repo, deps, events };
}

/** A caller's side of a Call through `handleTurn`, keeping the conversation as the browser would. */
export class CoreCaller {
  callId = "";
  conversation: Line[] = [];
  constructor(
    private readonly deps: CoreDeps,
    private readonly shop: ShopProfile,
    public language: Lang = "es",
    private readonly visitorKey = "visitor-1",
  ) {}

  async start(): Promise<TurnOutput> {
    const out = await handleTurn({ kind: "start", channel: "voice", shop: this.shop, language: this.language, visitorKey: this.visitorKey }, this.deps);
    this.callId = out.callId;
    this.conversation = [{ caller: "", receptionist: out.reply }];
    return out;
  }

  say(utterance: string): Promise<TurnOutput> {
    return this.sayTimed(utterance).then((r) => r.output);
  }

  /** `say` with the Turn's stage times beside its output (front-desk-brain 19.4). */
  sayTimed(utterance: string): Promise<TimedTurnOutput> {
    return handleTurnTimed(
      {
        kind: "say",
        channel: "voice",
        shop: this.shop,
        language: this.language,
        visitorKey: this.visitorKey,
        callId: this.callId,
        utterance,
        conversation: this.conversation.slice(-20),
      },
      this.deps,
    ).then((timed) => {
      const out = timed.output;
      this.conversation.push({ caller: utterance, receptionist: out.reply });
      // The page follows the language the reply is in.
      this.language = out.language;
      return timed;
    });
  }

  hangup(): Promise<TurnOutput> {
    return handleTurn({ kind: "hangup", channel: "voice", shop: this.shop, callId: this.callId }, this.deps);
  }
}

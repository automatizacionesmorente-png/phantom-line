import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { makeTurnHandler } from "@/app/api/turn/handler";
import type { CoreConfig, CoreDeps, Line, ModelClient, TurnOutput } from "@/lib/conversation/types";
import type { ModelTurn } from "@/lib/receptionist/schema";
import { createTestDb, type TestDb } from "../db/pglite";
import { insertShop } from "../db/helpers";
import { lolaProfile } from "../fixtures/lola";

/** Tuesday 10 November 2026, 09:00 in Madrid. "Mañana" is Wednesday 11. */
export const NOW = Temporal.Instant.from("2026-11-10T08:00:00Z");
export const SHOP = lolaProfile.id;

export const baseConfig: CoreConfig = {
  modelTimeoutMs: 8000,
  maxTurns: 20,
  perVisitorPerMinute: 12,
  globalPerHour: 200,
  maxConsecutiveInvalid: 2,
};

export async function setupDb(): Promise<TestDb> {
  const t = await createTestDb();
  await insertShop(t, lolaProfile);
  return t;
}

export function makeDeps(t: TestDb, model: ModelClient, config: Partial<CoreConfig> = {}): CoreDeps {
  return {
    repo: t.repo,
    model,
    limiter: { hit: (key, now) => t.repo.hitRateLimits(key, now) },
    clock: () => NOW,
    newId: () => randomUUID(),
    config: { ...baseConfig, ...config },
  };
}

/** The route's POST built with test deps; `after()` work is collected and can be awaited. */
export function makePost(deps: CoreDeps | (() => CoreDeps)) {
  const scheduled: Promise<void>[] = [];
  const POST = makeTurnHandler({
    deps: typeof deps === "function" ? deps : () => deps,
    schedule: (task) => {
      scheduled.push(task());
    },
    salt: () => "test-salt",
  });
  return { POST, scheduled, settle: () => Promise.all(scheduled) };
}

export function request(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("http://localhost/api/turn", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A ModelTurn with everything null or false; override what the caller said. */
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

/** A caller's side of a Call: keeps the conversation as the browser would and posts each line. */
export class Caller {
  callId = "";
  conversation: Line[] = [];
  constructor(
    private readonly POST: (r: Request) => Promise<Response>,
    public language: "es" | "en" = "es",
    private readonly ip = "203.0.113.7",
  ) {}

  async start(): Promise<{ status: number; body: TurnOutput }> {
    const res = await this.POST(request({ kind: "start", shopId: SHOP, language: this.language }, this.ip));
    const body = (await res.json()) as TurnOutput;
    if (res.status === 200) {
      this.callId = body.callId;
      this.conversation = [{ caller: "", receptionist: body.reply }];
    }
    return { status: res.status, body };
  }

  async say(utterance: string): Promise<{ status: number; body: TurnOutput }> {
    const res = await this.POST(
      request(
        { kind: "say", shopId: SHOP, language: this.language, callId: this.callId, utterance, conversation: this.conversation.slice(-20) },
        this.ip,
      ),
    );
    const body = (await res.json()) as TurnOutput;
    if (res.status === 200) this.conversation.push({ caller: utterance, receptionist: body.reply });
    return { status: res.status, body };
  }

  async hangup(): Promise<{ status: number; body: unknown }> {
    const res = await this.POST(request({ kind: "hangup", shopId: SHOP, callId: this.callId }, this.ip));
    return { status: res.status, body: await res.json() };
  }
}

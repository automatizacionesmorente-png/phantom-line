import { Temporal } from "temporal-polyfill";
import { toInstant, type ExistingBooking } from "@/lib/booking";
import { callReceptionist, type ModelFailure, type ModelFailureInfo, type ModelResult } from "@/lib/receptionist/callModel";
import { phrases, type PhraseSet, type Said } from "@/lib/receptionist/phrases";
import { buildInput, buildSystemInstruction } from "@/lib/receptionist/prompt";
import { spokenTemplate, toSpokenReply } from "@/lib/receptionist/speech";
import { getSectorPack, type Lang, type SectorPack } from "@/lib/sectors";
import { decideTurn, publicStateOf, type Decision } from "./decide";
import { checkLimits, type LimitDecision } from "./limits";
import { consoleFallbackLogger, type FallbackLogEvent } from "./fallbackLog";
import { factsFromModel, factsFromReading, type TurnFacts } from "./facts";
import { readUtterance } from "./brain/read";
import { mergeFields } from "./fields";
import { buildOwnerMessage, isActionable } from "./ownerMessage";
import { messageWrite } from "./messageWrite";
import type { ShopProfile } from "./shopProfile";
import {
  initialCallState,
  type CallerBooking,
  type CallState,
  type CoreDeps,
  type Effect,
  type Line,
  type Outcome,
  type StoredCall,
  type StageTimes,
  type TimedTurnOutput,
  type TurnInput,
  type TurnOutput,
  type Write,
} from "./types";

/** A `say` or `hangup` for a callId this shop never issued. The adapter answers 404. */
export class CallNotFoundError extends Error {
  constructor() {
    super("call_not_found");
    this.name = "CallNotFoundError";
  }
}

/** Commit attempts for one decision: the first plus 2 retries on `booking_overlap`. */
export const MAX_COMMIT_ATTEMPTS = 3;
/** Open Calls idle this long are closed by the sweep as `abandoned`. */
export const STALE_CALL_MINUTES = 10;
/** Rate-limit windows older than this are deleted by the sweep. */
export const RATE_LIMIT_RETENTION_HOURS = 24;
/** Bookings read around the times a Turn involves: the 14-day slot search plus the longest service. */
const BOOKING_WINDOW_DAYS = 15;

const CHANGE_INTENTS = new Set(["reschedule", "cancel"]);

/**
 * The Conversation_Core: the one function every Channel calls (Requirement 10.1).
 * All I/O goes through `deps`; every decision is made by `decideTurn` and the
 * Booking_Rules, and every fact that gets persisted comes from server state.
 */
export async function handleTurn(input: TurnInput, deps: CoreDeps): Promise<TurnOutput> {
  return (await handleTurnTimed(input, deps)).output;
}

/**
 * `handleTurn` with the request's stage times beside its output (front-desk-brain 19.4; design.md
 * "handleTurn", step 7), for the voice adapter's `Server-Timing` header. The times are numbers only
 * and never change what the Caller hears.
 */
export async function handleTurnTimed(input: TurnInput, deps: CoreDeps): Promise<TimedTurnOutput> {
  const clock = deps.timer ?? (() => performance.now());
  const started = clock();
  const stages = newStages(clock);
  const addDb = (ms: number) => (stages.times.db += ms);
  const timedDeps: CoreDeps = {
    ...deps,
    repo: timeCalls(deps.repo, addDb, clock),
    limiter: timeCalls(deps.limiter, addDb, clock),
  };
  const pack = getSectorPack(input.shop.sectorPackId);
  let output: TurnOutput;
  switch (input.kind) {
    case "start":
      output = await start(input, pack, timedDeps);
      break;
    case "say":
      output = await say(input, pack, timedDeps, stages);
      break;
    case "hangup":
      output = await hangup(input, pack, timedDeps);
      break;
  }
  return { output, timings: { ...stages.times, total: Math.max(0, clock() - started) } };
}

// ---------------------------------------------------------------------------
// Stage times (19.4)

interface Stages {
  times: Omit<StageTimes, "total">;
  /** Runs pure Code_Brain or `decideTurn` work and counts its time as `brain`. */
  brain<T>(f: () => T): T;
  clock: () => number;
}

function newStages(clock: () => number): Stages {
  const times = { brain: 0, db: 0, model: 0 };
  return {
    times,
    clock,
    brain<T>(f: () => T): T {
      const t0 = clock();
      try {
        return f();
      } finally {
        times.brain += Math.max(0, clock() - t0);
      }
    },
  };
}

/** The same port, with the time of every promise it returns added to `add` (the `db` stage). */
function timeCalls<T extends object>(port: T, add: (ms: number) => void, clock: () => number): T {
  return new Proxy(port, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const t0 = clock();
        const out: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (out !== null && typeof out === "object" && typeof (out as PromiseLike<unknown>).then === "function") {
          return Promise.resolve(out as PromiseLike<unknown>).finally(() => add(Math.max(0, clock() - t0)));
        }
        add(Math.max(0, clock() - t0));
        return out;
      };
    },
  });
}

// ---------------------------------------------------------------------------

/** Counts this Turn; if the counter itself fails (database down), limits fail open. */
async function overLimit(visitorKey: string, deps: CoreDeps): Promise<LimitDecision> {
  try {
    const counts = await deps.limiter.hit(visitorKey, deps.clock());
    return checkLimits(counts, deps.config);
  } catch (err) {
    console.error("rate limiter failed, failing open:", (err as Error)?.name ?? "error");
    return { blocked: false };
  }
}

/** Why this Turn falls back, for the server log. */
type FallbackCause = Pick<FallbackLogEvent, "reason" | "limit" | "model" | "error">;

function logFallback(
  deps: CoreDeps,
  path: FallbackLogEvent["path"],
  where: { shopId: string; callId?: string; turn?: number },
  cause: FallbackCause,
): void {
  try {
    (deps.logFallback ?? consoleFallbackLogger)({ event: "turn_fallback", path, ...where, ...cause });
  } catch {
    // Logging must never change what the Caller hears.
  }
}

function causeOfModelFailure(failure: ModelFailure, info: ModelFailureInfo | undefined): FallbackCause {
  return { reason: failure, model: info ?? { failure, latencyMs: 0 } };
}

function output(
  callId: string,
  state: CallState,
  shop: ShopProfile,
  reply: { text: string; cacheable: boolean },
  complete: boolean,
  outcome?: Outcome,
): TurnOutput {
  return {
    callId,
    reply: reply.text,
    cacheable: reply.cacheable,
    language: state.language,
    state: publicStateOf(state, shop, complete),
    complete,
    ...(outcome ? { outcome } : {}),
  };
}

/** The phrases of one Turn: the Variant_Seed is the Call id and the Turn number (natural-voice 6.3). */
function phraseSet(lang: Lang, pack: SectorPack, shop: ShopProfile, callId: string, turn: number, now: Temporal.Instant): PhraseSet {
  return phrases(lang, pack, shop, { callId, turn }, now);
}

/** A code-owned line as the caller hears and reads it: up to 3 short sentences (Requirement 9.7). */
function templateLine(line: Said, lang: Lang): { text: string; cacheable: boolean } {
  return { text: spokenTemplate(line.text, lang), cacheable: line.cacheable };
}

async function start(
  input: Extract<TurnInput, { kind: "start" }>,
  pack: SectorPack,
  deps: CoreDeps,
): Promise<TurnOutput> {
  const { shop, language } = input;
  const callId = deps.newId();
  const P = phraseSet(language, pack, shop, callId, 0, deps.clock());
  const state = initialCallState(language);

  // Over the limit on the first request: no Call exists yet, so nothing is saved
  // and nothing reaches the Owner's tape (design, review point 3).
  const limited = await overLimit(input.visitorKey, deps);
  if (limited.blocked) {
    logFallback(deps, "start", { shopId: shop.id }, { reason: "rate_limit", limit: limited.limit });
    return output(callId, { ...state, stage: "done" }, shop, templateLine(P.rateLimitedStart(), language), true);
  }

  // The greeting is a fixed template (Requirement 4.8, receptionist-voice.md); no model call.
  const greeting = templateLine(P.greeting(), language);
  await deps.repo.commit([
    {
      type: "insertCall",
      call: {
        id: callId,
        shopId: shop.id,
        channel: input.channel,
        language,
        status: "open",
        state,
        transcript: [{ caller: "", receptionist: greeting.text }],
        turnCount: 0,
      },
    },
  ]);
  return output(callId, state, shop, greeting, false);
}

async function loadOpenCall(callId: string, shopId: string, deps: CoreDeps): Promise<StoredCall> {
  const call = await deps.repo.getCall(callId, shopId);
  if (!call) throw new CallNotFoundError();
  return call;
}

/**
 * The end path: the Fallback_Message, the Call closes, a Message with `model_failed` (core-call-loop
 * 3.10). Since front-desk-brain it is reached only by the per-visitor rate limit (1.4); a model
 * failure never ends a Call (1.2).
 */
async function endWithFallback(
  call: StoredCall,
  state: CallState,
  input: Extract<TurnInput, { kind: "say" }>,
  pack: SectorPack,
  deps: CoreDeps,
  cause: FallbackCause,
): Promise<TurnOutput> {
  const { shop } = input;
  // Logged before the commit, so the cause is on record even if the database fails next.
  logFallback(deps, "end", { shopId: shop.id, callId: call.id, turn: state.turnCount + 1 }, cause);
  const P = phraseSet(state.language, pack, shop, call.id, state.turnCount + 1, deps.clock());
  const reply = templateLine(P.fallbackEnd(), state.language);
  const final: CallState = {
    ...state,
    stage: "done",
    pending: undefined,
    modelFailed: true,
    turnCount: state.turnCount + 1,
  };
  const message = buildOwnerMessage(final, "fallback", shop, pack);
  const transcript = [...call.transcript, { caller: input.utterance, receptionist: reply.text }];
  await deps.repo.commit([
    messageWrite(message, { call, shop, pack, transcript, now: deps.clock() }),
    {
      type: "updateCall",
      callId: call.id,
      state: final,
      transcript,
      turnCount: final.turnCount,
      status: "failed",
    },
  ]);
  return output(call.id, final, shop, reply, true, "fallback");
}

/**
 * The instants a Turn may book or move to, so the bookings read cover the slot search around them.
 * A Call with services and no requested time may get a First_Offer, which searches 14 days from
 * `now` or from the day asked for (front-desk-brain 8.1, 8.2), so those instants count too.
 */
function timesInvolved(state: CallState, decisionState: CallState, shop: ShopProfile, now: Temporal.Instant): Temporal.Instant[] {
  const out: Temporal.Instant[] = [];
  for (const s of [state, decisionState]) {
    const r = s.fields.requested;
    if (r) {
      try {
        out.push(toInstant(Temporal.PlainDate.from(r.date), Temporal.PlainTime.from(r.time), shop.timeZone));
      } catch {
        // An unusable date is dropped by mergeFields anyway.
      }
    }
    if (s.pending && s.pending.kind !== "cancel") out.push(Temporal.Instant.from(s.pending.start));
    if (s.fields.serviceId !== undefined || s.lastOffer?.length) {
      out.push(now);
      if (s.fields.day) {
        try {
          out.push(toInstant(Temporal.PlainDate.from(s.fields.day), Temporal.PlainTime.from("00:00"), shop.timeZone));
        } catch {
          // Not a date: the offer starts from now.
        }
      }
    }
    for (const iso of s.lastOffer ?? []) out.push(Temporal.Instant.from(iso));
  }
  return out;
}

async function readBookings(
  shopId: string,
  times: readonly Temporal.Instant[],
  now: Temporal.Instant,
  deps: CoreDeps,
): Promise<ExistingBooking[]> {
  if (times.length === 0) return [];
  const all = [...times, now].sort(Temporal.Instant.compare);
  const from = all[0].subtract({ hours: 24 * BOOKING_WINDOW_DAYS });
  const to = all[all.length - 1].add({ hours: 24 * BOOKING_WINDOW_DAYS });
  return deps.repo.listBookings(shopId, from, to);
}

/** A promise that never rejects: the value, or the error to throw where the value is used. */
function settled<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; err: unknown }> {
  return p.then(
    (value) => ({ ok: true as const, value }),
    (err: unknown) => ({ ok: false as const, err }),
  );
}

/** The same instants, in any order: the bookings read for one set covers the other. */
function sameTimes(a: readonly Temporal.Instant[], b: readonly Temporal.Instant[]): boolean {
  const key = (xs: readonly Temporal.Instant[]) => [...new Set(xs.map((x) => x.epochMilliseconds))].sort((x, y) => x - y).join(",");
  return key(a) === key(b);
}

/** Turns the decision's effects into one atomic batch. The Message links to the booking it is about. */
function writesFor(
  decision: Decision,
  call: StoredCall,
  shop: ShopProfile,
  pack: SectorPack,
  transcript: Line[],
  now: Temporal.Instant,
  deps: CoreDeps,
): Write[] {
  const writes: Write[] = [];
  let bookingId: string | undefined;
  const newBooking = (e: Extract<Effect, { type: "createBooking" | "reschedule" }>, rescheduledFrom?: string) => {
    bookingId = deps.newId();
    writes.push({
      type: "insertBooking",
      booking: {
        id: bookingId,
        shopId: shop.id,
        resourceId: e.verdict.resourceId,
        serviceId: e.serviceId,
        start: e.verdict.start,
        end: e.verdict.end,
        customerName: e.name,
        customerPhone: e.phone,
        channel: call.channel,
        callId: call.id,
        ...(rescheduledFrom ? { rescheduledFrom } : {}),
      },
    });
  };
  for (const e of decision.effects) {
    if (e.type === "createBooking") newBooking(e);
    else if (e.type === "reschedule") {
      // Cancel then insert in the same batch: if the insert hits the constraint, the cancel rolls back (5.10).
      writes.push({ type: "cancelBooking", bookingId: e.oldBookingId });
      newBooking(e, e.oldBookingId);
    } else if (e.type === "cancelBooking") {
      writes.push({ type: "cancelBooking", bookingId: e.bookingId });
      bookingId = e.bookingId;
    }
  }
  for (const e of decision.effects) {
    if (e.type === "saveMessage") {
      writes.push(messageWrite(e.message, { call, shop, pack, transcript, now, ...(bookingId ? { bookingId } : {}) }));
    }
  }
  writes.push({
    type: "updateCall",
    callId: call.id,
    state: decision.state,
    transcript,
    turnCount: decision.state.turnCount,
    status: decision.complete ? "completed" : "open",
  });
  return writes;
}

async function say(
  input: Extract<TurnInput, { kind: "say" }>,
  pack: SectorPack,
  deps: CoreDeps,
  stages: Stages,
): Promise<TurnOutput> {
  const { shop } = input;
  const limited = await overLimit(input.visitorKey, deps);
  const call = await loadOpenCall(input.callId, shop.id, deps);

  if (call.status !== "open") {
    // A Turn after the end (a late retry, a second tab): nothing changes.
    const P = phraseSet(call.state.language, pack, shop, call.id, call.state.turnCount, deps.clock());
    return output(call.id, call.state, shop, templateLine(P.goodbye(), call.state.language), true);
  }

  // The page's ES / EN switch decides the language of this Turn (2.7, 4.9).
  const state: CallState = { ...call.state, language: input.language };
  // Step 1: the per-visitor limit protects the service from abuse and still ends the Call (1.4);
  // the global hourly limit only skips the model, and the brain answers (1.5).
  if (limited.blocked && limited.limit === "visitor") {
    return endWithFallback(call, state, input, pack, deps, { reason: "rate_limit", limit: limited.limit });
  }
  const skipModel = limited.blocked;

  const now = deps.clock();
  // Step 2: the Code_Brain's Reading, before any model call (2.1). Synchronous and pure.
  const reading = stages.brain(() => readUtterance({ utterance: input.utterance, state, shop, pack, now, lang: state.language }));
  const brainFacts = stages.brain(() => factsFromReading(reading, input.utterance));
  const timesFor = (f: TurnFacts) =>
    timesInvolved(state, { ...state, fields: mergeFields(state, f, shop).fields }, shop, now);

  // Step 3: when the times are already known from the state or the Reading, the bookings read
  // runs beside the model call (2.7). Its result is captured, so a database error while the
  // model is still running is never an unhandled rejection; it is thrown below if it is used.
  const earlyTimes = timesFor(brainFacts);
  const early =
    earlyTimes.length > 0
      ? { times: earlyTimes, result: settled(readBookings(shop.id, earlyTimes, now, deps)) }
      : null;

  // Step 4: the model, for at most the Model_Wait. `callReceptionist` races its own deadline and
  // aborts every attempt when it settles, so a late answer is dropped by construction (2.3–2.5).
  // A Sure_Reading never calls the model (2.2, 19.2): the brain answers, and since this is not a
  // model failure, no `turn_fallback` line is written and `modelFailed` is left as it was.
  // `decideTurn` still counts the Turn in `brainTurns`, because the brain answered it.
  let failureInfo: ModelFailureInfo | undefined;
  let result: ModelResult | null = null;
  if (!skipModel && !reading.sure) {
    const t0 = stages.clock();
    try {
      result = await callReceptionist(
        deps.model,
        {
          systemInstruction: buildSystemInstruction(shop, pack, state.language, now),
          input: buildInput(state, input.conversation, input.utterance, shop),
        },
        { timeoutMs: deps.config.modelTimeoutMs, onFailure: (info) => (failureInfo = info) },
      );
    } finally {
      stages.times.model += Math.max(0, stages.clock() - t0);
    }
  }
  // Step 5: the model's facts with the Reading's, or the Reading's alone (13.2, 1.1).
  let facts: TurnFacts;
  let decideState = state;
  if (result?.ok) {
    const turn = result.turn;
    facts = stages.brain(() => factsFromModel(turn, reading, shop, { state, utterance: input.utterance }));
  } else {
    facts = brainFacts;
    if (result) {
      // A model failure or the Model_Wait: the brain answers and the Call goes on (1.1–1.3, 1.6).
      // `decideTurn` counts the brain Turn; this Turn only records that the model failed.
      logFallback(deps, "brain", { shopId: shop.id, callId: call.id, turn: state.turnCount + 1 }, causeOfModelFailure(result.failure, failureInfo));
      decideState = { ...state, modelFailed: true };
    }
  }

  // Which facts this Turn needs from the database, read fresh in this request (5.9).
  const times = timesFor(facts);
  const wantsChange =
    CHANGE_INTENTS.has(facts.intent) ||
    CHANGE_INTENTS.has(state.intent) ||
    state.existingBookingId !== undefined ||
    (state.pending !== undefined && state.pending.kind !== "book");
  const phone = mergeFields(state, facts, shop).fields.phone;
  const callerBookings: CallerBooking[] =
    wantsChange && phone ? await deps.repo.findCallerBookings(shop.id, phone, now) : [];

  // The early read is used only if it covers exactly the times the chosen facts involve.
  let existing: ExistingBooking[];
  if (early && sameTimes(early.times, times)) {
    const r = await early.result;
    if (!r.ok) throw r.err;
    existing = r.value;
  } else {
    if (early) await early.result; // settled either way, so nothing is left unhandled
    existing = await readBookings(shop.id, times, now, deps);
  }
  for (let attempt = 1; ; attempt++) {
    const decision = stages.brain(() =>
      decideTurn({
        state: decideState,
        facts,
        reading,
        utterance: input.utterance,
        shop,
        pack,
        now,
        existing,
        callerBookings,
        maxTurns: deps.config.maxTurns,
        callId: call.id,
      }),
    );
    const lang = decision.state.language;
    // A template may have 3 sentences, the model's own words keep 2 (Requirements 9.7, 11.3).
    const text = decision.fromModel ? toSpokenReply(decision.reply, lang) : spokenTemplate(decision.reply, lang);
    const dontKnow = text ? null : phrases(lang, pack, shop, undefined, now).dontKnow();
    const spoken = dontKnow ? spokenTemplate(dontKnow.text, lang) : text;
    const cacheable = dontKnow ? dontKnow.cacheable : decision.cacheable;
    const transcript = [...call.transcript, { caller: input.utterance, receptionist: spoken }];
    const committed = await deps.repo.commit(writesFor(decision, call, shop, pack, transcript, now, deps));
    if (committed.ok) {
      return output(call.id, decision.state, shop, { text: spoken, cacheable }, decision.complete, decision.outcome);
    }

    // Someone took the resource between our read and our commit (23P01). The whole batch rolled
    // back; read again and decide again (another chair, or alternatives). At most 2 retries.
    if (attempt >= MAX_COMMIT_ATTEMPTS) return giveUpAfterConflicts(call, decideState, input, pack, deps);
    existing = await readBookings(shop.id, times, now, deps);
  }
}

/** Still conflicting after every retry: nothing was booked; the Owner gets a Message to call back. */
async function giveUpAfterConflicts(
  call: StoredCall,
  state: CallState,
  input: Extract<TurnInput, { kind: "say" }>,
  pack: SectorPack,
  deps: CoreDeps,
): Promise<TurnOutput> {
  const { shop } = input;
  const reply = templateLine(
    phraseSet(state.language, pack, shop, call.id, state.turnCount + 1, deps.clock()).slotJustTaken(null, []),
    state.language,
  );
  const final: CallState = { ...state, stage: "done", pending: undefined, turnCount: state.turnCount + 1 };
  const transcript = [...call.transcript, { caller: input.utterance, receptionist: reply.text }];
  await deps.repo.commit([
    ...(isActionable(final, "message")
      ? [messageWrite(buildOwnerMessage(final, "message", shop, pack), { call, shop, pack, transcript, now: deps.clock() })]
      : []),
    {
      type: "updateCall",
      callId: call.id,
      state: final,
      transcript,
      turnCount: final.turnCount,
      status: "completed",
    },
  ]);
  return output(call.id, final, shop, reply, true, "message");
}

async function hangup(
  input: Extract<TurnInput, { kind: "hangup" }>,
  pack: SectorPack,
  deps: CoreDeps,
): Promise<TurnOutput> {
  const { shop } = input;
  const call = await deps.repo.getCall(input.callId, shop.id);
  if (!call) throw new CallNotFoundError();
  // Idempotent: a Call that already ended is left as it is (one Message per Call).
  if (call.status !== "open") return output(call.id, call.state, shop, { text: "", cacheable: false }, true, undefined);

  // Requirement 6.6: the fields collected so far. No Booking is ever created on hang-up.
  const final: CallState = { ...call.state, stage: "done", pending: undefined };
  await deps.repo.commit([
    ...(isActionable(final, "abandoned")
      ? [
          messageWrite(buildOwnerMessage(final, "abandoned", shop, pack), {
            call,
            shop,
            pack,
            transcript: call.transcript,
            now: deps.clock(),
          }),
        ]
      : []),
    {
      type: "updateCall",
      callId: call.id,
      state: final,
      transcript: call.transcript,
      turnCount: call.turnCount,
      status: "abandoned",
    },
  ]);
  return output(call.id, final, shop, { text: "", cacheable: false }, true, "abandoned");
}

/**
 * Housekeeping that runs after a response (`after()` in the voice adapter):
 * open Calls whose hang-up never arrived become `abandoned` with their Message,
 * and old rate-limit windows are deleted. Never throws.
 */
export async function sweep(shopId: string, deps: Pick<CoreDeps, "repo" | "clock">): Promise<void> {
  const now = deps.clock();
  try {
    await deps.repo.closeStaleCalls(shopId, now.subtract({ minutes: STALE_CALL_MINUTES }), now);
    await deps.repo.pruneRateLimits(now.subtract({ hours: RATE_LIMIT_RETENTION_HOURS }));
  } catch (err) {
    console.error("sweep failed:", (err as Error)?.name ?? "error");
  }
}

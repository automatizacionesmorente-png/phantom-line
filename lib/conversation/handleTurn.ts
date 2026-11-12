import { Temporal } from "temporal-polyfill";
import { toInstant, type ExistingBooking } from "@/lib/booking";
import { callReceptionist, type ModelFailure, type ModelFailureInfo } from "@/lib/receptionist/callModel";
import { phrases } from "@/lib/receptionist/phrases";
import { buildInput, buildSystemInstruction } from "@/lib/receptionist/prompt";
import { toSpokenReply } from "@/lib/receptionist/speech";
import { getSectorPack, type SectorPack } from "@/lib/sectors";
import { decideTurn, publicStateOf, type Decision } from "./decide";
import { checkLimits, type LimitDecision } from "./limits";
import { consoleFallbackLogger, type FallbackLogEvent } from "./fallbackLog";
import { mergeFields } from "./fields";
import { buildOwnerMessage } from "./ownerMessage";
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
  const pack = getSectorPack(input.shop.sectorPackId);
  switch (input.kind) {
    case "start":
      return start(input, pack, deps);
    case "say":
      return say(input, pack, deps);
    case "hangup":
      return hangup(input, pack, deps);
  }
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
  reply: string,
  complete: boolean,
  outcome?: Outcome,
): TurnOutput {
  return {
    callId,
    reply,
    language: state.language,
    state: publicStateOf(state, shop, complete),
    complete,
    ...(outcome ? { outcome } : {}),
  };
}

async function start(
  input: Extract<TurnInput, { kind: "start" }>,
  pack: SectorPack,
  deps: CoreDeps,
): Promise<TurnOutput> {
  const { shop, language } = input;
  const P = phrases(language, pack, shop);
  const state = initialCallState(language);
  const callId = deps.newId();

  // Over the limit on the first request: no Call exists yet, so nothing is saved
  // and nothing reaches the Owner's tape (design, review point 3).
  const limited = await overLimit(input.visitorKey, deps);
  if (limited.blocked) {
    logFallback(deps, "start", { shopId: shop.id }, { reason: "rate_limit", limit: limited.limit });
    return output(callId, { ...state, stage: "done" }, shop, P.rateLimitedStart(), true);
  }

  // The greeting is a fixed template (Requirement 4.8, receptionist-voice.md); no model call.
  const greeting = P.greeting();
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
        transcript: [{ caller: "", receptionist: greeting }],
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

/** The end path: the Fallback_Message, the Call closes, a Message with `model_failed` (4.7, 6.4, 3.10). */
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
  const P = phrases(state.language, pack, shop);
  const reply = P.fallbackEnd();
  const final: CallState = {
    ...state,
    stage: "done",
    pending: undefined,
    modelFailed: true,
    turnCount: state.turnCount + 1,
  };
  const message = buildOwnerMessage(final, "fallback", shop, pack);
  await deps.repo.commit([
    { type: "insertMessage", message: { ...message, shopId: shop.id, callId: call.id, channel: call.channel } },
    {
      type: "updateCall",
      callId: call.id,
      state: final,
      transcript: [...call.transcript, { caller: input.utterance, receptionist: reply }],
      turnCount: final.turnCount,
      status: "failed",
    },
  ]);
  return output(call.id, final, shop, reply, true, "fallback");
}

/** The instants a Turn may book or move to, so the bookings read cover the slot search around them. */
function timesInvolved(state: CallState, decisionState: CallState, shop: ShopProfile): Temporal.Instant[] {
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

/** Turns the decision's effects into one atomic batch. The Message links to the booking it is about. */
function writesFor(
  decision: Decision,
  call: StoredCall,
  shop: ShopProfile,
  transcript: Line[],
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
      writes.push({
        type: "insertMessage",
        message: { ...e.message, shopId: shop.id, callId: call.id, channel: call.channel, ...(bookingId ? { bookingId } : {}) },
      });
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
): Promise<TurnOutput> {
  const { shop } = input;
  const limited = await overLimit(input.visitorKey, deps);
  const call = await loadOpenCall(input.callId, shop.id, deps);

  if (call.status !== "open") {
    // A Turn after the end (a late retry, a second tab): nothing changes.
    const P = phrases(call.state.language, pack, shop);
    return output(call.id, call.state, shop, P.goodbye(), true);
  }

  // The page's ES / EN switch decides the language of this Turn (2.7, 4.9).
  const state: CallState = { ...call.state, language: input.language };
  if (limited.blocked) {
    return endWithFallback(call, state, input, pack, deps, { reason: "rate_limit", limit: limited.limit });
  }

  const now = deps.clock();
  let failureInfo: ModelFailureInfo | undefined;
  const result = await callReceptionist(
    deps.model,
    {
      systemInstruction: buildSystemInstruction(shop, pack, state.language, now),
      input: buildInput(state, input.conversation, input.utterance, shop),
    },
    { timeoutMs: deps.config.modelTimeoutMs, onFailure: (info) => (failureInfo = info) },
  );

  if (!result.ok) {
    const cause = causeOfModelFailure(result.failure, failureInfo);
    if (result.failure !== "invalid_output") return endWithFallback(call, state, input, pack, deps, cause);
    // The retry path (4.6): the Call continues; the second invalid output in a row ends it.
    const invalid = state.consecutiveInvalid + 1;
    if (invalid >= deps.config.maxConsecutiveInvalid) {
      return endWithFallback(call, { ...state, consecutiveInvalid: invalid }, input, pack, deps, cause);
    }
    logFallback(deps, "retry", { shopId: shop.id, callId: call.id, turn: state.turnCount + 1 }, cause);
    const reply = phrases(state.language, pack, shop).fallbackRetry();
    const next: CallState = { ...state, consecutiveInvalid: invalid, turnCount: state.turnCount + 1 };
    await deps.repo.commit([
      {
        type: "updateCall",
        callId: call.id,
        state: next,
        transcript: [...call.transcript, { caller: input.utterance, receptionist: reply }],
        turnCount: next.turnCount,
      },
    ]);
    return output(call.id, next, shop, reply, false);
  }

  const turn = result.turn;
  // Which facts this Turn needs from the database, read fresh in this request (5.9).
  const merged = mergeFields(state, turn, shop);
  const preview: CallState = { ...state, fields: merged.fields };
  const times = timesInvolved(state, preview, shop);
  const wantsChange =
    CHANGE_INTENTS.has(turn.intent) ||
    CHANGE_INTENTS.has(state.intent) ||
    state.existingBookingId !== undefined ||
    (state.pending !== undefined && state.pending.kind !== "book");
  const phone = merged.fields.phone;
  const callerBookings: CallerBooking[] =
    wantsChange && phone ? await deps.repo.findCallerBookings(shop.id, phone, now) : [];

  let existing = await readBookings(shop.id, times, now, deps);
  for (let attempt = 1; ; attempt++) {
    const decision = decideTurn({
      state,
      turn,
      shop,
      pack,
      now,
      existing,
      callerBookings,
      maxTurns: deps.config.maxTurns,
    });
    const spoken = toSpokenReply(decision.reply) || toSpokenReply(phrases(decision.state.language, pack, shop).dontKnow());
    const transcript = [...call.transcript, { caller: input.utterance, receptionist: spoken }];
    const committed = await deps.repo.commit(writesFor(decision, call, shop, transcript, deps));
    if (committed.ok) return output(call.id, decision.state, shop, spoken, decision.complete, decision.outcome);

    // Someone took the resource between our read and our commit (23P01). The whole batch rolled
    // back; read again and decide again (another chair, or alternatives). At most 2 retries.
    if (attempt >= MAX_COMMIT_ATTEMPTS) return giveUpAfterConflicts(call, state, input, pack, deps);
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
  const reply = toSpokenReply(phrases(state.language, pack, shop).slotJustTaken([]));
  const final: CallState = { ...state, stage: "done", pending: undefined, turnCount: state.turnCount + 1 };
  const message = buildOwnerMessage(final, "message", shop, pack);
  await deps.repo.commit([
    { type: "insertMessage", message: { ...message, shopId: shop.id, callId: call.id, channel: call.channel } },
    {
      type: "updateCall",
      callId: call.id,
      state: final,
      transcript: [...call.transcript, { caller: input.utterance, receptionist: reply }],
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
  if (call.status !== "open") return output(call.id, call.state, shop, "", true, undefined);

  // Requirement 6.6: the fields collected so far. No Booking is ever created on hang-up.
  const final: CallState = { ...call.state, stage: "done", pending: undefined };
  const message = buildOwnerMessage(final, "abandoned", shop, pack);
  await deps.repo.commit([
    { type: "insertMessage", message: { ...message, shopId: shop.id, callId: call.id, channel: call.channel } },
    {
      type: "updateCall",
      callId: call.id,
      state: final,
      transcript: call.transcript,
      turnCount: call.turnCount,
      status: "abandoned",
    },
  ]);
  return output(call.id, final, shop, "", true, "abandoned");
}

/**
 * Housekeeping that runs after a response (`after()` in the voice adapter):
 * open Calls whose hang-up never arrived become `abandoned` with their Message,
 * and old rate-limit windows are deleted. Never throws.
 */
export async function sweep(shopId: string, deps: Pick<CoreDeps, "repo" | "clock">): Promise<void> {
  const now = deps.clock();
  try {
    await deps.repo.closeStaleCalls(shopId, now.subtract({ minutes: STALE_CALL_MINUTES }));
    await deps.repo.pruneRateLimits(now.subtract({ hours: RATE_LIMIT_RETENTION_HOURS }));
  } catch (err) {
    console.error("sweep failed:", (err as Error)?.name ?? "error");
  }
}

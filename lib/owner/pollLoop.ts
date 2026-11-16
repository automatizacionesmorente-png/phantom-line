/**
 * The Machine_Page's Poll loop (owner-machine 12.1, 12.6, 12.7, 12.9). A pure reducer:
 * events in, a new state and the effects to run out. Time comes only from the events'
 * `at` (ms), so the loop is testable without timers. `useMachinePoll` runs the effects:
 *
 * - `fetch`: one GET with `?since=`, then OK, FAILED or UNAUTHORIZED back in;
 * - `schedule`: replace the one timer (clear, then set); its firing is a TICK;
 * - `cancel`: clear the timer.
 *
 * Intervals: 5 s; 30 s once Idle (15 minutes with no input and no new Message); failure
 * backoff 5, 10, 20, 40, 60, 60 … s takes precedence over both. Hidden: no timer, no fetch,
 * and a fetch at once on becoming visible. A 401 goes to the PIN_Gate and the loop stops.
 */
import type { PollChanged, PollCounts, PollResponse, TapeItem } from "./api";

export const POLL_MS = 5_000;
export const IDLE_POLL_MS = 30_000;
export const IDLE_AFTER_MS = 15 * 60 * 1000;
export const MAX_BACKOFF_MS = 60_000;

export type PollPhase = "running" | "hidden" | "backoff" | "locked";

export interface PollState {
  phase: PollPhase;
  /** The newest Machine_Version applied; sent as `since`. */
  version: number;
  /** The delay of the last `schedule`, for display and tests. */
  delayMs: number;
  /** Consecutive failed Polls. */
  failures: number;
  /** ms: the last input or the last Poll that brought a new Message (12.9). */
  lastActivityAt: number;
  /** Whether the loop was Idle at the last timed event. */
  idle: boolean;
  /** Message ids on the Tape as last applied, to spot a new one. */
  seenIds: readonly string[];
}

export type PollEvent =
  | { type: "TICK"; at: number }
  | { type: "VISIBLE"; at: number }
  | { type: "HIDDEN" }
  | { type: "INPUT"; at: number }
  | { type: "OK"; res: PollResponse; at: number }
  | { type: "FAILED" }
  | { type: "UNAUTHORIZED" };

export type PollEffect =
  | { type: "fetch"; since: number }
  | { type: "schedule"; ms: number }
  | { type: "cancel" }
  | { type: "apply"; res: PollChanged }
  | { type: "counts"; counts: PollCounts }
  | { type: "showOffline"; on: boolean }
  | { type: "toGate" };

type Result = [PollState, PollEffect[]];

/** Backoff after `failures` consecutive failures (≥ 1): 5, 10, 20, 40, 60, 60 … s (12.7). */
export function backoffMs(failures: number): number {
  const n = Math.max(1, failures);
  return Math.min(POLL_MS * 2 ** Math.min(n - 1, 10), MAX_BACKOFF_MS);
}

/** Idle exactly when the last activity is at least 15 minutes before `at`. */
export function isIdle(lastActivityAt: number, at: number): boolean {
  return at - lastActivityAt >= IDLE_AFTER_MS;
}

/** Whether `tape` holds an id outside `seenIds` (12.9). */
export function hasNewMessage(seenIds: readonly string[], tape: readonly Pick<TapeItem, "id">[]): boolean {
  const seen = new Set(seenIds);
  return tape.some((t) => !seen.has(t.id));
}

/**
 * The first state, for the snapshot the server rendered with the page. The page has fresh
 * data, so the first Poll waits for the normal interval; a hidden page waits for VISIBLE.
 */
export function startPollLoop(init: {
  version: number;
  tapeIds: readonly string[];
  at: number;
  visible: boolean;
}): Result {
  const s: PollState = {
    phase: init.visible ? "running" : "hidden",
    version: init.version,
    delayMs: POLL_MS,
    failures: 0,
    lastActivityAt: init.at,
    idle: false,
    seenIds: [...init.tapeIds],
  };
  return init.visible ? [s, [{ type: "schedule", ms: POLL_MS }]] : [s, []];
}

/** The next interval when nothing is failing. */
function intervalAt(s: PollState, at: number): number {
  return isIdle(s.lastActivityAt, at) ? IDLE_POLL_MS : POLL_MS;
}

export function pollLoop(s: PollState, e: PollEvent): Result {
  if (s.phase === "locked") return [s, []];

  switch (e.type) {
    case "TICK": {
      const idle = isIdle(s.lastActivityAt, e.at);
      if (s.phase === "hidden") return [{ ...s, idle }, []];
      return [{ ...s, idle }, [{ type: "fetch", since: s.version }]];
    }

    case "VISIBLE": {
      const phase = s.failures > 0 ? "backoff" : "running";
      return [
        { ...s, phase, idle: isIdle(s.lastActivityAt, e.at) },
        [{ type: "cancel" }, { type: "fetch", since: s.version }],
      ];
    }

    case "HIDDEN":
      return [{ ...s, phase: "hidden" }, [{ type: "cancel" }]];

    case "INPUT": {
      const wasIdle = isIdle(s.lastActivityAt, e.at);
      const next: PollState = { ...s, lastActivityAt: Math.max(s.lastActivityAt, e.at), idle: false };
      // Input while Idle: Poll at once; the answer then schedules 5 s (12.9). Not while hidden (12.6).
      if (wasIdle && s.phase !== "hidden") return [next, [{ type: "cancel" }, { type: "fetch", since: s.version }]];
      return [next, []];
    }

    case "OK": {
      const effects: PollEffect[] = [];
      let next: PollState = { ...s, failures: 0 };
      if (s.failures > 0) effects.push({ type: "showOffline", on: false });

      const res = e.res;
      if (res.changed && res.version >= s.version) {
        if (hasNewMessage(s.seenIds, res.tape)) next = { ...next, lastActivityAt: Math.max(next.lastActivityAt, e.at) };
        next = { ...next, version: res.version, seenIds: res.tape.map((t) => t.id) };
        effects.push({ type: "apply", res });
      } else if (!res.changed && res.version === s.version) {
        effects.push({ type: "counts", counts: res.counts });
      }
      // An unchanged body for another version, or an older full body, is a late answer: nothing to show.

      const idle = isIdle(next.lastActivityAt, e.at);
      if (s.phase === "hidden") return [{ ...next, idle }, effects];
      const ms = intervalAt(next, e.at);
      return [{ ...next, phase: "running", idle, delayMs: ms }, [...effects, { type: "schedule", ms }]];
    }

    case "FAILED": {
      const failures = s.failures + 1;
      const effects: PollEffect[] = failures === 1 ? [{ type: "showOffline", on: true }] : [];
      if (s.phase === "hidden") return [{ ...s, failures }, effects];
      const ms = backoffMs(failures);
      return [{ ...s, phase: "backoff", failures, delayMs: ms }, [...effects, { type: "schedule", ms }]];
    }

    case "UNAUTHORIZED":
      return [{ ...s, phase: "locked" }, [{ type: "cancel" }, { type: "toGate" }]];
  }
}

import { describe, expect, it } from "vitest";
import type { PollResponse } from "@/lib/owner/api";
import {
  backoffMs,
  hasNewMessage,
  IDLE_AFTER_MS,
  IDLE_POLL_MS,
  MAX_BACKOFF_MS,
  POLL_MS,
  pollLoop,
  startPollLoop,
  type PollEffect,
  type PollEvent,
  type PollState,
} from "@/lib/owner/pollLoop";
import { tapeItem } from "./pollFixtures";

const T0 = 1_000_000;
const MIN = 60_000;

function start(visible = true, tapeIds: string[] = ["m1"]) {
  return startPollLoop({ version: 10, tapeIds, at: T0, visible });
}

function run(s: PollState, events: PollEvent[]): [PollState, PollEffect[][]] {
  const all: PollEffect[][] = [];
  for (const e of events) {
    const [next, effects] = pollLoop(s, e);
    s = next;
    all.push(effects);
  }
  return [s, all];
}

const schedules = (effects: PollEffect[]) => effects.filter((f) => f.type === "schedule").map((f) => f.ms);
const fetches = (effects: PollEffect[]) => effects.filter((f) => f.type === "fetch");

const unchanged = (version = 10): PollResponse => ({ changed: false, version, counts: { new: 1, unheard: 1 } });
const changed = (version: number, ids: string[]): PollResponse => ({
  changed: true,
  version,
  counts: { new: ids.length, unheard: ids.length },
  now: "2026-11-12T10:00:00Z",
  tape: ids.map((id) => tapeItem(id)),
  agenda: [],
});

describe("pollLoop (owner-machine 12.1, 12.6, 12.7, 12.9)", () => {
  it("the constants are the requirement's numbers", () => {
    expect([POLL_MS, IDLE_POLL_MS, IDLE_AFTER_MS, MAX_BACKOFF_MS]).toEqual([5_000, 30_000, 900_000, 60_000]);
  });

  it("starts with a 5-second schedule when visible, and nothing when hidden", () => {
    expect(start(true)[1]).toEqual([{ type: "schedule", ms: 5_000 }]);
    const [hidden, effects] = start(false);
    expect(hidden.phase).toBe("hidden");
    expect(effects).toEqual([]);
  });

  it("a TICK fetches with the last version; an OK schedules 5 s", () => {
    const [s] = start();
    const [, [tick, ok]] = run(s, [{ type: "TICK", at: T0 + 5_000 }, { type: "OK", res: unchanged(), at: T0 + 5_100 }]);
    expect(tick).toEqual([{ type: "fetch", since: 10 }]);
    expect(ok).toEqual([{ type: "counts", counts: { new: 1, unheard: 1 } }, { type: "schedule", ms: 5_000 }]);
  });

  it("backs off 5, 10, 20, 40, 60, 60 s after failures, shows Offline once, and recovers on OK", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
    let [s] = start();
    const delays: number[] = [];
    const offline: PollEffect[] = [];
    for (let k = 0; k < 6; k++) {
      const [next, effects] = run(s, [{ type: "TICK", at: T0 + k * 1000 }, { type: "FAILED" }]);
      s = next;
      delays.push(...schedules(effects[1]));
      offline.push(...effects[1].filter((f) => f.type === "showOffline"));
    }
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(offline).toEqual([{ type: "showOffline", on: true }]);
    expect(s.phase).toBe("backoff");
    const [ok, [effects]] = run(s, [{ type: "OK", res: unchanged(), at: T0 + 10_000 }]);
    expect(ok.failures).toBe(0);
    expect(ok.phase).toBe("running");
    expect(effects).toContainEqual({ type: "showOffline", on: false });
    expect(schedules(effects)).toEqual([5_000]);
  });

  it("hidden stops: the timer is cancelled and neither a TICK nor an answer polls or schedules", () => {
    const [s] = start();
    const [hidden, [onHide, tick, ok, failed, input]] = run(s, [
      { type: "HIDDEN" },
      { type: "TICK", at: T0 + 5_000 },
      { type: "OK", res: unchanged(), at: T0 + 5_100 },
      { type: "FAILED" },
      { type: "INPUT", at: T0 + IDLE_AFTER_MS + MIN },
    ]);
    expect(onHide).toEqual([{ type: "cancel" }]);
    for (const effects of [tick, ok, failed, input]) {
      expect(fetches(effects)).toEqual([]);
      expect(schedules(effects)).toEqual([]);
    }
    expect(hidden.phase).toBe("hidden");
  });

  it("visible fetches at once", () => {
    const [s] = start(false);
    const [visible, [effects]] = run(s, [{ type: "VISIBLE", at: T0 + 2 * MIN }]);
    expect(effects).toEqual([{ type: "cancel" }, { type: "fetch", since: 10 }]);
    expect(visible.phase).toBe("running");
  });

  it("a 401 goes to the gate and the loop stops for good", () => {
    const [s] = start();
    const [locked, [, onLock, ...after]] = run(s, [
      { type: "TICK", at: T0 + 5_000 },
      { type: "UNAUTHORIZED" },
      { type: "VISIBLE", at: T0 + 6_000 },
      { type: "TICK", at: T0 + 7_000 },
      { type: "INPUT", at: T0 + IDLE_AFTER_MS + 8_000 },
      { type: "OK", res: unchanged(), at: T0 + 9_000 },
      { type: "FAILED" },
    ]);
    expect(onLock).toEqual([{ type: "cancel" }, { type: "toGate" }]);
    expect(locked.phase).toBe("locked");
    for (const effects of after) expect(effects).toEqual([]);
  });

  it("becomes Idle after exactly 15 minutes with no input and no new Message", () => {
    const [s] = start();
    const just = T0 + IDLE_AFTER_MS - 1;
    const [, [before]] = run(s, [{ type: "OK", res: unchanged(), at: just }]);
    expect(schedules(before)).toEqual([5_000]);
    const [idle, [after]] = run(s, [{ type: "OK", res: unchanged(), at: T0 + IDLE_AFTER_MS }]);
    expect(schedules(after)).toEqual([30_000]);
    expect(idle.idle).toBe(true);
    // An input 14 minutes in keeps it awake until 15 minutes after that input.
    const [, effects] = run(s, [
      { type: "INPUT", at: T0 + 14 * MIN },
      { type: "OK", res: unchanged(), at: T0 + IDLE_AFTER_MS },
      { type: "OK", res: unchanged(), at: T0 + 14 * MIN + IDLE_AFTER_MS },
    ]);
    expect(schedules(effects[1])).toEqual([5_000]);
    expect(schedules(effects[2])).toEqual([30_000]);
  });

  it("failure backoff takes precedence over the Idle interval", () => {
    const [s] = start();
    const [, [failed]] = run(s, [{ type: "FAILED" }]);
    expect(schedules(failed)).toEqual([5_000]);
    const [, all] = run(s, [{ type: "OK", res: unchanged(), at: T0 + IDLE_AFTER_MS }, { type: "FAILED" }, { type: "FAILED" }]);
    expect(schedules(all[0])).toEqual([30_000]);
    expect(schedules(all[2])).toEqual([10_000]);
  });

  it("input while Idle fetches at once, and the answer schedules 5 s", () => {
    const [s] = start();
    const late = T0 + IDLE_AFTER_MS + 3 * MIN;
    const [, [input, ok]] = run(s, [{ type: "INPUT", at: late }, { type: "OK", res: unchanged(), at: late + 200 }]);
    expect(input).toEqual([{ type: "cancel" }, { type: "fetch", since: 10 }]);
    expect(schedules(ok)).toEqual([5_000]);
    // Input while awake changes no timer.
    const [, [awake]] = run(s, [{ type: "INPUT", at: T0 + MIN }]);
    expect(awake).toEqual([]);
  });

  it("a new Message id ends Idle; the same ids do not", () => {
    const [s] = start(true, ["m1"]);
    const late = T0 + IDLE_AFTER_MS + MIN;
    const [same, [sameIds]] = run(s, [{ type: "OK", res: changed(11, ["m1"]), at: late }]);
    expect(schedules(sameIds)).toEqual([30_000]);
    const [awake, [newId, next]] = run(same, [
      { type: "OK", res: changed(12, ["m2", "m1"]), at: late + 30_000 },
      { type: "OK", res: unchanged(12), at: late + 35_000 },
    ]);
    expect(newId[0]).toMatchObject({ type: "apply" });
    expect(schedules(newId)).toEqual([5_000]);
    expect(schedules(next)).toEqual([5_000]);
    expect(awake.version).toBe(12);
    expect(awake.seenIds).toEqual(["m2", "m1"]);
  });

  it("applies a full body only when it is not older than the version applied", () => {
    const [s] = start();
    const [newer, [apply]] = run(s, [{ type: "OK", res: changed(12, ["m1"]), at: T0 + 5_000 }]);
    expect(apply[0]).toMatchObject({ type: "apply" });
    const [after, [late]] = run(newer, [{ type: "OK", res: changed(11, ["m1", "m9"]), at: T0 + 6_000 }]);
    expect(late.filter((f) => f.type === "apply")).toEqual([]);
    expect(after.version).toBe(12);
    expect(after.seenIds).toEqual(["m1"]);
  });

  it("hasNewMessage", () => {
    expect(hasNewMessage(["a", "b"], [{ id: "b" }, { id: "a" }])).toBe(false);
    expect(hasNewMessage(["a"], [{ id: "a" }, { id: "c" }])).toBe(true);
    expect(hasNewMessage([], [])).toBe(false);
  });
});

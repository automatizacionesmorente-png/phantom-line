import { describe, expect, it } from "vitest";
import type { TapeEntry } from "@/lib/messages/tape";
import {
  initialTapePlayer,
  tapeItems,
  tapePlayer,
  type TapePlayerEffect,
  type TapePlayerEvent,
  type TapePlayerState,
} from "@/lib/owner/tapePlayer";

const msg = (id: string, urgency: TapeEntry["urgency"], minute: number, heard = false): TapeEntry => ({
  id,
  urgency,
  heard,
  createdAt: `2026-11-12T10:${String(minute).padStart(2, "0")}:00Z`,
});

/** Apply events in order; return the final state and every effect. */
function run(s: TapePlayerState, events: TapePlayerEvent[]) {
  const effects: TapePlayerEffect[] = [];
  for (const e of events) {
    const [next, fx] = tapePlayer(s, e);
    s = next;
    effects.push(...fx);
  }
  return { s, effects };
}

const ana = msg("ana", "urgent", 1);
const luis = msg("luis", "normal", 5);
const eva = msg("eva", "low", 9);
const start = () => initialTapePlayer(10, [eva, luis, ana]);

describe("tapePlayer (owner-machine 7.2, 7.5, 7.6, 8.1)", () => {
  it("PLAY freezes the Tape_Order and plays the first, asking the server for it", () => {
    const [s, fx] = tapePlayer(start(), { type: "PLAY" });
    expect(s.queue).toEqual(["ana", "luis", "eva"]);
    expect(s.playing).toBe("ana");
    expect(fx).toEqual([{ type: "postPlay", id: "ana" }]);
    // Played on this page: heard at once, so the counter and order follow without waiting for a Poll.
    expect(s.items.ana.heard).toBe(true);
  });

  it("NEXT walks the frozen order even when the snapshot would order the Tape differently now", () => {
    const { s, effects } = run(start(), [
      { type: "PLAY" },
      // Luis becomes heard elsewhere: the live order now puts Eva before Luis.
      { type: "SNAPSHOT", version: 11, items: [ana, { ...luis, heard: true }, eva] },
      { type: "NEXT" },
    ]);
    expect(tapeItems(s).map((i) => i.id).indexOf("eva")).toBeLessThan(tapeItems(s).map((i) => i.id).indexOf("luis"));
    expect(s.playing).toBe("luis");
    expect(effects).toEqual([
      { type: "postPlay", id: "ana" },
      { type: "postPlay", id: "luis" },
    ]);
  });

  it("a Message arriving during playback joins at the next PLAY, not before", () => {
    const urgentNew = msg("new", "urgent", 30);
    const during = run(start(), [
      { type: "PLAY" },
      { type: "SNAPSHOT", version: 12, items: [ana, luis, eva, urgentNew] },
      { type: "NEXT" },
      { type: "NEXT" },
      { type: "NEXT" },
    ]);
    expect(during.effects.map((e) => e.id)).toEqual(["ana", "luis", "eva"]);
    expect(during.s.playing).toBeNull();
    expect(during.s.items.new).toBeDefined();

    const [again] = tapePlayer(during.s, { type: "PLAY" });
    expect(again.queue[0]).toBe("new"); // unheard and urgent: first on the fresh Tape
    expect(again.playing).toBe("new");
  });

  it("an older snapshot is ignored; one of the same version is applied", () => {
    const [older, fx] = tapePlayer(start(), { type: "SNAPSHOT", version: 9, items: [] });
    expect(older.version).toBe(10);
    expect(Object.keys(older.items).sort()).toEqual(["ana", "eva", "luis"]);
    expect(fx).toEqual([]);

    const [same] = tapePlayer(start(), { type: "SNAPSHOT", version: 10, items: [ana] });
    expect(Object.keys(same.items)).toEqual(["ana"]);
  });

  it("NEXT skips an id erased since PLAY", () => {
    const { s, effects } = run(start(), [{ type: "PLAY" }, { type: "ERASE", id: "luis" }, { type: "NEXT" }]);
    expect(s.playing).toBe("eva");
    expect(effects).toEqual([
      { type: "postPlay", id: "ana" },
      { type: "postErase", id: "luis" },
      { type: "postPlay", id: "eva" },
    ]);
  });

  it("NEXT also skips an id that left the Tape in a snapshot (erased on another device)", () => {
    const { s } = run(start(), [{ type: "PLAY" }, { type: "SNAPSHOT", version: 11, items: [ana, eva] }, { type: "NEXT" }]);
    expect(s.playing).toBe("eva");
  });

  it("ERASE of the Message on screen stops on it; NEXT plays the one that followed", () => {
    const erased = run(start(), [{ type: "PLAY" }, { type: "ERASE", id: "ana" }]);
    expect(erased.s.playing).toBeNull();
    expect(erased.s.items.ana).toBeUndefined();
    expect(erased.s.queue).toEqual(["luis", "eva"]);
    const [next] = tapePlayer(erased.s, { type: "NEXT" });
    expect(next.playing).toBe("luis");
  });

  it("ERASE is sent once; a repeat changes nothing", () => {
    const { s, effects } = run(start(), [
      { type: "ERASE", id: "eva" },
      { type: "ERASE", id: "eva" },
    ]);
    expect(effects).toEqual([{ type: "postErase", id: "eva" }]);
    expect(s.erased).toEqual(["eva"]);
  });

  it("ERASED moves the version up, so a Poll from before the erase cannot bring it back (8.1)", () => {
    const { s } = run(start(), [
      { type: "ERASE", id: "eva" },
      { type: "ERASED", id: "eva", version: 14 },
      { type: "SNAPSHOT", version: 13, items: [ana, luis, eva] },
    ]);
    expect(s.version).toBe(14);
    expect(s.items.eva).toBeUndefined();
    // Even a newer snapshot that still lists it (another code path, out of order) cannot show it.
    const [later] = tapePlayer(s, { type: "SNAPSHOT", version: 15, items: [ana, luis, eva] });
    expect(later.items.eva).toBeUndefined();
    expect(later.version).toBe(15);
  });

  it("ERASED never lowers the version", () => {
    const { s } = run(start(), [
      { type: "SNAPSHOT", version: 20, items: [ana, luis, eva] },
      { type: "ERASE", id: "ana" },
      { type: "ERASED", id: "ana", version: 18 },
    ]);
    expect(s.version).toBe(20);
  });

  it("TRANSCRIPT is kept for a Message on the Tape and dropped for an erased one", () => {
    const lines = [{ caller: "Hola", receptionist: "¡Hola! ¿En qué te puedo ayudar?" }];
    const { s } = run(start(), [
      { type: "PLAY" },
      { type: "TRANSCRIPT", id: "ana", lines },
      { type: "ERASE", id: "luis" },
      { type: "TRANSCRIPT", id: "luis", lines },
    ]);
    expect(s.transcripts.ana).toEqual(lines);
    expect(s.transcripts.luis).toBeUndefined();
    const [after] = tapePlayer(s, { type: "ERASE", id: "ana" });
    expect(after.transcripts.ana).toBeUndefined();
  });

  it("a Message played on this page stays heard when a snapshot from before the play arrives", () => {
    const { s } = run(start(), [{ type: "PLAY" }, { type: "SNAPSHOT", version: 10, items: [ana, luis, eva] }]);
    expect(s.items.ana.heard).toBe(true);
    expect(s.playing).toBe("ana");
  });

  it("STOP clears the queue; PLAY on an empty Tape plays nothing", () => {
    const [stopped] = tapePlayer(run(start(), [{ type: "PLAY" }]).s, { type: "STOP" });
    expect(stopped.playing).toBeNull();
    expect(stopped.queue).toEqual([]);
    const [empty, fx] = tapePlayer(initialTapePlayer(0, []), { type: "PLAY" });
    expect(empty.playing).toBeNull();
    expect(fx).toEqual([]);
  });
});

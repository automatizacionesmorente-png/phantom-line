/**
 * The tape player of the Machine_Page (owner-machine 7.2, 7.5, 7.6, 8.1). A pure reducer:
 * events in, a new state and the effects to run out. The page runs the effects (the
 * `play` and `erase` requests) and feeds their answers back as events.
 *
 * - A SNAPSHOT older than the newest version applied is ignored, so a Poll computed
 *   before an ERASE committed can never put the Message back (8.1).
 * - Every id erased in this page's life is filtered out of every later snapshot too.
 * - PLAY freezes the Tape_Order into `queue`; NEXT walks that frozen queue, so a Message
 *   arriving during playback joins at the next PLAY (7.5).
 *
 * Generic over the item type, so the Poll's `TapeItem` (lib/owner/api.ts) plugs in.
 */
import type { Line } from "@/lib/conversation/types";
import { orderTape, type TapeEntry } from "@/lib/messages/tape";

export interface TapePlayerState<T extends TapeEntry = TapeEntry> {
  /** The latest snapshot, minus erased ids. */
  items: Readonly<Record<string, T>>;
  /** Tape_Order frozen at PLAY, minus ids erased since. */
  queue: readonly string[];
  /** Position in `queue` of the Message played last; −1 before the first. */
  index: number;
  /** The Message on screen, or null. When set, it is `queue[index]` and in `items`. */
  playing: string | null;
  /** Every id erased in this page's life. */
  erased: readonly string[];
  /** Ids PLAY showed on this page: they stay heard even if a snapshot from before the play arrives. */
  played: readonly string[];
  /** Transcripts fetched by PLAY. */
  transcripts: Readonly<Record<string, readonly Line[]>>;
  /** The newest Machine_Version applied. Never decreases. */
  version: number;
}

export type TapePlayerEvent<T extends TapeEntry = TapeEntry> =
  | { type: "SNAPSHOT"; version: number; items: readonly T[] }
  | { type: "PLAY" }
  | { type: "NEXT" }
  | { type: "STOP" }
  | { type: "ERASE"; id: string }
  | { type: "ERASED"; id: string; version: number }
  | { type: "TRANSCRIPT"; id: string; lines: readonly Line[] };

export type TapePlayerEffect = { type: "postPlay"; id: string } | { type: "postErase"; id: string };

type Result<T extends TapeEntry> = [TapePlayerState<T>, TapePlayerEffect[]];

/** The state for the first snapshot the server rendered with the page. */
export function initialTapePlayer<T extends TapeEntry>(version: number, items: readonly T[]): TapePlayerState<T> {
  return {
    items: toRecord(items, new Set(), new Set()),
    queue: [],
    index: -1,
    playing: null,
    erased: [],
    played: [],
    transcripts: {},
    version,
  };
}

/** The items in Tape_Order, for the list on screen and the counts. */
export function tapeItems<T extends TapeEntry>(s: TapePlayerState<T>): T[] {
  return orderTape(Object.values(s.items));
}

function toRecord<T extends TapeEntry>(
  items: readonly T[],
  erased: ReadonlySet<string>,
  played: ReadonlySet<string>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) {
    if (erased.has(item.id)) continue;
    out[item.id] = played.has(item.id) && !item.heard ? { ...item, heard: true } : item;
  }
  return out;
}

/** Play `queue[k]`: mark it heard on the page and ask the server for its Transcript (7.4). */
function playAt<T extends TapeEntry>(s: TapePlayerState<T>, k: number): Result<T> {
  const id = s.queue[k];
  const item = s.items[id];
  const played = s.played.includes(id) ? s.played : [...s.played, id];
  return [
    { ...s, index: k, playing: id, played, items: { ...s.items, [id]: item.heard ? item : { ...item, heard: true } } },
    [{ type: "postPlay", id }],
  ];
}

/** The first position after `from` whose id is still on the Tape, or −1. */
function nextPlayable<T extends TapeEntry>(s: TapePlayerState<T>, from: number): number {
  for (let k = from + 1; k < s.queue.length; k++) {
    if (s.items[s.queue[k]] !== undefined) return k;
  }
  return -1;
}

export function tapePlayer<T extends TapeEntry>(s: TapePlayerState<T>, e: TapePlayerEvent<T>): Result<T> {
  switch (e.type) {
    case "SNAPSHOT": {
      if (e.version < s.version) return [s, []];
      const items = toRecord(e.items, new Set(s.erased), new Set(s.played));
      // The Message on screen was erased elsewhere (another device): stop on it; NEXT goes on from here.
      const playing = s.playing !== null && items[s.playing] !== undefined ? s.playing : null;
      return [{ ...s, items, playing, version: e.version }, []];
    }

    case "PLAY": {
      const queue = tapeItems(s).map((item) => item.id);
      const frozen: TapePlayerState<T> = { ...s, queue, index: -1, playing: null };
      return queue.length === 0 ? [frozen, []] : playAt(frozen, 0);
    }

    case "NEXT": {
      const k = nextPlayable(s, s.index);
      if (k === -1) return [{ ...s, index: s.queue.length, playing: null }, []];
      return playAt(s, k);
    }

    case "STOP":
      return [{ ...s, queue: [], index: -1, playing: null }, []];

    case "ERASE": {
      if (s.erased.includes(e.id)) return [s, []];
      return [eraseLocally(s, e.id), [{ type: "postErase", id: e.id }]];
    }

    case "ERASED": {
      const next = s.erased.includes(e.id) ? s : eraseLocally(s, e.id);
      return [{ ...next, version: Math.max(next.version, e.version) }, []];
    }

    case "TRANSCRIPT": {
      if (s.erased.includes(e.id)) return [s, []];
      return [{ ...s, transcripts: { ...s.transcripts, [e.id]: e.lines } }, []];
    }
  }
}

/**
 * Remove an id from everything at once. The queue shrinks and the index moves with it,
 * so NEXT after erasing the Message on screen plays the one that followed it.
 */
function eraseLocally<T extends TapeEntry>(s: TapePlayerState<T>, id: string): TapePlayerState<T> {
  const items: Record<string, T> = { ...s.items };
  delete items[id];
  const transcripts: Record<string, readonly Line[]> = { ...s.transcripts };
  delete transcripts[id];
  const at = s.queue.indexOf(id);
  const queue = at === -1 ? s.queue : s.queue.filter((q) => q !== id);
  const index = at !== -1 && at <= s.index ? s.index - 1 : s.index;
  return {
    ...s,
    items,
    transcripts,
    queue,
    index,
    playing: s.playing === id ? null : s.playing,
    erased: [...s.erased, id],
  };
}

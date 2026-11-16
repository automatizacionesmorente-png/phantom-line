"use client";

import { useEffect, useState } from "react";
import type { Line } from "@/lib/conversation/types";
import type { EraseResponse, PlayResponse, TapeItem } from "@/lib/owner/api";
import {
  initialTapePlayer,
  tapePlayer,
  type TapePlayerEffect,
  type TapePlayerEvent,
  type TapePlayerState,
} from "@/lib/owner/tapePlayer";
import type { Lang } from "@/lib/sectors";

export interface TapePlayerHook {
  state: TapePlayerState<TapeItem>;
  /** The language of each fetched Transcript, for its `lang` (13.7). */
  transcriptLang: Readonly<Record<string, Lang>>;
  dispatch: (e: TapePlayerEvent<TapeItem>) => void;
}

/** The URL of one Message action. */
export const messageUrl = (shopId: string, messageId: string) =>
  `/api/machine/${encodeURIComponent(shopId)}/messages/${encodeURIComponent(messageId)}`;

interface Callbacks {
  onUnauthorized: () => void;
  onFailure: () => void;
}

/**
 * The reducer and its effect runner, created once per page. Kept outside React so the
 * runner can feed answers back into the same dispatch without a render in between.
 */
function createTapeController(
  shopId: string,
  initial: TapePlayerState<TapeItem>,
  setState: (s: TapePlayerState<TapeItem>) => void,
  setLang: (id: string, lang: Lang) => void,
) {
  let current = initial;
  let callbacks: Callbacks = { onUnauthorized: () => {}, onFailure: () => {} };
  let live = true;

  const post = async (id: string, action: "play" | "erase"): Promise<Response | null> => {
    try {
      return await fetch(messageUrl(shopId, id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return null;
    }
  };

  const run = async (effect: TapePlayerEffect): Promise<void> => {
    const res = await post(effect.id, effect.type === "postPlay" ? "play" : "erase");
    if (!live) return;
    if (res === null || res.status >= 500) return callbacks.onFailure();
    if (res.status === 401) return callbacks.onUnauthorized();
    if (res.status === 404) {
      // Erased on another device: it leaves this Tape too (the reducer keeps the version).
      dispatch({ type: "ERASED", id: effect.id, version: current.version });
      // PLAY on a Message erased elsewhere: the player moves on to the next one.
      if (effect.type === "postPlay") dispatch({ type: "NEXT" });
      return;
    }
    if (!res.ok) return callbacks.onFailure();
    if (effect.type === "postPlay") {
      const body = (await res.json()) as PlayResponse;
      if (!live) return;
      const lines: Line[] = Array.isArray(body.transcript) ? body.transcript : [];
      setLang(effect.id, body.lang);
      dispatch({ type: "TRANSCRIPT", id: effect.id, lines });
    } else {
      const body = (await res.json()) as EraseResponse;
      if (!live) return;
      dispatch({ type: "ERASED", id: effect.id, version: body.version });
    }
  };

  function dispatch(e: TapePlayerEvent<TapeItem>): void {
    const [next, effects] = tapePlayer(current, e);
    current = next;
    setState(next);
    for (const effect of effects) void run(effect);
  }

  return {
    dispatch,
    setCallbacks: (c: Callbacks) => {
      callbacks = c;
    },
    start: () => {
      live = true;
    },
    stop: () => {
      live = false;
    },
  };
}

/**
 * Wires the pure `tapePlayer` reducer (lib/owner/tapePlayer.ts) to the Machine_API: PLAY
 * marks the Message heard on the server and fetches its Transcript (7.2, 7.4); ERASE marks
 * it Erased (7.6). The reducer decides; this hook only runs its effects and feeds the
 * answers back. A 401 sends the page back to the PIN_Gate (12.7).
 */
export function useTapePlayer(opts: {
  shopId: string;
  version: number;
  items: readonly TapeItem[];
  onUnauthorized: () => void;
  onFailure: () => void;
}): TapePlayerHook {
  const [state, setState] = useState(() => initialTapePlayer(opts.version, opts.items));
  const [transcriptLang, setTranscriptLang] = useState<Record<string, Lang>>({});
  const [controller] = useState(() =>
    createTapeController(
      opts.shopId,
      state,
      setState,
      (id, lang) => setTranscriptLang((m) => ({ ...m, [id]: lang })),
    ),
  );

  useEffect(() => {
    controller.setCallbacks({ onUnauthorized: opts.onUnauthorized, onFailure: opts.onFailure });
  }, [controller, opts.onUnauthorized, opts.onFailure]);

  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);

  return { state, transcriptLang, dispatch: controller.dispatch };
}

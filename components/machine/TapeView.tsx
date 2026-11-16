"use client";

import { Eraser, Play, SkipForward } from "lucide-react";
import type { TapeItem } from "@/lib/owner/api";
import type { MachineShop } from "@/lib/owner/machineShop";
import { tapeItems, type TapePlayerEvent, type TapePlayerState } from "@/lib/owner/tapePlayer";
import type { Lang } from "@/lib/sectors";
import { CONTROL_BUTTON } from "./controlButton";
import { CopyReplyButton } from "./CopyReplyButton";
import type { MachineCopy } from "./machineCopy";
import { TapeCard } from "./TapeCard";
import { TranscriptTape } from "./TranscriptTape";

/**
 * The Tape view (owner-machine 7): PLAY, NEXT, ERASE and COPY REPLY, the Message on screen
 * with its Transcript, then every New_Message in Tape_Order. The order of the queue is the
 * reducer's (frozen at PLAY, 7.5); this view only shows it.
 */
export function TapeView({
  player,
  dispatch,
  transcriptLang,
  shop,
  lang,
  copy,
  reducedMotion,
  onRevealDone,
  onCopyResult,
}: {
  player: TapePlayerState<TapeItem>;
  dispatch: (e: TapePlayerEvent<TapeItem>) => void;
  transcriptLang: Readonly<Record<string, Lang>>;
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  reducedMotion: boolean;
  onRevealDone: (id: string) => void;
  onCopyResult: (text: string) => void;
}) {
  const items = tapeItems(player);
  const playing = player.playing === null ? null : (player.items[player.playing] ?? null);
  const hasNext = player.queue.slice(player.index + 1).some((id) => player.items[id] !== undefined);
  const ended = playing === null && player.queue.length > 0 && player.index >= 0;
  const transcript = playing ? player.transcripts[playing.id] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={copy.controls.label} className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={items.length === 0}
          onClick={() => dispatch({ type: "PLAY" })}
          className={CONTROL_BUTTON}
        >
          <Play aria-hidden="true" size={18} />
          {copy.controls.play}
        </button>
        <button type="button" disabled={!hasNext} onClick={() => dispatch({ type: "NEXT" })} className={CONTROL_BUTTON}>
          <SkipForward aria-hidden="true" size={18} />
          {copy.controls.next}
        </button>
        <button
          type="button"
          disabled={playing === null}
          onClick={() => playing && dispatch({ type: "ERASE", id: playing.id })}
          className={CONTROL_BUTTON}
        >
          <Eraser aria-hidden="true" size={18} />
          {copy.controls.erase}
        </button>
        <CopyReplyButton
          reply={playing?.currentReply ?? null}
          replyLang={playing?.replyLang ?? null}
          label={copy.controls.copy}
          copiedText={copy.copied}
          fallbackHint={copy.copyFallback}
          disabled={playing === null}
          onResult={onCopyResult}
        />
      </div>

      <div data-player="" className="flex flex-col gap-2">
        {playing ? (
          <>
            <p className="font-inter text-xs uppercase tracking-[0.18em] text-muted">{copy.player.nowPlaying}</p>
            <TapeCard item={playing} shop={shop} lang={lang} copy={copy} expanded current>
              {transcript === undefined ? (
                <p className="font-inter text-base text-muted">{copy.fields.loadingTranscript}</p>
              ) : (
                <TranscriptTape
                  key={playing.id}
                  lines={transcript}
                  lang={transcriptLang[playing.id] ?? playing.replyLang}
                  labelLang={lang}
                  reducedMotion={reducedMotion}
                  labels={{
                    title: copy.fields.transcript,
                    caller: copy.fields.caller,
                    receptionist: copy.fields.receptionist,
                    empty: copy.fields.noTranscript,
                  }}
                  onRevealDone={() => onRevealDone(playing.id)}
                />
              )}
            </TapeCard>
          </>
        ) : (
          items.length > 0 && <p className="font-inter text-base text-muted">{ended ? copy.player.end : copy.player.idle}</p>
        )}
      </div>

      {items.length === 0 ? (
        <p className="font-inter text-base text-text">{copy.emptyTape}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <TapeCard
                item={item}
                shop={shop}
                lang={lang}
                copy={copy}
                current={item.id === player.playing}
                fadeIn={!reducedMotion}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

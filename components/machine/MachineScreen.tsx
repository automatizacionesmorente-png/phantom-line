"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { TryItGuide } from "@/components/guide/TryItGuide";
import { LanguageSwitch } from "@/components/call/LanguageSwitch";
import { lightAnnouncement, lightState, tapeCounts } from "@/lib/messages/tape";
import type { AgendaDayDto, AgendaItem, PollChanged } from "@/lib/owner/api";
import type { MachineShop } from "@/lib/owner/machineShop";
import { withAgendaItem } from "@/lib/owner/poll";
import { tapeItems } from "@/lib/owner/tapePlayer";
import { useBrowserLang } from "../useBrowserLang";
import { AgendaView } from "./AgendaView";
import { TrialBadge } from "@/components/TrialBadge";
import { DemoNotice } from "./DemoNotice";
import { LockButton } from "./LockButton";
import { MachineBody } from "./MachineBody";
import { MACHINE_COPY } from "./machineCopy";
import { MessageCounter } from "./MessageCounter";
import { MessageLight } from "./MessageLight";
import { TapeReels } from "./TapeReels";
import { TapeView } from "./TapeView";
import { useMachinePoll } from "./useMachinePoll";
import { useReducedMotion } from "./useReducedMotion";
import { useStoredView } from "./useStoredView";
import { useTapePlayer } from "./useTapePlayer";
import { panelId, tabId, ViewTabs } from "./ViewTabs";

export interface MachineScreenProps {
  shop: MachineShop;
  /** The snapshot the server read with the page (the same body as a Poll). */
  initial: PollChanged;
  /** The Actor's label typed at login. */
  label: string;
}

/**
 * The Owner's answering machine (owner-machine 6, 7, 9, 12, 13): header with the label
 * language switch and Lock, the ivory body with the reels, the Message_Light and the
 * Counter, and the Tape and Agenda as two tabs. The Poll keeps it live; the pure reducers
 * in lib/owner decide what changes.
 */
export function MachineScreen({ shop, initial, label }: MachineScreenProps) {
  const router = useRouter();
  const idBase = useId();
  const [lang, setLang] = useBrowserLang(shop.languages);
  const copy = MACHINE_COPY[lang];
  const reducedMotion = useReducedMotion();
  const [view, setView] = useStoredView(shop.id);
  const [agenda, setAgenda] = useState<AgendaDayDto[]>(initial.agenda);
  const [now, setNow] = useState(initial.now);
  const [revealDoneFor, setRevealDoneFor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copyNote, setCopyNote] = useState<{ text: string; over: string } | null>(null);

  const toGate = useCallback(() => router.refresh(), [router]);
  const onFailure = useCallback(() => setFailed(true), []);

  const tape = useTapePlayer({
    shopId: shop.id,
    version: initial.version,
    items: initial.tape,
    onUnauthorized: toGate,
    onFailure,
  });
  const { dispatch } = tape;

  const onApply = useCallback(
    (res: PollChanged) => {
      dispatch({ type: "SNAPSHOT", version: res.version, items: res.tape });
      setAgenda(res.agenda);
      setNow(res.now);
      setFailed(false);
    },
    [dispatch],
  );

  const { offline } = useMachinePoll({
    shopId: shop.id,
    version: initial.version,
    tapeIds: initial.tape.map((t) => t.id),
    onApply,
    onLocked: toGate,
  });

  const items = tapeItems(tape.state);
  const counts = tapeCounts(items);
  const light = lightState(counts);
  const announcement = lightAnnouncement(counts, lang);
  // One polite live region (13.2): the counts, or a COPY REPLY result until the counts change (7.7).
  const liveText = copyNote !== null && copyNote.over === announcement ? copyNote.text : announcement;

  const playing = tape.state.playing;
  const spinning =
    !reducedMotion && playing !== null && !(revealDoneFor === playing && tape.state.transcripts[playing] !== undefined);

  const onItem = useCallback(
    (item: AgendaItem) => setAgenda((days) => withAgendaItem(days, item, shop.timeZone)),
    [shop.timeZone],
  );

  return (
    <div lang={lang} className="flex w-full flex-col gap-4">
      {shop.demo && <TryItGuide current={3} lang={lang} />}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="flex items-center gap-2 font-inter text-xs uppercase tracking-[0.18em] text-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-dot" aria-hidden="true" />
            {copy.eyebrow} · {label}
          </p>
          <p className="font-newsreader text-2xl font-medium tracking-tight text-ink break-words">{shop.name}</p>
          {shop.demo && <DemoNotice lang={lang} />}
          {shop.trial === true && <TrialBadge lang={lang} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LanguageSwitch lang={lang} options={shop.languages} label={copy.languageLabel} onChange={setLang} />
          <LockButton shopId={shop.id} label={copy.lock} onLocked={toGate} />
        </div>
      </header>

      <MachineBody>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <TapeReels spinning={spinning} />
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <MessageLight state={light} reducedMotion={reducedMotion} />
            <p role="status" aria-live="polite" className="sr-only">
              {liveText}
            </p>
            <MessageCounter count={counts.new} lang={lang} copy={copy} />
          </div>
        </div>
        {counts.new > 0 && (
          <p className="flex items-center gap-2 font-caveat text-2xl text-gold-text">
            <svg aria-hidden="true" width="42" height="22" viewBox="0 0 42 22" fill="none" className="shrink-0">
              <path
                d="M2 4c8 1 16 6 24 12m0 0-7 1m7-1-1-7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {copy.note}
          </p>
        )}
        {(offline || failed) && <p className="font-inter text-sm font-semibold text-muted">{copy.offline}</p>}

        <ViewTabs view={view} onChange={setView} labels={copy.tabs} label={copy.tabsLabel} idBase={idBase} />

        <div role="tabpanel" id={panelId(idBase, "tape")} aria-labelledby={tabId(idBase, "tape")} hidden={view !== "tape"}>
          <h2 className="sr-only">{copy.tabs.tape}</h2>
          <TapeView
            player={tape.state}
            dispatch={dispatch}
            transcriptLang={tape.transcriptLang}
            shop={shop}
            lang={lang}
            copy={copy}
            reducedMotion={reducedMotion}
            onRevealDone={setRevealDoneFor}
            onCopyResult={(text) => setCopyNote({ text, over: announcement })}
          />
        </div>
        <div
          role="tabpanel"
          id={panelId(idBase, "agenda")}
          aria-labelledby={tabId(idBase, "agenda")}
          hidden={view !== "agenda"}
        >
          <AgendaView days={agenda} now={now} shop={shop} lang={lang} copy={copy} onItem={onItem} onLocked={toGate} />
        </div>
      </MachineBody>
    </div>
  );
}

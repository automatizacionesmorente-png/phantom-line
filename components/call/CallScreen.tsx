"use client";

import type { PublicShop } from "@/lib/voice/publicShop";
import { canType, canTypeInstead, type NoticeKey } from "@/lib/voice/callLoop";
import { CALL_COPY } from "./callCopy";
import { CallButton } from "./CallButton";
import { LanguageSwitch } from "./LanguageSwitch";
import { Transcript } from "./Transcript";
import { TypedInput } from "./TypedInput";
import { TypeInsteadButton } from "./TypeInsteadButton";
import { useCallLoop } from "./useCallLoop";

export interface CallScreenProps {
  shop: PublicShop;
}

/** The caller's "phone": one gold Call button, the ES / EN switch, the transcript and typing. */
export function CallScreen({ shop }: CallScreenProps) {
  const call = useCallLoop({ shopId: shop.id, languages: shop.languages, speechPhrases: shop.speechPhrases });
  const { state } = call;
  const copy = CALL_COPY[state.lang];
  const inCall = state.phase !== "idle" && state.phase !== "ended";

  const notice = (key: NoticeKey) =>
    // A line cut before the server issued a Call saved nothing, so it must not promise a message.
    key === "lineCut" && state.callId === null ? copy.lineUnavailable : shop.notices[state.lang][key];

  const status =
    state.phase === "ended" && state.endReason ? copy.ended[state.endReason] : copy.phase[state.phase];

  return (
    <div lang={state.lang} className="flex w-full flex-col items-center gap-6 text-center">
      <p className="flex items-center gap-2 font-inter text-xs uppercase tracking-[0.18em] text-muted">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-dot" aria-hidden="true" />
        {copy.eyebrow}
      </p>

      <h1 className="font-newsreader text-4xl font-medium tracking-tight text-ink break-words sm:text-5xl">
        {copy.headingBefore} <span className="text-gold">{shop.name}</span>
      </h1>

      <LanguageSwitch lang={state.lang} options={shop.languages} label={copy.languageLabel} onChange={call.switchLang} />

      <div className="flex flex-col items-center gap-3">
        {state.phase === "idle" && <CallButton mode="call" label={copy.call} onClick={call.pressCall} />}
        {inCall && <CallButton mode="hangup" label={copy.hangUp} onClick={call.hangUp} />}
        {state.phase === "ended" && <CallButton mode="again" label={copy.callAgain} onClick={call.callAgain} />}

        <p role="status" className="font-inter text-base text-muted">
          {state.typed && inCall ? `${status} · ${copy.typing}` : status}
        </p>
        <TypeInsteadButton label={copy.typeInstead} onClick={call.typeInstead} disabled={!canTypeInstead(state)} />
      </div>

      {state.showTypeHint && <p className="font-inter text-base text-text">{copy.typeHint}</p>}

      {state.typed && inCall && (
        <TypedInput
          enabled={canType(state)}
          label={copy.inputLabel}
          placeholder={copy.inputPlaceholder}
          sendLabel={copy.send}
          onSend={call.sendTyped}
        />
      )}

      <Transcript
        entries={state.transcript}
        interim={call.interim}
        notice={notice}
        labels={{
          title: copy.transcriptLabel,
          you: copy.you,
          receptionist: copy.receptionist,
          empty: copy.emptyTranscript,
        }}
      />
    </div>
  );
}

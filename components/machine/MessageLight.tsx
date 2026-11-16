import type { LightState } from "@/lib/messages/tape";

/**
 * The terracotta Message_Light (owner-machine 6.4, 13.4, 13.5). Blinks while anything is
 * unheard, stays lit while there are New_Messages, is off otherwise. The blink is on the
 * outer element and the flicker on the inner one, so their opacities multiply and drift.
 * With reduced motion neither class exists: the light is a steady light, and its state is
 * also in the live region next to it (13.2). `aria-hidden`: the text says it all.
 */
export function MessageLight({ state, reducedMotion }: { state: LightState; reducedMotion: boolean }) {
  const moving = state === "blinking" && !reducedMotion;
  const lit = state !== "off";
  return (
    <span
      data-light={state}
      aria-hidden="true"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold-dot bg-card p-1"
    >
      <span className={`block h-full w-full rounded-full ${moving ? "light-blink" : ""}`}>
        <span
          className={`block h-full w-full rounded-full ${moving ? "light-flicker" : ""} ${
            lit ? "bg-light shadow-[0_0_14px_rgb(182_95_69/0.6)]" : "bg-border"
          }`}
        />
      </span>
    </span>
  );
}

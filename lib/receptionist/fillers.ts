/**
 * The Fillers: short acknowledgements the Receptionist says while the reply is not audible yet
 * (front-desk-brain 18.3; design.md "New templates", L2). They are not replies: the Turn_API
 * never returns them and the Transcript never stores them. This module is plain data with no
 * import, so the Call_Page can bundle it without the phrase book or any shop data.
 */

export type FillerLang = "es" | "en";

/** `check` for a booking, a day or a time; `answer` for a question; `wait` for anything else (18.3). */
export type FillerKind = "check" | "answer" | "wait";

export const FILLER_KINDS: readonly FillerKind[] = ["check", "answer", "wait"];

/** Every Filler variant, per kind and language: at least 2 each, so two Turns in a row never repeat one (18.4). */
export const FILLERS: Readonly<Record<FillerLang, Readonly<Record<FillerKind, readonly [string, string, ...string[]]>>>> = {
  es: {
    check: ["A ver, déjame que mire…", "Vale, te miro…"],
    answer: ["Vale, mira…", "Pues mira…"],
    wait: ["Mm, un segundito…", "Vale…"],
  },
  en: {
    check: ["Let me check…", "Okay, one moment…"],
    answer: ["Okay, so…", "Right, so…"],
    wait: ["Just a second…", "Mm, okay…"],
  },
};

/** Every Filler text of a language, kind by kind, in a fixed order (the Cache_Plan's tier 6 reads this). */
export function fillerTexts(lang: FillerLang): { kind: FillerKind; index: number; text: string }[] {
  return FILLER_KINDS.flatMap((kind) => FILLERS[lang][kind].map((text, index) => ({ kind, index, text })));
}

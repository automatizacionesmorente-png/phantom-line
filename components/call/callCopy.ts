import type { Lang } from "@/lib/conversation/types";
import type { CallPhase } from "@/lib/voice/callLoop";

/**
 * The Call_Page's own interface text in both languages. What the receptionist
 * says comes from the server; these are only labels and status lines.
 */
export interface CallCopy {
  headingBefore: string;
  eyebrow: string;
  call: string;
  callAgain: string;
  hangUp: string;
  typeInstead: string;
  typing: string;
  inputLabel: string;
  inputPlaceholder: string;
  send: string;
  languageLabel: string;
  transcriptLabel: string;
  you: string;
  receptionist: string;
  emptyTranscript: string;
  typeHint: string;
  /** Shown instead of the line-cut notice when the Call never started (nothing was saved). */
  lineUnavailable: string;
  phase: Record<CallPhase, string>;
  ended: { complete: string; hangup: string; timeout: string };
}

export const CALL_COPY: Record<Lang, CallCopy> = {
  es: {
    headingBefore: "Llama a",
    eyebrow: "Contestador automático",
    call: "Llamar",
    callAgain: "Volver a llamar",
    hangUp: "Colgar",
    typeInstead: "Prefiero escribir",
    typing: "Escribiendo",
    inputLabel: "Tu mensaje",
    inputPlaceholder: "Escribe aquí lo que necesitas",
    send: "Enviar",
    languageLabel: "Idioma de la llamada",
    transcriptLabel: "Conversación",
    you: "Tú",
    receptionist: "Asistente virtual",
    emptyTranscript: "Pulsa Llamar y habla con normalidad. También puedes escribir.",
    typeHint: "No te oigo. Puedes seguir hablando o pulsar «Prefiero escribir».",
    lineUnavailable: "La línea no está disponible ahora mismo. Vuelve a intentarlo en unos minutos.",
    phase: {
      idle: "Listo para llamar",
      starting: "Llamando…",
      listening: "Te escucho…",
      thinking: "Un momento…",
      speaking: "Hablando…",
      typing: "Escríbeme tu respuesta",
      ended: "Llamada terminada",
    },
    ended: {
      complete: "Llamada terminada.",
      hangup: "Has colgado.",
      timeout: "Se ha cortado la llamada.",
    },
  },
  en: {
    headingBefore: "Call",
    eyebrow: "Answering machine",
    call: "Call",
    callAgain: "Call again",
    hangUp: "Hang up",
    typeInstead: "Type instead",
    typing: "Typing",
    inputLabel: "Your message",
    inputPlaceholder: "Type what you need here",
    send: "Send",
    languageLabel: "Call language",
    transcriptLabel: "Conversation",
    you: "You",
    receptionist: "Virtual assistant",
    emptyTranscript: "Press Call and speak normally. You can also type.",
    typeHint: "I can't hear you. Keep talking or press “Type instead”.",
    lineUnavailable: "The line isn't available right now. Please try again in a few minutes.",
    phase: {
      idle: "Ready to call",
      starting: "Calling…",
      listening: "Listening…",
      thinking: "One moment…",
      speaking: "Speaking…",
      typing: "Type your answer",
      ended: "Call ended",
    },
    ended: {
      complete: "Call ended.",
      hangup: "You hung up.",
      timeout: "The call dropped.",
    },
  },
};

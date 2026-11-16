import type { Lang } from "@/lib/sectors";

/**
 * Every label of the Machine_Page and the PIN_Gate, in Spanish and English (owner-machine
 * 6.8). Stored texts (reason, reply, Transcript) never come from here: they are shown as the
 * call wrote them, with their own `lang`.
 */
export interface MachineCopy {
  eyebrow: string;
  gate: {
    headingBefore: string;
    pinLabel: string;
    pinHint: string;
    nameLabel: string;
    namePlaceholder: string;
    open: string;
    opening: string;
    wrongPin: string;
    tooMany: string;
    cantOpen: string;
    notSetUp: string;
    notSetUpHint: string;
  };
  languageLabel: string;
  lock: string;
  counter: { youHave: string; noneBefore: string; noneGold: string };
  note: string;
  tabsLabel: string;
  tabs: { tape: string; agenda: string };
  controls: { label: string; play: string; next: string; erase: string; copy: string };
  emptyTape: string;
  player: { idle: string; end: string; nowPlaying: string };
  fields: {
    phone: string;
    reason: string;
    agreed: string;
    reply: string;
    transcript: string;
    caller: string;
    receptionist: string;
    noTranscript: string;
    loadingTranscript: string;
    noName: string;
    noPhone: string;
  };
  channel: { voice: string; whatsapp: string; webchat: string };
  sample: string;
  unheard: string;
  copied: string;
  copyFallback: string;
  offline: string;
  agenda: {
    label: string;
    today: string;
    nothing: (bookingWord: string) => string;
    status: { booked: string; confirmed: string; cancelled: string };
    actions: { confirm: string; move: string; cancel: string };
    by: { confirm: string; move: string; cancel: string };
    cancelledByCaller: string;
    working: string;
  };
  move: {
    title: (name: string, service: string) => string;
    day: string;
    times: string;
    loading: string;
    noSlots: string;
    submit: string;
    close: string;
  };
  cancel: {
    question: (name: string, service: string, day: string, time: string) => string;
    yes: string;
    no: string;
  };
  errors: {
    rejected: (reason: string) => string;
    reasons: Record<string, string>;
    taken: string;
    stale: string;
    notAllowed: string;
    failed: string;
  };
  at: (day: string, time: string) => string;
}

const lowerFirst = (s: string) => (s === "" ? s : s[0].toLowerCase() + s.slice(1));

export const MACHINE_COPY: Record<Lang, MachineCopy> = {
  es: {
    eyebrow: "Contestador",
    gate: {
      headingBefore: "El contestador de",
      pinLabel: "PIN de 6 cifras",
      pinHint: "El PIN que te dieron para este contestador.",
      nameLabel: "Tu nombre (opcional)",
      namePlaceholder: "Dueño",
      open: "Abrir el contestador",
      opening: "Abriendo…",
      wrongPin: "Ese PIN no abre este contestador.",
      tooMany: "Demasiados intentos, espera unos minutos.",
      cantOpen: "El contestador no se puede abrir ahora mismo.",
      notSetUp: "Este contestador aún no está configurado.",
      notSetUpHint: "Falta el PIN del dueño.",
    },
    languageLabel: "Idioma de la pantalla",
    lock: "Bloquear",
    counter: { youHave: "Tienes", noneBefore: "No tienes", noneGold: "mensajes nuevos" },
    note: "llamaron mientras atendías…",
    tabsLabel: "Vistas del contestador",
    tabs: { tape: "Cinta", agenda: "Agenda" },
    controls: { label: "Mandos de la cinta", play: "Escuchar", next: "Siguiente", erase: "Borrar", copy: "Copiar respuesta" },
    emptyTape: "No hay mensajes nuevos.",
    player: { idle: "Pulsa Escuchar para oír la cinta.", end: "Fin de la cinta.", nowPlaying: "Sonando" },
    fields: {
      phone: "Teléfono",
      reason: "Motivo",
      agreed: "Acordado",
      reply: "Respuesta sugerida",
      transcript: "Transcripción",
      caller: "Cliente",
      receptionist: "Asistente",
      noTranscript: "Esta llamada no tiene transcripción.",
      loadingTranscript: "Cargando la transcripción…",
      noName: "Sin nombre",
      noPhone: "Sin teléfono",
    },
    channel: { voice: "Llamada", whatsapp: "WhatsApp", webchat: "Chat web" },
    sample: "Ejemplo",
    unheard: "Sin escuchar",
    copied: "Respuesta copiada",
    copyFallback: "Pulsa Ctrl+C para copiar la respuesta.",
    offline: "Sin conexión, reintentando",
    agenda: {
      label: "Agenda de hoy y los próximos 7 días",
      today: "Hoy",
      nothing: (w) => `Sin ${w}s`,
      status: { booked: "Pendiente", confirmed: "Confirmada", cancelled: "Cancelada" },
      actions: { confirm: "Confirmar", move: "Mover", cancel: "Cancelar" },
      by: { confirm: "Confirmada por", move: "Movida por", cancel: "Cancelada por" },
      cancelledByCaller: "Cancelada por el cliente",
      working: "Guardando…",
    },
    move: {
      title: (name, service) => `Mover ${lowerFirst(service)} de ${name}`,
      day: "Día",
      times: "Horas libres",
      loading: "Buscando horas libres…",
      noSlots: "No hay horas libres ese día.",
      submit: "Mover",
      close: "Cerrar",
    },
    cancel: {
      question: (name, service, day, time) => `¿Cancelar ${lowerFirst(service)} de ${name}, el ${lowerFirst(day)} a las ${time}?`,
      yes: "Sí, cancelar",
      no: "No, dejarla",
    },
    errors: {
      rejected: (reason) => `Esa hora no es posible: ${reason}.`,
      reasons: {
        in_the_past: "ya ha pasado",
        closed_day: "ese día está cerrado",
        outside_hours: "está fuera del horario",
        does_not_fit: "no da tiempo antes de cerrar",
        all_resources_busy: "está todo ocupado",
        unknown_service: "el servicio ya no existe",
        outside_move_window: "está fuera de los próximos 14 días",
        not_movable: "ya no se puede mover",
      },
      taken: "Esa hora se acaba de ocupar.",
      stale: "Esta cita ha cambiado, aquí tienes la actual.",
      notAllowed: "Esta cita ya no se puede cambiar.",
      failed: "No se pudo guardar. Inténtalo de nuevo.",
    },
    at: (day, time) => `${day}, ${time}`,
  },
  en: {
    eyebrow: "Answering machine",
    gate: {
      headingBefore: "The answering machine of",
      pinLabel: "6-digit PIN",
      pinHint: "The PIN you were given for this machine.",
      nameLabel: "Your name (optional)",
      namePlaceholder: "Owner",
      open: "Open the machine",
      opening: "Opening…",
      wrongPin: "That PIN doesn't open this machine.",
      tooMany: "Too many tries, wait a few minutes.",
      cantOpen: "The machine can't open right now.",
      notSetUp: "This machine is not set up yet.",
      notSetUpHint: "The owner's PIN is missing.",
    },
    languageLabel: "Screen language",
    lock: "Lock",
    counter: { youHave: "You have", noneBefore: "You have", noneGold: "no new messages" },
    note: "they called while you were busy…",
    tabsLabel: "Machine views",
    tabs: { tape: "Tape", agenda: "Agenda" },
    controls: { label: "Tape controls", play: "Play", next: "Next", erase: "Erase", copy: "Copy reply" },
    emptyTape: "No new messages.",
    player: { idle: "Press Play to hear the tape.", end: "End of the tape.", nowPlaying: "Now playing" },
    fields: {
      phone: "Phone",
      reason: "Reason",
      agreed: "Agreed",
      reply: "Suggested reply",
      transcript: "Transcript",
      caller: "Caller",
      receptionist: "Assistant",
      noTranscript: "No transcript for this call.",
      loadingTranscript: "Loading the transcript…",
      noName: "No name",
      noPhone: "No phone",
    },
    channel: { voice: "Call", whatsapp: "WhatsApp", webchat: "Web chat" },
    sample: "Sample",
    unheard: "Not played yet",
    copied: "Reply copied",
    copyFallback: "Press Ctrl+C to copy the reply.",
    offline: "Offline, retrying",
    agenda: {
      label: "Agenda for today and the next 7 days",
      today: "Today",
      nothing: () => "Nothing booked",
      status: { booked: "Booked", confirmed: "Confirmed", cancelled: "Cancelled" },
      actions: { confirm: "Confirm", move: "Move", cancel: "Cancel" },
      by: { confirm: "Confirmed by", move: "Moved by", cancel: "Cancelled by" },
      cancelledByCaller: "Cancelled by the customer",
      working: "Saving…",
    },
    move: {
      title: (name, service) => `Move ${name}'s ${lowerFirst(service)}`,
      day: "Day",
      times: "Free times",
      loading: "Looking for free times…",
      noSlots: "No free times that day.",
      submit: "Move",
      close: "Close",
    },
    cancel: {
      question: (name, service, day, time) => `Cancel ${name}'s ${lowerFirst(service)} on ${day} at ${time}?`,
      yes: "Yes, cancel",
      no: "No, keep it",
    },
    errors: {
      rejected: (reason) => `That time isn't possible: ${reason}.`,
      reasons: {
        in_the_past: "it has already passed",
        closed_day: "the shop is closed that day",
        outside_hours: "it is outside opening hours",
        does_not_fit: "it doesn't fit before closing",
        all_resources_busy: "everything is taken",
        unknown_service: "the service no longer exists",
        outside_move_window: "it is beyond the next 14 days",
        not_movable: "it can no longer be moved",
      },
      taken: "That time was just taken.",
      stale: "This booking changed, here is the current one.",
      notAllowed: "This booking can't be changed any more.",
      failed: "Couldn't save. Try again.",
    },
    at: (day, time) => `${day}, ${time}`,
  },
};

/** The reason text of a `rejected` answer; a sector rule's own code reads as "not possible". */
export function rejectionText(copy: MachineCopy, reason: string): string {
  return copy.errors.rejected(copy.errors.reasons[reason] ?? (copy === MACHINE_COPY.es ? "no se puede" : "not allowed"));
}

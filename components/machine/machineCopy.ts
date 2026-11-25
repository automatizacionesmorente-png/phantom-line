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
  tabs: { today: string; clients: string; business: string; settings: string; tape: string };
  today: { messages: string; back: string };
    settings: { title: string; soon: string };
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
  channel: { voice: string; whatsapp: string; webchat: string; manual: string };
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
  clients: {
    label: string;
    loading: string;
    empty: string;
    failed: string;
    visits: (n: number) => string;
    lastVisit: (date: string) => string;
    noVisitsYet: string;
    noShows: (n: number) => string;
    usual: string;
    history: string;
    noHistory: string;
    state: { visit: string; no_show: string; cancelled: string; upcoming: string };
    markNoShow: string;
    undoNoShow: string;
    note: string;
    notePlaceholder: string;
    noteHint: (left: number) => string;
    save: string;
    saving: string;
    saved: string;
    lapsedTitle: string;
    lapsedHint: string;
    lapsedNone: string;
    lapsedLine: (days: number, interval: number) => string;
    whatsapp: (name: string) => string;
    suggested: string;
    open: string;
    close: string;
    search: string;
    noMatches: string;
    saveFields: string;
    spent: (amount: string) => string;
    birthday: string;
    birthdayDay: string;
    birthdayMonth: string;
    birthdayNone: string;
    months: readonly string[];
    consent: string;
    consentHint: string;
    consentSince: (date: string) => string;
    consentOff: string;
    extra: string;
    paid: (amount: string) => string;
    unpaid: string;
    savedField: string;
  };
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
    tabs: { today: "Hoy", clients: "Clientes", business: "Mi negocio", settings: "Ajustes", tape: "Cinta" },
    today: { messages: "Mensajes nuevos", back: "Volver" },
    settings: { title: "Ajustes", soon: "Aquí ajustarás tu recepcionista." },
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
    channel: { voice: "Llamada", whatsapp: "WhatsApp", webchat: "Chat web", manual: "A mano" },
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
    clients: {
      label: "Clientes del salón",
      loading: "Cargando los clientes…",
      empty: "Aún no hay clientes. Aparecen solos cuando alguien da su nombre y teléfono.",
      failed: "No se pudieron cargar los clientes.",
      visits: (n) => (n === 1 ? "1 visita" : `${n} visitas`),
      lastVisit: (date) => `Última: ${date}`,
      noVisitsYet: "Aún sin visitas",
      noShows: (n) => (n === 1 ? "1 vez no vino" : `${n} veces no vino`),
      usual: "Lo de siempre",
      history: "Historial",
      noHistory: "Sin citas todavía.",
      state: { visit: "Vino", no_show: "No vino", cancelled: "Cancelada", upcoming: "Próxima" },
      markNoShow: "No vino",
      undoNoShow: "Quitar «No vino»",
      note: "Importante / alergias",
      notePlaceholder: "Solo la ves tú: alergias, manías, lo que quieras recordar.",
      noteHint: (left) => `${left} caracteres restantes`,
      save: "Guardar nota",
      saving: "Guardando…",
      saved: "Nota guardada",
      lapsedTitle: "Clientes que no han vuelto",
      lapsedHint: "Hace más de lo habitual que no vienen. Un toque y se abre WhatsApp con el mensaje listo.",
      lapsedNone: "Nadie por recuperar ahora mismo.",
      lapsedLine: (days, interval) => `Hace ${days} días (suele venir cada ${interval})`,
      whatsapp: (name) => `Escribir a ${name} por WhatsApp`,
      suggested: "Mensaje sugerido",
      open: "Ver ficha",
      close: "Cerrar ficha",
      search: "Buscar por nombre o teléfono",
      noMatches: "Nadie coincide con esa búsqueda.",
      saveFields: "Guardar datos",
      spent: (amount) => `Ha gastado ${amount}`,
      birthday: "Cumpleaños",
      birthdayDay: "Día",
      birthdayMonth: "Mes",
      birthdayNone: "Sin indicar",
      months: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
      consent: "Acepta promociones",
      consentHint: "Solo si lo ha aceptado le escribirás con ofertas o felicitaciones.",
      consentSince: (date) => `Aceptó el ${date}`,
      consentOff: "No ha aceptado promociones",
      extra: "Datos del cliente",
      paid: (amount) => `Pagado ${amount}`,
      unpaid: "Sin cobrar",
      savedField: "Guardado",
    },
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
    tabs: { today: "Today", clients: "Clients", business: "My business", settings: "Settings", tape: "Tape" },
    today: { messages: "New messages", back: "Back" },
    settings: { title: "Settings", soon: "You will tune your receptionist here." },
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
    channel: { voice: "Call", whatsapp: "WhatsApp", webchat: "Web chat", manual: "By hand" },
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
    clients: {
      label: "Salon clients",
      loading: "Loading clients…",
      empty: "No clients yet. They appear by themselves when someone gives a name and phone.",
      failed: "Couldn't load the clients.",
      visits: (n) => (n === 1 ? "1 visit" : `${n} visits`),
      lastVisit: (date) => `Last: ${date}`,
      noVisitsYet: "No visits yet",
      noShows: (n) => (n === 1 ? "1 no-show" : `${n} no-shows`),
      usual: "The usual",
      history: "History",
      noHistory: "No bookings yet.",
      state: { visit: "Came", no_show: "Didn't come", cancelled: "Cancelled", upcoming: "Upcoming" },
      markNoShow: "Didn't come",
      undoNoShow: "Undo \"Didn't come\"",
      note: "Important / allergies",
      notePlaceholder: "Only you see it: allergies, quirks, anything you want to remember.",
      noteHint: (left) => `${left} characters left`,
      save: "Save note",
      saving: "Saving…",
      saved: "Note saved",
      lapsedTitle: "Clients who haven't come back",
      lapsedHint: "It has been longer than usual. One tap opens WhatsApp with the message ready.",
      lapsedNone: "Nobody to win back right now.",
      lapsedLine: (days, interval) => `${days} days ago (usually every ${interval})`,
      whatsapp: (name) => `Message ${name} on WhatsApp`,
      suggested: "Suggested message",
      open: "Open card",
      close: "Close card",
      search: "Search by name or phone",
      noMatches: "Nobody matches that search.",
      saveFields: "Save details",
      spent: (amount) => `Has spent ${amount}`,
      birthday: "Birthday",
      birthdayDay: "Day",
      birthdayMonth: "Month",
      birthdayNone: "Not set",
      months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      consent: "Accepts promotions",
      consentHint: "You only message them with offers or greetings if they have agreed.",
      consentSince: (date) => `Agreed on ${date}`,
      consentOff: "Has not agreed to promotions",
      extra: "Client details",
      paid: (amount) => `Paid ${amount}`,
      unpaid: "Unpaid",
      savedField: "Saved",
    },
  },
};

/** The reason text of a `rejected` answer; a sector rule's own code reads as "not possible". */
export function rejectionText(copy: MachineCopy, reason: string): string {
  return copy.errors.rejected(copy.errors.reasons[reason] ?? (copy === MACHINE_COPY.es ? "no se puede" : "not allowed"));
}

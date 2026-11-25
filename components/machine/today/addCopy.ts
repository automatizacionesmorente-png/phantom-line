import type { Lang } from "@/lib/sectors";

export type PayMethod = "cash" | "card" | "bizum" | "voucher";

export interface AddCopy {
  add: { label: string; menu: string; newBooking: (bookingWord: string) => string; block: string };
  common: { close: string; back: string; next: string; failed: string; worker: string; day: string; time: string };
  booking: {
    title: (bookingWord: string) => string;
    steps: [string, string, string];
    step: (n: number, of: number, name: string) => string;
    service: string;
    client: string;
    clientHint: string;
    phone: string;
    phoneHint: string;
    summary: (when: string, worker: string, service: string) => string;
    submit: string;
    working: string;
    errors: {
      taken: string;
      in_the_past: string;
      too_far: string;
      closed: string;
      outside_hours: string;
      blocked: string;
      invalid_request: string;
      bad_time: string;
    };
  };
  block: {
    title: string;
    who: string;
    wholeShop: string;
    from: string;
    to: string;
    quick: string;
    wholeToday: string;
    wholeTomorrow: string;
    reason: string;
    reasons: { rest: string; doctor: string; holidays: string; other: string };
    other: string;
    submit: string;
    working: string;
    done: string;
    overlapTitle: (n: number, bookingWord: string, more: boolean) => string;
    overlapHint: string;
    overlapMore: string;
    ok: string;
    errors: { bad_range: string; too_far: string; too_long: string; limit_reached: string; invalid_request: string };
  };
  pay: {
    title: (name: string) => string;
    amount: string;
    amountHint: string;
    method: string;
    methods: Record<PayMethod, string>;
    addProduct: string;
    removeProduct: string;
    productLabel: string;
    productAmount: string;
    total: (amount: string) => string;
    submit: (amount: string) => string;
    working: string;
    errors: { bad_amount: string; no_method: string; already_paid: string; cancelled: string; not_yet: string; booking_not_found: string; invalid_request: string };
  };
}

export const ADD_COPY: Record<Lang, AddCopy> = {
  es: {
    add: {
      label: "Añadir",
      menu: "Qué quieres añadir",
      newBooking: (w) => `Nueva ${w}`,
      block: "Bloquear horas",
    },
    common: { close: "Cerrar", back: "Atrás", next: "Siguiente", failed: "No se pudo guardar. Inténtalo de nuevo.", worker: "Agenda de", day: "Día", time: "Hora" },
    booking: {
      title: (w) => `Nueva ${w}`,
      steps: ["Hora y quién", "Servicio", "Cliente"],
      step: (n, of, name) => `Paso ${n} de ${of}: ${name}`,
      service: "Elige el servicio",
      client: "Cliente",
      clientHint: "Busca un cliente o escribe un nombre",
      phone: "Teléfono (opcional)",
      phoneHint: "Sin teléfono no se guarda la ficha del cliente.",
      summary: (when, worker, service) => `${service} · ${when} · ${worker}`,
      submit: "Reservar",
      working: "Guardando…",
      errors: {
        taken: "Ese hueco se acaba de ocupar. He recargado la agenda: elige otra hora.",
        in_the_past: "Esa hora ya ha pasado. Elige una hora de hoy en adelante.",
        too_far: "Solo se puede reservar hasta dentro de un año.",
        closed: "Ese día el local está cerrado.",
        outside_hours: "Esa hora cae fuera del horario o no cabe el servicio.",
        blocked: "Esa hora está bloqueada.",
        invalid_request: "Revisa el nombre y el teléfono.",
        bad_time: "Escribe un día y una hora válidos.",
      },
    },
    block: {
      title: "Bloquear horas",
      who: "A quién afecta",
      wholeShop: "Todo el local",
      from: "Desde",
      to: "Hasta",
      quick: "Día entero",
      wholeToday: "Hoy entero",
      wholeTomorrow: "Mañana entero",
      reason: "Motivo",
      reasons: { rest: "Descanso", doctor: "Médico", holidays: "Vacaciones", other: "Otro" },
      other: "Escribe el motivo",
      submit: "Bloquear",
      working: "Guardando…",
      done: "Horas bloqueadas.",
      overlapTitle: (n, w, more) => `Ojo: ${more ? "más de " : ""}${n} ${w}${n === 1 ? "" : "s"} caen dentro del bloqueo`,
      overlapHint: "El bloqueo se ha guardado, pero estas citas siguen en la agenda. Muévelas o cancélalas si hace falta.",
      overlapMore: "Hay más; revisa la agenda de esos días.",
      ok: "Entendido",
      errors: {
        bad_range: "La hora final tiene que ser posterior a la inicial.",
        too_far: "No se puede bloquear a más de un año vista.",
        too_long: "El bloqueo es demasiado largo (máximo 400 días).",
        limit_reached: "Has llegado al máximo de bloqueos. Borra alguno antiguo.",
        invalid_request: "Revisa las fechas y el motivo.",
      },
    },
    pay: {
      title: (name) => `Cobrar a ${name}`,
      amount: "Importe del servicio (€)",
      amountHint: "Ya viene con el precio; puedes cambiarlo.",
      method: "Forma de pago",
      methods: { cash: "Efectivo", card: "Tarjeta", bizum: "Bizum", voucher: "Bono" },
      addProduct: "Añadir producto",
      removeProduct: "Quitar producto",
      productLabel: "Producto (opcional)",
      productAmount: "Importe del producto (€)",
      total: (a) => `Total: ${a}`,
      submit: (a) => `Cobrar ${a}`,
      working: "Cobrando…",
      errors: {
        bad_amount: "Escribe un importe válido, por ejemplo 15 o 15,50.",
        no_method: "Elige cómo ha pagado.",
        already_paid: "Esta cita ya estaba cobrada.",
        cancelled: "Esta cita está cancelada y no se puede cobrar.",
        not_yet: "Todavía falta mucho para esta cita: no se puede cobrar aún.",
        booking_not_found: "No encuentro esta cita.",
        invalid_request: "Revisa los importes.",
      },
    },
  },
  en: {
    add: {
      label: "Add",
      menu: "What to add",
      newBooking: (w) => `New ${w}`,
      block: "Block time",
    },
    common: { close: "Close", back: "Back", next: "Next", failed: "Could not save. Try again.", worker: "Schedule of", day: "Day", time: "Time" },
    booking: {
      title: (w) => `New ${w}`,
      steps: ["Time and who", "Service", "Client"],
      step: (n, of, name) => `Step ${n} of ${of}: ${name}`,
      service: "Pick the service",
      client: "Client",
      clientHint: "Search a client or type a name",
      phone: "Phone (optional)",
      phoneHint: "Without a phone no client card is saved.",
      summary: (when, worker, service) => `${service} · ${when} · ${worker}`,
      submit: "Book it",
      working: "Saving…",
      errors: {
        taken: "That slot was just taken. I reloaded the schedule: pick another time.",
        in_the_past: "That time has passed. Pick a time from today on.",
        too_far: "You can only book up to a year ahead.",
        closed: "The shop is closed that day.",
        outside_hours: "That time is outside opening hours or the service does not fit.",
        blocked: "That time is blocked.",
        invalid_request: "Check the name and the phone.",
        bad_time: "Enter a valid day and time.",
      },
    },
    block: {
      title: "Block time",
      who: "Who is affected",
      wholeShop: "The whole shop",
      from: "From",
      to: "To",
      quick: "Whole day",
      wholeToday: "All of today",
      wholeTomorrow: "All of tomorrow",
      reason: "Reason",
      reasons: { rest: "Break", doctor: "Doctor", holidays: "Holidays", other: "Other" },
      other: "Write the reason",
      submit: "Block",
      working: "Saving…",
      done: "Time blocked.",
      overlapTitle: (n, w, more) => `Careful: ${more ? "more than " : ""}${n} ${w}${n === 1 ? "" : "s"} fall inside the block`,
      overlapHint: "The block is saved, but these are still in the schedule. Move or cancel them if needed.",
      overlapMore: "There are more; check the schedule for those days.",
      ok: "Got it",
      errors: {
        bad_range: "The end must be after the start.",
        too_far: "You cannot block more than a year ahead.",
        too_long: "The block is too long (400 days at most).",
        limit_reached: "You reached the maximum number of blocks. Delete an old one.",
        invalid_request: "Check the dates and the reason.",
      },
    },
    pay: {
      title: (name) => `Take payment from ${name}`,
      amount: "Service amount (€)",
      amountHint: "Pre-filled with the price; you can change it.",
      method: "How they paid",
      methods: { cash: "Cash", card: "Card", bizum: "Bizum", voucher: "Voucher" },
      addProduct: "Add a product",
      removeProduct: "Remove product",
      productLabel: "Product (optional)",
      productAmount: "Product amount (€)",
      total: (a) => `Total: ${a}`,
      submit: (a) => `Take ${a}`,
      working: "Taking payment…",
      errors: {
        bad_amount: "Enter a valid amount, like 15 or 15.50.",
        no_method: "Pick how they paid.",
        already_paid: "This booking was already paid.",
        cancelled: "This booking is cancelled and cannot be paid.",
        not_yet: "This booking is still far off: it cannot be paid yet.",
        booking_not_found: "I cannot find this booking.",
        invalid_request: "Check the amounts.",
      },
    },
  },
};

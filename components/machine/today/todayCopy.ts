import type { Lang } from "@/lib/sectors";
import type { BookingState } from "@/lib/salon/state";

export interface TodayCopy {
  label: string;
  kpi: {
    appointments: (bookingWord: string) => string;
    free: string;
    takings: string;
    messages: string;
  };
  nav: { prev: string; next: string; today: string; day: string; week: string; mode: string };
  worker: string;
  gap: (from: string, to: string) => string;
  blocked: string;
  allergy: string;
  nowLine: string;
  empty: (bookingWord: string) => string;
  weekCount: (n: number, bookingWord: string) => string;
  cash: {
    title: string;
    empty: string;
    total: string;
    methods: { cash: string; card: string; bizum: string; voucher: string };
    failed: string;
  };
  sheet: {
    close: string;
    client: string;
    clientNote: string;
    state: Record<BookingState, string>;
    noShow: string;
    undoNoShow: string;
    pay: string;
    openClient: string;
    visitNote: string;
    saveNote: string;
    noteSaved: string;
    price: string;
    failed: string;
  };
}

export const TODAY_COPY: Record<Lang, TodayCopy> = {
  es: {
    label: "Hoy",
    kpi: {
      appointments: (w) => `${w.charAt(0).toUpperCase()}${w.slice(1)}s hoy`,
      free: "Huecos libres",
      takings: "Cobro previsto",
      messages: "Mensajes nuevos",
    },
    nav: { prev: "Día anterior", next: "Día siguiente", today: "Hoy", day: "Día", week: "Semana", mode: "Vista" },
    worker: "Agenda de",
    gap: (a, b) => `Hueco libre de ${a} a ${b}`,
    blocked: "Bloqueado",
    allergy: "Nota importante del cliente",
    nowLine: "Hora actual",
    empty: (w) => `Sin ${w}s`,
    weekCount: (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`,
    cash: {
      title: "Caja de hoy",
      empty: "Todavía no has cobrado nada hoy.",
      total: "Total",
      methods: { cash: "Efectivo", card: "Tarjeta", bizum: "Bizum", voucher: "Bono" },
      failed: "No se pudo cargar la caja.",
    },
    sheet: {
      close: "Cerrar",
      client: "Cliente",
      clientNote: "Nota del cliente",
      state: {
        pending: "Pendiente",
        confirmed: "Confirmada",
        done: "Cobrada",
        no_show: "No vino",
        to_collect: "Por cobrar",
        cancelled: "Cancelada",
      },
      noShow: "No vino",
      undoNoShow: "Deshacer «No vino»",
      pay: "Cobrar",
      openClient: "Ver ficha",
      visitNote: "Nota de la visita",
      saveNote: "Guardar nota",
      noteSaved: "Nota guardada",
      price: "Precio",
      failed: "No se pudo guardar. Prueba otra vez.",
    },
  },
  en: {
    label: "Today",
    kpi: {
      appointments: (w) => `${w.charAt(0).toUpperCase()}${w.slice(1)}s today`,
      free: "Free slots",
      takings: "Expected takings",
      messages: "New messages",
    },
    nav: { prev: "Previous day", next: "Next day", today: "Today", day: "Day", week: "Week", mode: "View" },
    worker: "Schedule of",
    gap: (a, b) => `Free from ${a} to ${b}`,
    blocked: "Blocked",
    allergy: "Important client note",
    nowLine: "Current time",
    empty: (w) => `No ${w}s`,
    weekCount: (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`,
    cash: {
      title: "Today's cash",
      empty: "Nothing collected yet today.",
      total: "Total",
      methods: { cash: "Cash", card: "Card", bizum: "Bizum", voucher: "Voucher" },
      failed: "Could not load the cash desk.",
    },
    sheet: {
      close: "Close",
      client: "Client",
      clientNote: "Client note",
      state: {
        pending: "Pending",
        confirmed: "Confirmed",
        done: "Paid",
        no_show: "No-show",
        to_collect: "To collect",
        cancelled: "Cancelled",
      },
      noShow: "No-show",
      undoNoShow: "Undo no-show",
      pay: "Take payment",
      openClient: "Client card",
      visitNote: "Visit note",
      saveNote: "Save note",
      noteSaved: "Note saved",
      price: "Price",
      failed: "Could not save. Try again.",
    },
  },
};

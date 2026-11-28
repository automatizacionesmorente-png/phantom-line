import type { Lang } from "@/lib/sectors";
import type { ExpenseCategory } from "@/lib/salon/month";

/** The My business tab's words (salon spec 2.3). Pure, so tests can read them. */
export interface BusinessCopy {
  title: string;
  loading: string;
  failed: string;
  month: { prev: string; next: string; nav: string };
  big: { taken: string; expenses: string; left: string };
  takenFormula: string;
  expensesFormula: string;
  leftFormula: string;
  /** "12 % more than last month", with the arrow for sighted users. */
  moreThan: (pct: number, soFar?: boolean) => string;
  lessThan: (pct: number, soFar?: boolean) => string;
  same: (soFar?: boolean) => string;
  receptionist: {
    title: string;
    calls: string;
    callsFormula: string;
    booked: string;
    bookedFormula: string;
    value: string;
    valueFormula: string;
    phone: string;
    phoneFormula: (calls: number, total: string) => string;
    gaps: string;
    gapsFormula: string;
  };
  weeks: string;
  weeksFormula: string;
  workers: string;
  services: string;
  servicesCount: (n: number) => string;
  noShows: (n: number) => string;
  noShowsFormula: string;
  empty: string;
  expenses: {
    title: string;
    add: string;
    empty: string;
    monthly: string;
    delete: (concept: string) => string;
    confirm: string;
    confirmMonthly: string;
    yes: string;
    no: string;
    deleteFailed: string;
    total: (v: string) => string;
  };
  form: {
    title: string;
    concept: string;
    amount: string;
    amountHint: string;
    day: string;
    category: string;
    recurring: string;
    recurringHint: string;
    save: string;
    saving: string;
    cancel: string;
    errors: { concept: string; amount: string; day: string; failed: string };
  };
  categories: Record<ExpenseCategory, string>;
  accountant: { download: string; print: string; hint: string; printTitle: (shop: string, month: string) => string };
}

export const BUSINESS_COPY: Record<Lang, BusinessCopy> = {
  es: {
    title: "Mi negocio",
    loading: "Cargando el mes…",
    failed: "No se pudo cargar el mes. Se reintentará solo.",
    month: { prev: "Mes anterior", next: "Mes siguiente", nav: "Mes" },
    big: { taken: "Has cobrado", expenses: "Gastos", left: "Te queda" },
    takenFormula: "Has cobrado = suma de lo cobrado en las citas y ventas del mes.",
    expensesFormula: "Gastos = gastos sueltos del mes más los fijos que están activos ese mes.",
    leftFormula: "Te queda = cobrado menos gastos.",
    moreThan: (p, soFar) => `${p} % más que el mes pasado${soFar ? " a esta altura" : ""}`,
    lessThan: (p, soFar) => `${p} % menos que el mes pasado${soFar ? " a esta altura" : ""}`,
    same: (soFar) => `igual que el mes pasado${soFar ? " a esta altura" : ""}`,
    receptionist: {
      title: "Lo que ha hecho tu recepcionista este mes",
      calls: "Llamadas atendidas",
      callsFormula: "Llamadas atendidas = llamadas del mes.",
      booked: "Citas que ha cerrado",
      bookedFormula: "Citas que ha cerrado = citas hechas por la recepcionista este mes, sin contar las canceladas.",
      value: "Valor de esas citas",
      valueFormula: "Valor de esas citas = suma de los precios de esas citas cuando se reservaron.",
      phone: "Teléfono ahorrado",
      phoneFormula: (n, total) => `Teléfono ahorrado = suma de la duración real de ${n === 1 ? "la llamada" : `las ${n} llamadas`}: ${total}.`,
      gaps: "Huecos rellenados",
      gapsFormula: "Huecos rellenados = clientas que reservaron en las 72 h siguientes a un aviso de hueco libre que enviaste.",
    },
    weeks: "Cobrado por semana",
    weeksFormula: "Cada barra suma lo cobrado en esa semana del mes.",
    workers: "Por persona",
    services: "Servicios más pedidos",
    servicesCount: (n) => (n === 1 ? "1 vez" : `${n} veces`),
    noShows: (n) => (n === 1 ? "1 no vino" : `${n} no vinieron`),
    noShowsFormula: "No vinieron = citas del mes marcadas como \"no vino\".",
    empty: "Aún no hay nada cobrado este mes.",
    expenses: {
      title: "Gastos",
      add: "+ Gasto",
      empty: "No hay gastos este mes.",
      monthly: "Se repite cada mes",
      delete: (c) => `Borrar ${c}`,
      confirm: "¿Borrar este gasto?",
      confirmMonthly: "Es fijo: desaparece de todos los meses. ¿Borrarlo?",
      yes: "Sí, borrar",
      no: "No",
      deleteFailed: "No se pudo borrar. Inténtalo otra vez.",
      total: (v) => `Total ${v}`,
    },
    form: {
      title: "Nuevo gasto",
      concept: "Concepto",
      amount: "Importe",
      amountHint: "En euros, por ejemplo 45,50",
      day: "Fecha",
      category: "Categoría",
      recurring: "Se repite cada mes",
      recurringHint: "Para el alquiler y otros gastos fijos. Cuenta desde esa fecha en adelante.",
      save: "Guardar gasto",
      saving: "Guardando…",
      cancel: "Cancelar",
      errors: {
        concept: "Escribe en qué has gastado.",
        amount: "Escribe un importe válido, por ejemplo 45,50.",
        day: "Elige la fecha (como mucho dentro de un año).",
        failed: "No se pudo guardar. Inténtalo otra vez.",
      },
    },
    categories: { rent: "Alquiler", products: "Productos", utilities: "Suministros", staff: "Personal", other: "Otros" },
    accountant: {
      download: "Descargar para la gestoría",
      print: "Imprimir",
      hint: "El CSV trae lo cobrado y los gastos del mes, con IVA incluido; revísalo con tu gestor.",
      printTitle: (shop, month) => `${shop}: cierre de ${month}`,
    },
  },
  en: {
    title: "My business",
    loading: "Loading the month…",
    failed: "The month could not be loaded. It will retry by itself.",
    month: { prev: "Previous month", next: "Next month", nav: "Month" },
    big: { taken: "Taken", expenses: "Expenses", left: "Left" },
    takenFormula: "Taken = sum of what was collected on appointments and sales this month.",
    expensesFormula: "Expenses = the month's one-off expenses plus the monthly ones active that month.",
    leftFormula: "Left = taken minus expenses.",
    moreThan: (p, soFar) => `${p}% more than last month${soFar ? " at this point" : ""}`,
    lessThan: (p, soFar) => `${p}% less than last month${soFar ? " at this point" : ""}`,
    same: (soFar) => `same as last month${soFar ? " at this point" : ""}`,
    receptionist: {
      title: "What your receptionist did this month",
      calls: "Calls answered",
      callsFormula: "Calls answered = calls of the month.",
      booked: "Appointments it booked",
      bookedFormula: "Appointments it booked = bookings made by the receptionist this month, not counting cancelled ones.",
      value: "Value of those bookings",
      valueFormula: "Value of those bookings = sum of those bookings' prices when they were made.",
      phone: "Phone time saved",
      phoneFormula: (n, total) => `Phone time saved = sum of the real duration of ${n === 1 ? "the call" : `the ${n} calls`}: ${total}.`,
      gaps: "Gaps refilled",
      gapsFormula: "Gaps refilled = clients who booked within 72 h of a free-slot message you sent.",
    },
    weeks: "Taken by week",
    weeksFormula: "Each bar adds up what was collected that week of the month.",
    workers: "By person",
    services: "Top services",
    servicesCount: (n) => (n === 1 ? "1 time" : `${n} times`),
    noShows: (n) => (n === 1 ? "1 no-show" : `${n} no-shows`),
    noShowsFormula: "No-shows = the month's bookings marked as no-show.",
    empty: "Nothing has been taken this month yet.",
    expenses: {
      title: "Expenses",
      add: "+ Expense",
      empty: "No expenses this month.",
      monthly: "Repeats every month",
      delete: (c) => `Delete ${c}`,
      confirm: "Delete this expense?",
      confirmMonthly: "It is a monthly one: it disappears from every month. Delete it?",
      yes: "Yes, delete",
      no: "No",
      deleteFailed: "Could not delete. Try again.",
      total: (v) => `Total ${v}`,
    },
    form: {
      title: "New expense",
      concept: "Concept",
      amount: "Amount",
      amountHint: "In euros, for example 45.50",
      day: "Date",
      category: "Category",
      recurring: "Repeats every month",
      recurringHint: "For rent and other fixed costs. It counts from that date on.",
      save: "Save expense",
      saving: "Saving…",
      cancel: "Cancel",
      errors: {
        concept: "Write what you spent on.",
        amount: "Enter a valid amount, for example 45.50.",
        day: "Pick the date (a year ahead at most).",
        failed: "Could not save. Try again.",
      },
    },
    categories: { rent: "Rent", products: "Products", utilities: "Utilities", staff: "Staff", other: "Other" },
    accountant: {
      download: "Download for the accountant",
      print: "Print",
      hint: "The CSV has the month's takings and expenses, VAT included; check it with your accountant.",
      printTitle: (shop, month) => `${shop}: ${month} month-end`,
    },
  },
};

/** "45,50" or "45.50" (up to two decimals) to cents; null when it is not an amount. */
export function parseAmountCents(raw: string): number | null {
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return cents >= 1 && cents <= 10_000_000 ? cents : null;
}

/** "noviembre de 2026" / "November 2026", first letter capital. */
export function monthLabel(month: string, lang: Lang): string {
  const [y, m] = month.split("-").map(Number);
  const s = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const dayShort = (iso: string, lang: Lang): string =>
  new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** "Sem. 2–8 nov" / "Wk 2–8 Nov" from the report's "2-8" (or "30") week label and its month. */
export function weekRangeLabel(label: string, month: string, lang: Lang): string {
  const [y, m] = month.split("-").map(Number);
  const mon = new Intl.DateTimeFormat(lang, { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 1)))
    .replace(/\.$/, "");
  const range = label.replace("-", "\u2013");
  return `${lang === "es" ? "Sem." : "Wk"} ${range} ${mon}`;
}

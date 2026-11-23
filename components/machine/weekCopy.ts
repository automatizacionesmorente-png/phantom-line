import type { Lang } from "@/lib/sectors";
import type { WeekStats } from "@/lib/owner/weekStats";

/** The "Últimos 7 días" panel's words and number formats (BACKLOG 17), pure so tests can read them. */
export interface WeekCopy {
  title: string;
  range: (from: string, to: string) => string;
  answered: string;
  bookings: string;
  revenue: string;
  lost: string;
  saved: string;
  answeredNote: string;
  bookingsNote: string;
  revenueNote: string;
  lostNote: string;
  from: string;
  loadFailed: string;
  /** The time-saved formula, always shown with its inputs. */
  formula: (calls: number, total: string, average: string) => string;
}

export const WEEK_COPY: Record<Lang, WeekCopy> = {
  es: {
    title: "Últimos 7 días",
    range: (a, b) => `del ${a} al ${b}`,
    answered: "Llamadas atendidas",
    bookings: "Citas hechas",
    revenue: "Facturación reservada",
    lost: "Llamadas que habrías perdido",
    saved: "Tiempo ahorrado",
    answeredNote: "Sin contar las que fallaron.",
    bookingsNote: "Las que cerró la recepcionista, sin cancelar.",
    revenueNote: "Suma de los precios del catálogo de esas citas, combos incluidos.",
    lostNote: "Fuera de horario o con otra llamada en curso.",
    from: "desde",
    loadFailed: "No se pudieron cargar los números de la semana.",
    formula: (n, total, avg) =>
      `Tiempo ahorrado = suma de la duración (fin menos inicio) de ${n === 1 ? "la llamada terminada" : `las ${n} llamadas terminadas`}: ${total}, ${avg} de media.`,
  },
  en: {
    title: "Last 7 days",
    range: (a, b) => `${a} to ${b}`,
    answered: "Calls answered",
    bookings: "Bookings made",
    revenue: "Revenue booked",
    lost: "Calls you would have lost",
    saved: "Time saved",
    answeredNote: "Not counting the ones that failed.",
    bookingsNote: "Made by the receptionist, not cancelled.",
    revenueNote: "Sum of the catalogue prices of those bookings, combos included.",
    lostNote: "Outside opening hours or while another call was in progress.",
    from: "from",
    loadFailed: "The week's numbers could not be loaded.",
    formula: (n, total, avg) =>
      `Time saved = sum of the duration (end minus start) of ${n === 1 ? "the finished call" : `the ${n} finished calls`}: ${total}, ${avg} on average.`,
  },
};

/** "1 h 25 min", "42 min", "under 1 min". Rounded to the minute; never negative. */
export function formatDuration(seconds: number, lang: Lang): string {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  if (minutes < 1) return lang === "es" ? "menos de 1 min" : "under 1 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "1.234 €" / "€1,234": whole euros when there are no cents. */
export function formatRevenue(cents: number, lang: Lang): string {
  return new Intl.NumberFormat(lang, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** The time-saved formula with its real inputs, or null when it cannot be computed. */
export function savedFormula(stats: Pick<WeekStats, "timeSavedSeconds" | "timedCalls">, lang: Lang): string | null {
  if (stats.timeSavedSeconds === null || stats.timedCalls < 1) return null;
  return WEEK_COPY[lang].formula(
    stats.timedCalls,
    formatDuration(stats.timeSavedSeconds, lang),
    formatDuration(stats.timeSavedSeconds / stats.timedCalls, lang),
  );
}

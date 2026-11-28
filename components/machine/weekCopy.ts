import type { Lang } from "@/lib/sectors";

/** Duration and euro formats shared by the Today and My business screens. */
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
    useGrouping: "always",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

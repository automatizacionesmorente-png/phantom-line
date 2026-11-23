import type { Lang } from "@/lib/sectors";

const LABEL: Record<Lang, string> = { es: "Prueba", en: "Trial" };
const TITLE: Record<Lang, string> = {
  es: "Negocio de prueba: se borrará a los 7 días",
  en: "Trial shop: it is deleted after 7 days",
};

/** The small "Prueba" badge of a trial shop (BACKLOG 16): on its call and machine pages. */
export function TrialBadge({ lang }: { lang: Lang }) {
  return (
    <span
      lang={lang}
      data-trial=""
      title={TITLE[lang]}
      className="inline-flex items-center rounded-full border border-gold-dot bg-card px-2.5 py-0.5 font-inter text-xs font-semibold uppercase tracking-[0.12em] text-gold-text"
    >
      {LABEL[lang]}
    </span>
  );
}

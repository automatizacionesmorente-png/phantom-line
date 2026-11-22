import type { Lang } from "@/lib/sectors";

/**
 * front-desk-brain task 17.5. A Sure_Reading never calls the model (2.2, 19.2), so a test that
 * scripts the model for a Turn must say something the Code_Brain is not sure of, or the script is
 * never read. This tail adds exactly three words no rule places ("porque", "recomendó", "cuñada";
 * "because", "sister", "recommended"): no day, time, service, name, phone, yes, no or topic. With
 * more than `MAX_UNPLACED` (2) unplaced words a Reading is never sure, so the same line still
 * exercises the model path. Never put it right after "soy {name}" or "me llamo {name}": the name
 * reader then takes the tail's first words into the name. B15 asserts that lines with this tail are
 * never sure, and the tests that use it check the scripted model's call count or its facts.
 */
export const NOT_SURE_TAIL: Record<Lang, string> = {
  es: " porque me lo recomendó mi cuñada",
  en: " because my sister recommended it",
};

/** The line with the not-sure tail: the same facts, but the model is asked. */
export function notSure(line: string, lang: Lang): string {
  return line + NOT_SURE_TAIL[lang];
}

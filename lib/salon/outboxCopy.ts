/**
 * The WhatsApp texts of the outbox, in the client's language (spec 2.4, Global Constraints).
 * Short, the shop's name first, the client's first name; promotions end with the opt-out line.
 * Pure. Every part that comes from outside is clamped so a body never passes 700 characters.
 */
import type { Temporal } from "temporal-polyfill";
import { localDateOf } from "@/lib/booking";
import { firstName } from "@/lib/clients/winback";
import { formatClock } from "@/lib/owner/format";
import type { Lang } from "@/lib/sectors";
import type { OutboxKind } from "./settings";

export const BODY_MAX = 700;
export const OPT_OUT: Record<Lang, string> = {
  es: "Responde BAJA si no quieres más mensajes.",
  en: "Reply STOP to opt out.",
};

const WEEKDAYS: Record<Lang, readonly string[]> = {
  es: ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};
const MONTHS: Record<Lang, readonly string[]> = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

const clamp = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n).trimEnd());

export interface CopyInput {
  kind: OutboxKind;
  lang: Lang;
  shopName: string;
  /** The client's full name; only the first word is used. */
  name: string;
  tz: string;
  /** reminder and gap: the booking's start (gap: the freed slot). */
  start?: Temporal.Instant;
  /** review: the Google link. */
  url?: string;
}

/** "el jueves 12 a las 16:00" / "Thursday 12 November at 4 pm", spoken naturally. */
function whenText(start: Temporal.Instant, tz: string, lang: Lang): string {
  const d = localDateOf(start, tz);
  const weekday = WEEKDAYS[lang][d.dayOfWeek - 1];
  const at = formatClock(start, tz, lang);
  return lang === "es" ? `el ${weekday} ${d.day} a las ${at}` : `${weekday} ${d.day} ${MONTHS.en[d.month - 1]} at ${at}`;
}

export function outboxBody(i: CopyInput): string {
  const shop = clamp(i.shopName.trim(), 80);
  const who = clamp(firstName(i.name), 40);
  const es = i.lang === "es";
  const when = i.start ? whenText(i.start, i.tz, i.lang) : "";
  const tomorrowAt = i.start ? formatClock(i.start, i.tz, i.lang) : "";
  let body: string;
  switch (i.kind) {
    case "reminder":
      body = es
        ? `${shop}: Hola ${who}, te recordamos tu cita de mañana a las ${tomorrowAt}. Responde 1 para confirmar.`
        : `${shop}: Hi ${who}, a reminder of your appointment tomorrow at ${tomorrowAt}. Reply 1 to confirm.`;
      break;
    case "review":
      body = es
        ? `${shop}: Hola ${who}, gracias por venir. ¿Nos dejas una reseña? Nos ayuda mucho: ${i.url ?? ""}`
        : `${shop}: Hi ${who}, thank you for visiting. Would you leave us a review? It helps a lot: ${i.url ?? ""}`;
      break;
    case "gap":
      body = es
        ? `${shop}: Hola ${who}, se ha liberado un hueco ${when}. ¿Quieres que te lo reserve? ${OPT_OUT.es}`
        : `${shop}: Hi ${who}, a slot has just opened up on ${when}. Shall I book it for you? ${OPT_OUT.en}`;
      break;
    case "winback":
      body = es
        ? `${shop}: Hola ${who}, hace tiempo que no te vemos. Cuando quieras, dime y te busco un hueco. ${OPT_OUT.es}`
        : `${shop}: Hi ${who}, it has been a while since we saw you. Whenever you like, tell me and I will find you a spot. ${OPT_OUT.en}`;
      break;
    case "birthday":
      body = es
        ? `${shop}: ¡Feliz cumpleaños, ${who}! Un abrazo de todo el equipo. ${OPT_OUT.es}`
        : `${shop}: Happy birthday, ${who}! Warm wishes from the whole team. ${OPT_OUT.en}`;
      break;
  }
  return body;
}

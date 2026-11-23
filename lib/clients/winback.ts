/**
 * The suggested WhatsApp text for a lapsed client and its wa.me link (BACKLOG 15). The text is
 * in the client's language and names only free slots the shop really has this week (the caller
 * passes slots from the Booking_Rules). Pure.
 */
import type { Temporal } from "temporal-polyfill";
import { localDateOf } from "@/lib/booking";
import { formatClock, formatDayHeading } from "@/lib/owner/format";
import type { Lang } from "@/lib/sectors";

/** At most this many slots go into the text. */
export const WINBACK_MAX_SLOTS = 3;

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function slotText(start: Temporal.Instant, timeZone: string, lang: Lang): string {
  const day = formatDayHeading(localDateOf(start, timeZone), lang);
  const at = formatClock(start, timeZone, lang);
  return lang === "es" ? `${day} a las ${at}` : `${day} at ${at}`;
}

export function winbackText(
  i: { name: string; shopName: string; lang: Lang; timeZone: string; slots: readonly Temporal.Instant[] },
): string {
  const who = firstName(i.name);
  const slots = i.slots.slice(0, WINBACK_MAX_SLOTS).map((s) => slotText(s, i.timeZone, i.lang));
  if (i.lang === "es") {
    const head = `Hola ${who}, hace tiempo que no te vemos por ${i.shopName}.`;
    if (slots.length === 0) return `${head} Cuando quieras, dime y te busco un hueco. ¡Un abrazo!`;
    return `${head} Esta semana tenemos hueco: ${slots.join(", ")}. ¿Te reservo alguno?`;
  }
  const head = `Hi ${who}, it has been a while since we last saw you at ${i.shopName}.`;
  if (slots.length === 0) return `${head} Whenever you like, tell me and I will find you a spot.`;
  return `${head} This week we have free slots: ${slots.join(", ")}. Shall I book one for you?`;
}

/** wa.me wants the phone as digits only, and the text URL-encoded. */
export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

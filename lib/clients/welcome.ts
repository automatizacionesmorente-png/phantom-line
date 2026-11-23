/**
 * Recognising a client on the phone (BACKLOG 14). The greeting and the "lo de siempre" offer are
 * said only when the caller gave a phone AND a name that the existing name + phone rule
 * (`matchesCaller`) matches to the stored client. Never anything else from the book is spoken.
 * Pure.
 */
import { COMBO_SEPARATOR } from "@/lib/booking";
import { matchesCaller } from "@/lib/conversation/matchCaller";
import type { Lang } from "@/lib/sectors";
import { firstName } from "./winback";

/** What the conversation may know about a stored client: no note, no history, only this. */
export interface ClientRecall {
  name: string;
  phone: string;
  /** The service id worth offering as "lo de siempre", or null. */
  usualServiceId: string | null;
}

export function recognises(caller: { name?: string; phone?: string }, client: ClientRecall | null): client is ClientRecall {
  return (
    client !== null &&
    caller.name !== undefined &&
    caller.phone !== undefined &&
    matchesCaller({ name: caller.name, phone: caller.phone }, { customerName: client.name, customerPhone: client.phone })
  );
}

export function welcomeBack(name: string, lang: Lang): string {
  const who = firstName(name);
  return lang === "es" ? `¡Hola de nuevo, ${who}!` : `Welcome back, ${who}!`;
}

const lowerFirst = (s: string) => (s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s);

/** The parts of a service id said aloud: "corte de hombre y degradado" / "men's haircut and fade". Null when a part left the catalog. */
function spokenParts(id: string, services: readonly { id: string; name: Record<Lang, string> }[], lang: Lang): string | null {
  const names: string[] = [];
  for (const part of id.split(COMBO_SEPARATOR)) {
    const s = services.find((x) => x.id === part);
    if (!s) return null;
    names.push(lowerFirst(s.name[lang]));
  }
  const and = lang === "es" ? " y " : " and ";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")}${and}${names.at(-1)}`;
}

/** "¿Lo de siempre, corte y degradado?" or null when the service left the catalog. */
export function usualOffer(
  serviceId: string,
  services: readonly { id: string; name: Record<Lang, string> }[],
  lang: Lang,
): string | null {
  const said = spokenParts(serviceId, services, lang);
  if (said === null) return null;
  return lang === "es" ? `¿Lo de siempre, ${said}?` : `The usual, ${said}?`;
}

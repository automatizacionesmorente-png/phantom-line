/**
 * The Tape: order, counts, the Message_Light and the texts that go with them
 * (owner-machine Requirements 6.3, 6.4, 7.1, 13.2). Pure: no I/O, no clock.
 * Used by the server (the Poll) and by the browser (the Machine_Page) alike.
 */
import { Temporal } from "temporal-polyfill";
import type { Urgency } from "@/lib/conversation/types";
import type { Lang, SectorPack } from "@/lib/sectors";
import type { UrgencyBasis } from "./urgency";

/** What the Tape needs to know about a Message to order and count it. */
export interface TapeEntry {
  id: string;
  urgency: Urgency;
  /** `read_at IS NOT NULL`: PLAY has shown it at least once. */
  heard: boolean;
  /** ISO instant. */
  createdAt: string;
}

const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, normal: 1, low: 2 };

/** Tape_Order: Unheard first; then urgent > normal > low; then newest first; ties by id. */
function compareTape(a: TapeEntry, b: TapeEntry): number {
  if (a.heard !== b.heard) return a.heard ? 1 : -1;
  const byUrgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  if (byUrgency !== 0) return byUrgency;
  const byTime = Temporal.Instant.compare(Temporal.Instant.from(b.createdAt), Temporal.Instant.from(a.createdAt));
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The items in Tape_Order (7.1). A new array; the input is not changed. */
export function orderTape<T extends TapeEntry>(items: readonly T[]): T[] {
  return [...items].sort(compareTape);
}

/** `new`: every item (the Tape holds only New_Messages). `unheard`: the ones PLAY has not shown yet. */
export function tapeCounts(items: readonly TapeEntry[]): { new: number; unheard: number } {
  let unheard = 0;
  for (const item of items) if (!item.heard) unheard += 1;
  return { new: items.length, unheard };
}

export type LightState = "blinking" | "steady" | "off";

/** 6.4: blinks while anything is unheard, lit while there are New_Messages, off otherwise. */
export function lightState(counts: { new: number; unheard: number }): LightState {
  if (counts.unheard > 0) return "blinking";
  if (counts.new > 0) return "steady";
  return "off";
}

/**
 * The Message_Light and the Counter as text, for the polite live region (13.2):
 * "3 new messages, 1 not played yet" / "3 mensajes nuevos, 1 sin escuchar" / "No new messages".
 */
export function lightAnnouncement(counts: { new: number; unheard: number }, lang: Lang): string {
  if (counts.new <= 0) return lang === "es" ? "No hay mensajes nuevos" : "No new messages";
  const total =
    lang === "es"
      ? counts.new === 1
        ? "1 mensaje nuevo"
        : `${counts.new} mensajes nuevos`
      : counts.new === 1
        ? "1 new message"
        : `${counts.new} new messages`;
  if (counts.unheard <= 0) return total;
  return lang === "es" ? `${total}, ${counts.unheard} sin escuchar` : `${total}, ${counts.unheard} not played yet`;
}

const URGENCY_LABEL: Record<Lang, Record<Urgency, string>> = {
  es: { urgent: "Urgente", normal: "Normal", low: "Baja" },
  en: { urgent: "Urgent", normal: "Normal", low: "Low" },
};

/** The text of the urgency badge (7.8): never colour alone. */
export function urgencyLabel(urgency: Urgency, lang: Lang): string {
  return URGENCY_LABEL[lang][urgency];
}

/** The urgency each rule gives on its own (lib/messages/urgency.ts, rules 1–4). */
const RULE_LEVEL: Record<UrgencyBasis["rule"], Urgency> = {
  urgent_term: "urgent",
  today_open: "urgent",
  today_handled: "normal",
  model_failed: "normal",
  none: "low",
};

const quote = (term: string, lang: Lang) => (lang === "es" ? `«${term}»` : `“${term}”`);
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

function basisReason(basis: UrgencyBasis, lang: Lang, booking: string): string {
  switch (basis.rule) {
    case "urgent_term":
      return lang === "es" ? `dijo ${quote(basis.term, lang)}` : `said ${quote(basis.term, lang)}`;
    case "today_open":
      if (basis.via === "term" && basis.term !== undefined) {
        return lang === "es"
          ? `dijo ${quote(basis.term, lang)} y quedó sin cerrar`
          : `said ${quote(basis.term, lang)}, still open`;
      }
      return lang === "es"
        ? `pide ${booking} para hoy y quedó sin cerrar`
        : `wants ${article(booking)} ${booking} today, still open`;
    case "today_handled":
      return lang === "es" ? "es para hoy y ya quedó resuelto" : "for today, already handled";
    case "model_failed":
      return lang === "es" ? "el contestador falló" : "the answering machine failed";
    case "none":
      return lang === "es" ? "nada urgente" : "nothing urgent";
  }
}

/**
 * Why a Message has its Final_Urgency, in one short line: "Urgente · dijo «alergia»".
 * The quoted word is the pack's own term from the basis, never the caller's sentence.
 * When the model's suggestion is what raised it above the rule, it says so. A Message
 * written before code-decided urgency has no basis and shows the badge text alone.
 */
export function urgencyBasisText(
  message: { urgency: Urgency; urgencyBasis: UrgencyBasis | null },
  lang: Lang,
  pack: Pick<SectorPack, "vocabulary">,
): string {
  const label = urgencyLabel(message.urgency, lang);
  const basis = message.urgencyBasis;
  if (basis === null) return label;
  if (message.urgency !== RULE_LEVEL[basis.rule]) {
    return `${label} · ${lang === "es" ? "lo marcó el asistente" : "flagged by the assistant"}`;
  }
  return `${label} · ${basisReason(basis, lang, pack.vocabulary[lang].booking)}`;
}

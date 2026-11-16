/**
 * Code-decided urgency (owner-machine Requirement 5). The model only suggests;
 * these rules decide, and the Final_Urgency is never below either.
 * Pure: every input is a parameter. The terms come from the Sector_Pack (5.2).
 */
import type { Temporal } from "temporal-polyfill";
import type { Line, Outcome, Urgency } from "@/lib/conversation/types";
import { LANGS, type Lang, type SectorPack } from "@/lib/sectors";
import { findTerm } from "./terms";

export type { Urgency } from "@/lib/conversation/types";

declare const finalBrand: unique symbol;
/** An urgency that went through `decideUrgency`. Nothing else can produce one. */
export type FinalUrgency = Urgency & { readonly [finalBrand]: true };

export type UrgencyBasis =
  | { rule: "urgent_term"; term: string; lang: Lang }
  | { rule: "today_open" | "today_handled"; via: "term" | "requested_day" | "booking_day"; term?: string }
  | { rule: "model_failed" }
  | { rule: "none" };

export interface UrgencyInput {
  /** The Caller side of the Transcript only (5.10). */
  callerLines: readonly string[];
  /** Every language of the pack is searched (5.3). */
  vocabulary: SectorPack["vocabulary"];
  timeZone: string;
  now: Temporal.Instant;
  /** Shop-local, from CallState.fields.requested. */
  requestedDate: Temporal.PlainDate | null;
  /** The Booking the Call created, moved or cancelled. */
  bookingStart: Temporal.Instant | null;
  outcome: Outcome;
  modelFailed: boolean;
  /** Null when the model never gave a valid Turn. */
  suggested: Urgency | null;
}

export interface UrgencyDecision {
  final: FinalUrgency;
  rule: Urgency;
  basis: UrgencyBasis;
  suggested: Urgency | null;
}

const RANK: Record<Urgency, number> = { low: 0, normal: 1, urgent: 2 };

/** The higher of two urgencies. */
export function maxUrgency(a: Urgency, b: Urgency): Urgency {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Outcomes that end the Call with a Booking created, rescheduled or cancelled (5.4, 5.5). */
const HANDLED: ReadonlySet<Outcome> = new Set<Outcome>(["booked", "rescheduled", "cancelled"]);

/**
 * The Suggested_Urgency from a Call's note. `decideTurn` writes `reason` (min 1) and
 * `urgency` together from every valid model Turn, so a blank reason means the urgency
 * is still the initial "normal" of `initialCallState`, which is not a suggestion.
 */
export function suggestedFrom(note: { reason: string; urgency: Urgency }): Urgency | null {
  return note.reason.trim() === "" ? null : note.urgency;
}

/**
 * The Caller side of a Transcript (5.10). The Receptionist's words never count, so a
 * templated "¿A qué hora te viene bien hoy?" cannot raise urgency. The greeting row
 * has `caller: ""` and adds nothing.
 */
export function callerLinesOf(transcript: readonly Line[]): string[] {
  return transcript.map((l) => l.caller);
}

function findInLangs(lines: readonly string[], vocabulary: SectorPack["vocabulary"], key: "urgent" | "today") {
  for (const lang of LANGS) {
    const term = findTerm(lines, vocabulary[lang][key]);
    if (term !== null) return { term, lang };
  }
  return null;
}

function ruleOf(input: UrgencyInput): { rule: Urgency; basis: UrgencyBasis } {
  // 1. An urgent term in any pack language (5.3).
  const urgent = findInLangs(input.callerLines, input.vocabulary, "urgent");
  if (urgent) return { rule: "urgent", basis: { rule: "urgent_term", term: urgent.term, lang: urgent.lang } };

  // 2. Today (5.4, 5.5): a today term, the requested day, or the Booking's day.
  const today = input.now.toZonedDateTimeISO(input.timeZone).toPlainDate();
  const todayTerm = findInLangs(input.callerLines, input.vocabulary, "today");
  const via: "term" | "requested_day" | "booking_day" | null = todayTerm
    ? "term"
    : input.requestedDate?.equals(today)
      ? "requested_day"
      : input.bookingStart?.toZonedDateTimeISO(input.timeZone).toPlainDate().equals(today)
        ? "booking_day"
        : null;
  if (via) {
    const handled = HANDLED.has(input.outcome);
    const basis: UrgencyBasis = {
      rule: handled ? "today_handled" : "today_open",
      via,
      ...(todayTerm ? { term: todayTerm.term } : {}),
    };
    return { rule: handled ? "normal" : "urgent", basis };
  }

  // 3. The model failed during the Call (5.6).
  if (input.modelFailed) return { rule: "normal", basis: { rule: "model_failed" } };

  // 4. Otherwise (5.7).
  return { rule: "low", basis: { rule: "none" } };
}

/** The Rule_Urgency, its basis, and the Final_Urgency: the higher of rule and suggestion (5.8). */
export function decideUrgency(input: UrgencyInput): UrgencyDecision {
  const { rule, basis } = ruleOf(input);
  // The one place a FinalUrgency is made.
  const final = maxUrgency(rule, input.suggested ?? "low") as FinalUrgency;
  return { final, rule, basis, suggested: input.suggested };
}

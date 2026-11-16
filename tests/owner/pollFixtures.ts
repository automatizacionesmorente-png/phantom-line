import fc from "fast-check";
import type { Channel, Outcome, Urgency } from "@/lib/conversation/types";
import { SAMPLE_KEYS, type TapeItem } from "@/lib/owner/api";

/** A plain TapeItem for unit tests. */
export function tapeItem(id: string, over: Partial<TapeItem> = {}): TapeItem {
  return {
    id,
    channel: "voice",
    createdAt: "2026-11-12T10:00:00Z",
    heard: false,
    callerName: "Ana",
    callerPhone: "+34600000000",
    reason: "Corte de pelo",
    urgency: "normal",
    urgencyBasis: { rule: "none" },
    agreed: { stored: "Corte el viernes a las 17:00" },
    currentReply: "Hola Ana, te esperamos.",
    replyLang: "es",
    ownerLang: "es",
    outcome: "booked",
    modelFailed: false,
    sample: null,
    ...over,
  };
}

const arbText = fc.string({ maxLength: 60 });

export const arbTapeItem: fc.Arbitrary<TapeItem> = fc.record({
  id: fc.uuid(),
  channel: fc.constantFrom<Channel>("voice", "whatsapp", "webchat"),
  createdAt: fc
    .date({ min: new Date("2026-01-01T00:00:00Z"), max: new Date("2026-12-31T00:00:00Z"), noInvalidDate: true })
    .map((d) => d.toISOString()),
  heard: fc.boolean(),
  callerName: fc.option(arbText, { nil: null }),
  callerPhone: fc.option(fc.stringMatching(/^\+\d{8,14}$/), { nil: null }),
  reason: arbText,
  urgency: fc.constantFrom<Urgency>("low", "normal", "urgent"),
  urgencyBasis: fc.constantFrom<TapeItem["urgencyBasis"]>(
    null,
    { rule: "none" },
    { rule: "model_failed" },
    { rule: "urgent_term", term: "alergia", lang: "es" },
    { rule: "today_open", via: "term", term: "hoy" },
  ),
  agreed: fc.oneof(
    arbText.map((stored) => ({ stored })),
    fc.record({ es: arbText, en: arbText }).map((byLang) => ({ byLang })),
  ),
  currentReply: arbText,
  replyLang: fc.constantFrom("es" as const, "en" as const),
  ownerLang: fc.constantFrom("es" as const, "en" as const),
  outcome: fc.constantFrom<Outcome>("booked", "rescheduled", "cancelled", "answered", "message", "fallback", "abandoned"),
  modelFailed: fc.boolean(),
  sample: fc.option(fc.constantFrom(...SAMPLE_KEYS), { nil: null }),
});

/**
 * A repository row that carries more than a TapeItem, as a careless join would: the
 * Transcript, the visitor key, the raw call state. None of it may reach the Poll body.
 */
export const arbLeakyTapeRow: fc.Arbitrary<TapeItem> = fc
  .tuple(
    arbTapeItem,
    fc.record(
      {
        transcript: fc.array(fc.record({ caller: arbText, receptionist: arbText }), { maxLength: 3 }),
        visitorKey: arbText,
        state: fc.constant({ stage: "done" }),
      },
      { requiredKeys: [] },
    ),
  )
  .map(([item, extra]) => ({ ...item, ...extra }) as TapeItem);

import { z } from "zod";

/**
 * The body of POST /api/turn: the contract between the Call_Page and the voice
 * adapter. `strictObject` makes any extra key a validation error, so a body
 * carrying collected fields, an "accepted" flag or a booking id gets a 400
 * (Requirements 3.7, 3.11). Pure zod, safe to import in the browser.
 */
export const MAX_UTTERANCE = 500;
export const MAX_CONVERSATION = 20;

const Lang = z.enum(["es", "en"]);
const ShopId = z.string().min(1).max(100);
const Line = z.strictObject({ caller: z.string().max(MAX_UTTERANCE), receptionist: z.string().max(600) });

export const TurnRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("start"), shopId: ShopId, language: Lang }),
  z.strictObject({
    kind: z.literal("say"),
    shopId: ShopId,
    language: Lang,
    callId: z.uuid(),
    utterance: z.string().trim().min(1).max(MAX_UTTERANCE),
    conversation: z.array(Line).max(MAX_CONVERSATION),
  }),
  z.strictObject({ kind: z.literal("hangup"), shopId: ShopId, callId: z.uuid() }),
]);
export type TurnRequest = z.infer<typeof TurnRequestSchema>;

import { z } from "zod";
import type { TurnOutput } from "@/lib/conversation/types";

/**
 * The body of POST /api/speech (natural-voice design.md, "/api/speech contract"), and the
 * `speech` hint /api/turn adds to each reply. Pure zod, safe to import in the browser.
 * `strictObject`: any other key is a 400 (Requirement 1.3).
 */
export const MAX_SPEECH_TEXT = 600;

const Lang = z.enum(["es", "en"]);
const ShopId = z.string().min(1).max(100);

export const SpeechRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("say"),
    shopId: ShopId,
    language: Lang,
    text: z.string().min(1).max(MAX_SPEECH_TEXT),
    token: z.string().min(10).max(200),
  }),
  z.strictObject({
    kind: z.literal("report"),
    shopId: ShopId,
    language: Lang,
    reason: z.enum(["deadline", "stall", "playback_error", "network"]),
    fixed: z.boolean(),
    latencyMs: z.number().int().min(0).max(60000),
  }),
]);
export type SpeechRequest = z.infer<typeof SpeechRequestSchema>;

/**
 * How the Call_Page gets the audio of a reply. `rate` is the shop's `speechRate`, applied by the
 * player with the pitch kept. `cached` is a stored line served by GET /api/voice/<key> (task 9);
 * `live` is synthesized by POST /api/speech with the token.
 */
export type SpeechHint = { kind: "live"; token: string; rate: number } | { kind: "cached"; url: string; rate: number };

/** What POST /api/turn returns: the Conversation_Core's output plus the voice adapter's speech hint. */
export type TurnResponse = TurnOutput & { speech?: SpeechHint };

/** The Content-Type of a `say` answer: raw 16-bit mono PCM. */
export const pcmContentType = (sampleRate: number) => `audio/L16; rate=${sampleRate}; channels=1`;

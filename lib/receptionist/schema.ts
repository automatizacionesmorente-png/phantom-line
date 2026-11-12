import { z } from "zod";

const Nullable = <T extends z.ZodType>(t: T) => t.nullable();

/**
 * What Gemini must return each Turn. The same object generates the JSON Schema
 * sent to the model and validates its answer, so they cannot drift. Task 1.5
 * confirmed that zod's nullable form (`anyOf [T, null]`) is accepted as is.
 * The descriptions travel in the JSON Schema; the date and time ones exist
 * because the model once left out a time it judged impossible (bugfix 2026-11-12).
 */
export const ModelTurnSchema = z.strictObject({
  reply: z.string().min(1).max(400), // spoken line(s) in `language`
  language: z.enum(["es", "en"]), // language of `reply`
  wantsLanguage: Nullable(z.enum(["es", "en"])), // caller asked to switch
  intent: z.enum(["booking", "reschedule", "cancel", "question", "order", "other"]),
  name: Nullable(z.string().min(1).max(80)),
  phone: Nullable(z.string().min(6).max(32)), // digits as heard; code normalizes
  service: Nullable(z.string().min(1).max(80)).describe(
    "The service the caller asked for, in the caller's own words, from the whole conversation. Null if not said.",
  ), // code matches the catalog
  date: Nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).describe(
    "The day the caller asked for, shop-local YYYY-MM-DD, from the whole conversation, even if the shop is closed that day or it has passed. Null only if the caller never said a day.",
  ),
  time: Nullable(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).describe(
    'The time the caller asked for, shop-local 24-hour HH:MM ("nine at night" is "21:00"), from the whole conversation, even if the shop is closed then. Null only if the caller never said a time.',
  ),
  callerConfirmed: z.boolean(), // said yes to the last read-back
  callerWantsToEnd: z.boolean(),
  outOfProfile: z.boolean(), // asked something the profile does not answer
  reason: z.string().min(1).max(160), // one line for the owner
  urgency: z.enum(["low", "normal", "urgent"]),
});
export type ModelTurn = z.infer<typeof ModelTurnSchema>;
export const modelTurnJsonSchema = z.toJSONSchema(ModelTurnSchema);

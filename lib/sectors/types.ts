import { z } from "zod";
import type { SectorRule } from "@/lib/booking";
import type { CategorySchema, FaqEntrySchema, ServiceSchema } from "@/lib/conversation/shopProfile";
import { normalizeForMatch } from "@/lib/messages/terms";

export type Lang = "es" | "en";
export const LANGS = ["es", "en"] as const;

export type RequiredField = "service" | "requestedTime" | "name" | "phone";

/** The BCP-47 code sent to the TTS model as speech_config.language, per Lang. */
export const LANGUAGE_CODE = { es: "es-ES", en: "en-US" } as const satisfies Record<Lang, string>;

/** How one language sounds: which voice, and how it says things (never what it says). */
export interface VoiceProfile {
  /** Catalog voice id, used by models that accept it (the 3.8 family), e.g. "es-es-commercial-3". */
  voice: string;
  /** A classic prebuilt voice (e.g. "Kore") for models that reject catalog ids. */
  classicVoice: string;
  /** BCP-47, sent as speech_config.language. */
  languageCode: (typeof LANGUAGE_CODE)[Lang];
  /** How to say it, never what to say. At most 200 characters. */
  style: string;
}

/** A catalog id ("es-es-commercial-3") or a classic name ("Kore"): letters, digits and hyphens. */
export const VoiceIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/, "a voice id is letters, digits and hyphens, starting with a letter");
/** The style prompt of Requirement 3.1: at most 200 characters, not blank. */
export const VoiceStyleSchema = z.string().trim().min(1).max(200);

export const VoiceProfileSchema = z.strictObject({
  voice: VoiceIdSchema,
  classicVoice: VoiceIdSchema,
  languageCode: z.enum([LANGUAGE_CODE.es, LANGUAGE_CODE.en]),
  style: VoiceStyleSchema,
});

/** A service, Category or FAQ entry of a starter catalogue: the Shop_Profile shapes, so a wizard can copy them as they are. */
export type StarterService = z.input<typeof ServiceSchema>;
export type StarterCategory = z.input<typeof CategorySchema>;
export type StarterFaqEntry = z.input<typeof FaqEntrySchema>;

/** The default catalogue a new shop of this sector starts from. The owner edits it. */
export interface StarterCatalogue {
  categories: readonly StarterCategory[];
  services: readonly StarterService[];
}

/** A plain typed config that tells the engine how a kind of business works. */
export interface SectorPack {
  /** e.g. "hair-salon". */
  id: string;
  /** What the onboarding wizard shows the owner: "Peluquería" / "Hair salon". */
  displayName: Record<Lang, string>;
  unit: "appointment" | "table" | "order";
  /** What a resource is called: sillón / chair. */
  resourceKind: Record<Lang, { one: string; many: string }>;
  /** The order the receptionist asks for them in. */
  requiredFields: readonly RequiredField[];
  /** Alternatives start every `slotStepMin` minutes from each opening. */
  slotStepMin: number;
  /** Sector-specific checks, all pure. */
  rules: readonly SectorRule[];
  /** How the receptionist and the owner screen name things, plus the Urgency_Terms, per language. */
  vocabulary: Record<Lang, PackVocabulary>;
  /** The default voice per language. A Shop_Profile may override voice, classicVoice and style. */
  voice: Record<Lang, VoiceProfile>;
  /** Never advise on these; take a message for the owner instead. */
  sensitiveTopics: Record<Lang, readonly string[]>;
  /** Never promise these. */
  neverPromise: Record<Lang, readonly string[]>;
  /** Default services and Categories for a new shop (every service has ES/EN names, a spoken name, a duration and a price). */
  starterCatalogue?: StarterCatalogue;
  /** Default everyday answers (prices, payment, parking, cancellation, accessibility...) for a new shop. */
  starterFaq?: readonly StarterFaqEntry[];
}

/** One language of a pack's vocabulary. */
export interface PackVocabulary {
  booking: string;
  bookingVerb: string;
  service: string;
  /** How the receptionist names the business: "la peluquería" / "the salon". */
  place: string;
  /** Any of these, as whole words in a Caller line, makes the Message urgent (owner-machine 5.3). */
  urgent: readonly string[];
  /** A request for today (owner-machine 5.4, 5.5). */
  today: readonly string[];
  /**
   * Not_Urgent_Phrases (front-desk-brain 16.5): urgent terms inside these phrases do not count
   * ("prueba de alergia" is a question, "me ha dado alergia" is not). Today terms still do.
   */
  notUrgent?: readonly string[];
}

/** Only the string entries, so `term()` always returns a string. */
export type VocabularyKey = {
  [K in keyof PackVocabulary]-?: PackVocabulary[K] extends string ? K : never;
}[keyof PackVocabulary];

const text = z.string().trim().min(1).max(200);

/** 1–40 Urgency_Terms of 1–40 characters, each with a letter or digit, none repeated after normalization. */
const termList = (max: number) =>
  z
    .array(z.string().trim().min(1).max(40))
    .min(1)
    .max(max)
    .refine((ts) => ts.every((t) => normalizeForMatch(t) !== ""), "every term needs a letter or a digit")
    .refine((ts) => new Set(ts.map(normalizeForMatch)).size === ts.length, "terms must not repeat after normalization");
const urgencyTerms = termList(40);
/** Not_Urgent_Phrases: the same shape as the urgent terms, at most 20 (front-desk-brain design). */
const notUrgentPhrases = termList(20);
const perLang = <T extends z.ZodType>(t: T) => z.strictObject({ es: t, en: t });

/** zod for the data part of a pack (everything except the rule functions). */
export const SectorPackDataSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  displayName: perLang(text),
  unit: z.enum(["appointment", "table", "order"]),
  resourceKind: perLang(z.strictObject({ one: text, many: text })),
  requiredFields: z
    .array(z.enum(["service", "requestedTime", "name", "phone"]))
    .min(1)
    .refine((f) => new Set(f).size === f.length, "requiredFields must not repeat")
    .refine((f) => f.includes("requestedTime") && f.includes("name") && f.includes("phone"), "a booking needs a time, a name and a phone"),
  slotStepMin: z.number().int().min(5).max(60),
  vocabulary: perLang(
    z.strictObject({
      booking: text,
      bookingVerb: text,
      service: text,
      place: text,
      urgent: urgencyTerms,
      today: urgencyTerms,
      notUrgent: notUrgentPhrases.optional(),
    }),
  ),
  voice: z.strictObject({
    es: VoiceProfileSchema.refine((v) => v.languageCode === LANGUAGE_CODE.es, "the es voice must use es-ES"),
    en: VoiceProfileSchema.refine((v) => v.languageCode === LANGUAGE_CODE.en, "the en voice must use en-US"),
  }),
  sensitiveTopics: perLang(z.array(text)),
  neverPromise: perLang(z.array(text)),
  // Deep-checked against ShopProfileSchema by the registry (it cannot be imported here without a cycle).
  starterCatalogue: z
    .strictObject({ categories: z.array(z.unknown()), services: z.array(z.unknown()).min(1) })
    .optional(),
  starterFaq: z.array(z.unknown()).optional(),
});
export type SectorPackData = z.infer<typeof SectorPackDataSchema>;

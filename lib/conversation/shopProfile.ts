import { z } from "zod";
import type { ShopRules, Weekday, WeeklyHours } from "@/lib/booking";
import { MAX_WORDS, splitSentences } from "@/lib/receptionist/speech";
import { VoiceIdSchema, VoiceStyleSchema } from "@/lib/sectors/types";
import { normalizeText } from "./fields";

export const Lang = z.enum(["es", "en"]);

export function isValidIanaZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz.length > 0;
  } catch {
    return false;
  }
}

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");
const SessionSchema = z
  .strictObject({ open: HHMM, close: HHMM })
  .refine((s) => s.open < s.close, "open must be before close");
const DaySchema = z
  .array(SessionSchema)
  .min(1)
  .refine(
    (day) => day.every((s, k) => k === 0 || day[k - 1].close <= s.open),
    "sessions of a day must be sorted and must not overlap",
  );

/** ISO weekday 1 (Monday) … 7 (Sunday) → sessions. A missing day is closed. */
export const WeeklyHoursSchema = z.strictObject({
  1: DaySchema.optional(),
  2: DaySchema.optional(),
  3: DaySchema.optional(),
  4: DaySchema.optional(),
  5: DaySchema.optional(),
  6: DaySchema.optional(),
  7: DaySchema.optional(),
});

const Localized = z.strictObject({ es: z.string().min(1).max(80), en: z.string().min(1).max(80) });

/**
 * A service, Category or FAQ id: lowercase letters, digits and hyphens, starting with a
 * letter (front-desk-brain 11.3). No id can contain `+`, so a Combo_Id is never ambiguous.
 * Every id stored before this pattern (`haircut`, `colour`, `beard`) matches it.
 */
export const IdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,59}$/, "lowercase letters, digits and hyphens");

/** The built-in Profile_Topics; an FAQ_Entry may not take one of these ids (11.2). */
export const BUILT_IN_TOPICS: ReadonlySet<string> = new Set(["hours", "address", "services", "price", "duration"]);

/** Characters that only make sense as markup (the same set `toSpokenReply` removes). */
const MARKUP = /[*_#`~<>[\]{}|\\^=]/;
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u20e3]/u;
const SPOKEN_ANSWER_SENTENCES = 2;
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * An FAQ answer as the Receptionist says it, word for word (11.2): Spoken_Form (no digit),
 * no markup or emoji, 1 or 2 sentences of at most 25 words each.
 */
export const SpokenAnswerSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((s) => !/\d/.test(s), "Spoken_Form: no digits")
  .refine((s) => !MARKUP.test(s) && !EMOJI.test(s), "no markup or emoji")
  .refine((s) => {
    const sentences = splitSentences(s);
    return (
      sentences.length >= 1 &&
      sentences.length <= SPOKEN_ANSWER_SENTENCES &&
      sentences.every((x) => wordCount(x) <= MAX_WORDS)
    );
  }, "1 or 2 sentences of at most 25 words");

/** A word or phrase a Caller may say; it must keep at least one letter or digit after normalization. */
const AliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((s) => normalizeText(s) !== "", "an alias needs a letter or a digit");

export const ServiceSchema = z.strictObject({
  id: IdSchema,
  name: Localized,
  /** Other words callers use for it ("cortarme el pelo"); used only to match what the caller said. */
  aliases: z.array(z.string().min(1).max(60)).max(30).optional(),
  durationMin: z.number().int().min(5).max(480),
  priceCents: z.number().int().min(0),
  /** How the receptionist says it, with its article: { es: "un corte", en: "a haircut" }. */
  spokenName: Localized.optional(),
  /** The Category it belongs to, by id. */
  category: IdSchema.optional(),
  /** Services it is usually combined with (Goes_With): breaks a Service_Choice tie. */
  goesWith: z.array(IdSchema).max(10).optional(),
  /** The service is an Add_On of these: it is only booked together with one of them (4.10). */
  addOnTo: z.array(IdSchema).min(1).max(5).optional(),
  /** The price is a starting price: said "desde" / "from". */
  priceFrom: z.boolean().optional(),
});

/** A named group of services ("color"), with Spanish and English plural names. */
export const CategorySchema = z.strictObject({
  id: IdSchema,
  name: Localized,
  aliases: z.array(z.string().min(1).max(60)).max(30).optional(),
});

/** An everyday question the profile answers word for word (FAQ_Entry, 11.2). */
export const FaqEntrySchema = z.strictObject({
  id: IdSchema.refine((id) => !BUILT_IN_TOPICS.has(id), "reserved topic id"),
  aliases: z.strictObject({
    es: z.array(AliasSchema).min(1).max(30),
    en: z.array(AliasSchema).min(1).max(30),
  }),
  answer: z.strictObject({ es: SpokenAnswerSchema, en: SpokenAnswerSchema }),
});

/** How long the Call_Page waits after the caller's last word before it ends the Turn (17.2). */
export const END_OF_SPEECH_MS_MIN = 300;
export const END_OF_SPEECH_MS_MAX = 1500;
export const END_OF_SPEECH_MS_DEFAULT = 600;

/** A shop's override of its pack's Voice_Profile, field by field. The language code stays the pack's. */
export const VoiceOverrideSchema = z.strictObject({
  voice: VoiceIdSchema.optional(),
  classicVoice: VoiceIdSchema.optional(),
  style: VoiceStyleSchema.optional(),
});

/** The player's playback rate for the neural voice, one per shop (design.md, "Pace"). */
export const SPEECH_RATE_MIN = 0.8;
export const SPEECH_RATE_MAX = 1.25;
export const SPEECH_RATE_DEFAULT = 1.0;
export const SpeechRateSchema = z.number().min(SPEECH_RATE_MIN).max(SPEECH_RATE_MAX).default(SPEECH_RATE_DEFAULT);

export const ShopProfileSchema = z
  .strictObject({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(120),
    ownerName: z.string().min(1).max(60),
    address: z.string().min(1).max(200),
    timeZone: z.string().refine(isValidIanaZone, "unknown IANA time zone"),
    sectorPackId: z.string().min(1),
    languages: z.array(Lang).min(1),
    hours: WeeklyHoursSchema,
    services: z.array(ServiceSchema).min(1),
    resources: z.array(z.strictObject({ id: z.string().min(1), name: Localized })).min(1),
    /** Optional per language; a stored profile without it uses the pack's voice. */
    voice: z
      .strictObject({
        es: VoiceOverrideSchema.optional(),
        en: VoiceOverrideSchema.optional(),
        /** The Silence_Cut for this shop (17.2); the Call_Page uses 600 ms without it. */
        endOfSpeechMs: z.number().int().min(END_OF_SPEECH_MS_MIN).max(END_OF_SPEECH_MS_MAX).optional(),
      })
      .optional(),
    /** Optional in storage; a profile without it reads as 1.0. */
    speechRate: SpeechRateSchema,
    categories: z.array(CategorySchema).max(12).optional(),
    faq: z.array(FaqEntrySchema).max(40).optional(),
  })
  .refine((p) => new Set(p.services.map((s) => s.id)).size === p.services.length, "service ids must be unique")
  .refine((p) => new Set(p.resources.map((r) => r.id)).size === p.resources.length, "resource ids must be unique")
  .superRefine((p, ctx) => {
    for (const issue of profileReferenceIssues(p)) ctx.addIssue({ code: "custom", ...issue });
  });

type ProfileShape = {
  services: readonly z.infer<typeof ServiceSchema>[];
  categories?: readonly z.infer<typeof CategorySchema>[];
  faq?: readonly z.infer<typeof FaqEntrySchema>[];
};

/**
 * The cross-references and uniqueness rules of 11.2 and 11.3, as a list of issues so each
 * refusal says where it is. Every `category`, `goesWith` and `addOnTo` id exists; an `addOnTo`
 * target is not itself an Add_On; no service is its own Add_On; Category and FAQ ids are unique;
 * and an FAQ alias, after `normalizeText`, belongs to one FAQ_Entry only and is none of the
 * words the service matcher already reads (a service's id, names and aliases, a Category's
 * names and aliases). The same alias in an entry's Spanish and English lists ("parking") is fine.
 */
function profileReferenceIssues(p: ProfileShape): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const serviceIds = new Set(p.services.map((s) => s.id));
  const addOns = new Set(p.services.filter((s) => s.addOnTo).map((s) => s.id));
  const categories = p.categories ?? [];
  const categoryIds = new Set(categories.map((c) => c.id));

  if (categoryIds.size !== categories.length) issues.push({ path: ["categories"], message: "category ids must be unique" });

  p.services.forEach((s, i) => {
    if (s.category !== undefined && !categoryIds.has(s.category))
      issues.push({ path: ["services", i, "category"], message: `unknown category "${s.category}"` });
    (s.goesWith ?? []).forEach((id, j) => {
      if (!serviceIds.has(id)) issues.push({ path: ["services", i, "goesWith", j], message: `unknown service "${id}"` });
    });
    (s.addOnTo ?? []).forEach((id, j) => {
      const path = ["services", i, "addOnTo", j];
      if (id === s.id) issues.push({ path, message: "a service cannot be an Add_On of itself" });
      else if (!serviceIds.has(id)) issues.push({ path, message: `unknown service "${id}"` });
      else if (addOns.has(id)) issues.push({ path, message: `"${id}" is itself an Add_On` });
    });
  });

  const faq = p.faq ?? [];
  if (new Set(faq.map((f) => f.id)).size !== faq.length) issues.push({ path: ["faq"], message: "FAQ ids must be unique" });

  const matcherWords = new Set<string>();
  for (const s of p.services)
    for (const w of [s.id.replace(/-/g, " "), s.name.es, s.name.en, ...(s.aliases ?? [])]) matcherWords.add(normalizeText(w));
  for (const c of categories) for (const w of [c.name.es, c.name.en, ...(c.aliases ?? [])]) matcherWords.add(normalizeText(w));

  const owner = new Map<string, string>();
  faq.forEach((f, i) => {
    for (const lang of ["es", "en"] as const) {
      f.aliases[lang].forEach((alias, j) => {
        const key = normalizeText(alias);
        const path = ["faq", i, "aliases", lang, j];
        if (matcherWords.has(key)) issues.push({ path, message: `FAQ alias "${alias}" is also a service or Category word` });
        const first = owner.get(key);
        if (first !== undefined && first !== f.id)
          issues.push({ path, message: `FAQ alias "${alias}" is already an alias of "${first}"` });
        else owner.set(key, f.id);
      });
    }
  });
  return issues;
}

export type ShopProfile = z.infer<typeof ShopProfileSchema>;
/** A profile as stored or written by hand: `speechRate` may be missing. */
export type ShopProfileInput = z.input<typeof ShopProfileSchema>;
export type ShopService = ShopProfile["services"][number];

/** The parts of a profile the Booking_Rules use. */
export function toShopRules(profile: ShopProfile): ShopRules {
  const hours: Partial<Record<Weekday, { open: string; close: string }[]>> = {};
  for (const d of [1, 2, 3, 4, 5, 6, 7] as Weekday[]) {
    const day = profile.hours[d];
    if (day) hours[d] = day;
  }
  return {
    timeZone: profile.timeZone,
    hours: hours as WeeklyHours,
    services: profile.services.map((s) => ({ id: s.id, durationMin: s.durationMin })),
    resources: profile.resources.map((r) => ({ id: r.id })),
  };
}

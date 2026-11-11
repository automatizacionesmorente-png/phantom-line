import { z } from "zod";
import type { SectorRule } from "@/lib/booking";

export type Lang = "es" | "en";
export const LANGS = ["es", "en"] as const;

export type RequiredField = "service" | "requestedTime" | "name" | "phone";

/** A plain typed config that tells the engine how a kind of business works. */
export interface SectorPack {
  /** e.g. "hair-salon". */
  id: string;
  unit: "appointment" | "table" | "order";
  /** What a resource is called: sillón / chair. */
  resourceKind: Record<Lang, { one: string; many: string }>;
  /** The order the receptionist asks for them in. */
  requiredFields: readonly RequiredField[];
  /** Alternatives start every `slotStepMin` minutes from each opening. */
  slotStepMin: number;
  /** Sector-specific checks, all pure. */
  rules: readonly SectorRule[];
  vocabulary: Record<Lang, { booking: string; bookingVerb: string; service: string }>;
  /** Never advise on these; take a message for the owner instead. */
  sensitiveTopics: Record<Lang, readonly string[]>;
  /** Never promise these. */
  neverPromise: Record<Lang, readonly string[]>;
}

export type VocabularyKey = keyof SectorPack["vocabulary"][Lang];

const text = z.string().trim().min(1).max(200);
const perLang = <T extends z.ZodType>(t: T) => z.strictObject({ es: t, en: t });

/** zod for the data part of a pack (everything except the rule functions). */
export const SectorPackDataSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  unit: z.enum(["appointment", "table", "order"]),
  resourceKind: perLang(z.strictObject({ one: text, many: text })),
  requiredFields: z
    .array(z.enum(["service", "requestedTime", "name", "phone"]))
    .min(1)
    .refine((f) => new Set(f).size === f.length, "requiredFields must not repeat")
    .refine((f) => f.includes("requestedTime") && f.includes("name") && f.includes("phone"), "a booking needs a time, a name and a phone"),
  slotStepMin: z.number().int().min(5).max(60),
  vocabulary: perLang(z.strictObject({ booking: text, bookingVerb: text, service: text })),
  sensitiveTopics: perLang(z.array(text)),
  neverPromise: perLang(z.array(text)),
});
export type SectorPackData = z.infer<typeof SectorPackDataSchema>;

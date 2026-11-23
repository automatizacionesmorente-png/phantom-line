import { z } from "zod";
import { normalizeText } from "@/lib/conversation/fields";
import {
  BUILT_IN_TOPICS,
  isValidIanaZone,
  ShopProfileSchema,
  WeeklyHoursSchema,
  type ShopProfileInput,
} from "@/lib/conversation/shopProfile";
import { uniqueId } from "./slug";
import { getSectorPack } from "@/lib/sectors";

/**
 * The wizard's data and its validation, shared by the browser (per-step checks) and the server
 * (the creation endpoint). Error messages are short codes the screens translate.
 */

export const TRIAL_DAYS = 7;
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const MAX_PASTED_TEXT = 20_000;
export const MAX_CREATE_BODY_BYTES = 64 * 1024;
/** Per visitor and per day, and all visitors per day. */
export const LIMITS = {
  create: { perVisitorPerDay: 3, globalPerDay: 50 },
  extract: { perVisitorPerDay: 5, globalPerDay: 100 },
} as const;

const collapse = (v: string) => v.replace(/\s+/g, " ").trim();
/** No markup characters and no control or format characters (bidi overrides, zero width). */
const plain = (v: string) => !/[<>]/.test(v) && !/\p{C}/u.test(v);

/** A trimmed, single-spaced, plain-text string of `min`..`max` characters. */
export const text = (max: number, min = 1) =>
  z
    .string()
    .transform(collapse)
    .pipe(z.string().min(min, "required").max(max, "too_long").refine(plain, "invalid_chars"));

/** Like `text`, but an empty string (or no value) is "not given". */
const optionalText = (max: number) =>
  z
    .string()
    .optional()
    .transform((v) => collapse(v ?? ""))
    .pipe(z.string().max(max, "too_long").refine(plain, "invalid_chars"))
    .transform((v) => (v === "" ? undefined : v));

const Lang = z.enum(["es", "en"]);

export const TimeZoneSchema = z
  .string()
  .max(60)
  .regex(/^[A-Za-z][A-Za-z_]*(\/[A-Za-z0-9_+-]+){1,2}$/, "invalid")
  .refine(isValidIanaZone, "invalid");

export const SectorStepSchema = z.strictObject({ sectorId: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "required") });

export const BusinessSchema = z.strictObject({
  name: text(80, 2),
  address: text(120),
  city: text(60),
  timeZone: TimeZoneSchema,
  languages: z
    .array(Lang)
    .min(1, "required")
    .max(2)
    .refine((l) => new Set(l).size === l.length, "invalid"),
  ownerName: text(40),
});

export const TeamSchema = z
  .strictObject({
    members: z.array(text(40)).min(1, "required").max(8, "too_many"),
    concurrent: z.number().int().min(1, "invalid").max(8, "invalid"),
  })
  .refine((t) => new Set(t.members.map((m) => normalizeText(m))).size === t.members.length, { message: "duplicate", path: ["members"] })
  .refine((t) => t.concurrent <= t.members.length, { message: "concurrent_too_high", path: ["concurrent"] });

export const HoursSchema = WeeklyHoursSchema.refine((h) => Object.values(h).some((d) => d && d.length > 0), "no_open_day");

const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

export const ServiceDraftSchema = z.strictObject({
  name: text(80),
  nameEn: optionalText(80),
  durationMin: z.number().int("invalid").min(5, "invalid").max(480, "invalid"),
  priceEur: z.number().min(0, "invalid").max(10_000, "invalid").refine(twoDecimals, "invalid"),
  from: z.boolean(),
});

export const ServicesSchema = z
  .array(ServiceDraftSchema)
  .min(1, "required")
  .max(40, "too_many")
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((s, i) => {
      const key = normalizeText(s.name);
      if (seen.has(key)) ctx.addIssue({ code: "custom", message: "duplicate", path: [i, "name"] });
      seen.add(key);
    });
  });

export const FaqDraftSchema = z.strictObject({
  question: optionalText(120),
  keywords: optionalText(400),
  keywordsEn: optionalText(400),
  answer: optionalText(300),
  answerEn: optionalText(300),
});

/** A row with no answer is skipped; a row with an answer needs its question. */
export const FaqsSchema = z
  .array(FaqDraftSchema)
  .max(20, "too_many")
  .superRefine((rows, ctx) => {
    rows.forEach((r, i) => {
      if (r.answer !== undefined && r.question === undefined) ctx.addIssue({ code: "custom", message: "required", path: [i, "question"] });
    });
  });

export const PinSchema = z
  .strictObject({
    pin: z.string().regex(/^\d{6}$/, "pin_format"),
    pinAgain: z.string(),
    acceptTerms: z.boolean(),
  })
  .refine((p) => p.pin === p.pinAgain, { message: "pin_mismatch", path: ["pinAgain"] })
  .refine((p) => p.acceptTerms, { message: "terms_required", path: ["acceptTerms"] });

export const DraftSchema = z.strictObject({
  sectorId: SectorStepSchema.shape.sectorId,
  business: BusinessSchema,
  team: TeamSchema,
  hours: HoursSchema,
  services: ServicesSchema,
  faq: FaqsSchema,
});
export type Draft = z.infer<typeof DraftSchema>;

/** The body of POST /api/nacer/create. */
export const CreateRequestSchema = z.strictObject({
  draft: DraftSchema,
  pin: z.string().regex(/^\d{6}$/, "pin_format"),
  acceptTerms: z.literal(true),
});
export type CreateRequest = z.infer<typeof CreateRequestSchema>;

/** The words a service or FAQ matcher already reads, so an FAQ keyword never repeats one. */
function serviceWords(services: readonly { id: string; name: { es: string; en: string }; aliases?: readonly string[] }[]): Set<string> {
  const words = new Set<string>();
  for (const s of services) for (const w of [s.id.replace(/-/g, " "), s.name.es, s.name.en, ...(s.aliases ?? [])]) words.add(normalizeText(w));
  return words;
}

const keywordList = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((k) => collapse(k).slice(0, 60))
    .filter((k) => normalizeText(k) !== "");

/**
 * The Shop_Profile of a validated draft, with `id` as its slug. Pure. Resources are the first
 * `concurrent` team names; the address and city are one line; a FAQ keyword that repeats a
 * service word or an earlier entry's keyword is left out (the profile refuses it), and an entry
 * with no answer is skipped. The result still goes through `ShopProfileSchema`.
 */
export function buildProfile(draft: Draft, id: string): ShopProfileInput {
  const { business: b, team } = draft;
  const serviceIds = new Set<string>();
  // A service the owner kept from the sector's starter catalogue keeps what makes callers'
  // words match it (aliases, spoken name, category, add-ons); the owner's name, duration and
  // price win. A service of the owner's own gets only its names.
  const starter = getSectorPack(draft.sectorId).starterCatalogue;
  const starterOf = (name: string, nameEn?: string) =>
    starter?.services.find(
      (sv) => normalizeText(sv.name.es) === normalizeText(name) || (nameEn !== undefined && normalizeText(sv.name.en) === normalizeText(nameEn)),
    );
  const used = new Set<string>();
  const drafted = draft.services.map((s) => {
    const base = starterOf(s.name, s.nameEn);
    const id = base && !used.has(base.id) ? base.id : uniqueId(s.name, serviceIds, 40);
    serviceIds.add(id);
    if (base) used.add(base.id);
    return {
      id,
      name: { es: s.name, en: s.nameEn ?? base?.name.en ?? s.name },
      durationMin: s.durationMin,
      priceCents: Math.round(s.priceEur * 100),
      ...(s.from ? { priceFrom: true } : {}),
      ...(base && base.id === id
        ? {
            ...(base.aliases ? { aliases: [...base.aliases] } : {}),
            ...(base.spokenName ? { spokenName: { ...base.spokenName } } : {}),
            ...(base.category ? { category: base.category } : {}),
            ...(base.goesWith ? { goesWith: [...base.goesWith] } : {}),
            ...(base.addOnTo ? { addOnTo: [...base.addOnTo] } : {}),
          }
        : {}),
    };
  });
  // Links only to services the shop really has; an add-on whose base is gone becomes a plain service.
  const services = drafted.map((s) => {
    const goesWith = s.goesWith?.filter((x) => serviceIds.has(x));
    const addOnTo = s.addOnTo?.filter((x) => serviceIds.has(x));
    const { goesWith: _g, addOnTo: _a, ...rest } = s;
    void _g;
    void _a;
    return { ...rest, ...(goesWith?.length ? { goesWith } : {}), ...(addOnTo?.length ? { addOnTo } : {}) };
  });
  const usedCategories = new Set(services.map((s) => s.category).filter((c): c is string => !!c));
  const categories = (starter?.categories ?? []).filter((c) => usedCategories.has(c.id)).map((c) => ({ ...c, name: { ...c.name }, ...(c.aliases ? { aliases: [...c.aliases] } : {}) }));

  const resourceIds = new Set<string>();
  const resources = team.members.slice(0, team.concurrent).map((m) => ({ id: uniqueId(m, resourceIds, 40), name: { es: m, en: m } }));

  const taken = serviceWords(services);
  const faqIds = new Set<string>();
  const faq: NonNullable<ShopProfileInput["faq"]> = [];
  for (const r of draft.faq) {
    if (r.answer === undefined || r.question === undefined) continue;
    const answerEs = r.answer;
    const answerEn = r.answerEn ?? r.answer;
    const pick = (raw: string[]) => {
      const out: string[] = [];
      for (const k of raw) {
        const key = normalizeText(k);
        if (taken.has(key)) continue;
        out.push(k);
      }
      return out;
    };
    const es = pick([...keywordList(r.keywords), r.question]);
    const en = pick(keywordList(r.keywordsEn).length > 0 ? keywordList(r.keywordsEn) : [...keywordList(r.keywords), r.question]);
    // Reserve the words after picking, so two entries never share one.
    const dedupe = (list: string[]) => [...new Map(list.map((k) => [normalizeText(k), k])).values()];
    const aliasEs = dedupe(es);
    const aliasEn = dedupe(en);
    for (const k of [...aliasEs, ...aliasEn]) taken.add(normalizeText(k));
    let faqId = uniqueId(r.question, faqIds, 40);
    if (BUILT_IN_TOPICS.has(faqId)) faqId = uniqueId(`${faqId}-faq`, faqIds, 40);
    faq.push({
      id: faqId,
      aliases: { es: aliasEs.length > 0 ? aliasEs : [r.question], en: aliasEn.length > 0 ? aliasEn : aliasEs.length > 0 ? aliasEs : [r.question] },
      answer: { es: answerEs, en: answerEn },
    });
  }

  return {
    id,
    name: b.name,
    ownerName: b.ownerName,
    address: `${b.address}, ${b.city}`,
    timeZone: b.timeZone,
    sectorPackId: draft.sectorId,
    languages: b.languages,
    hours: draft.hours,
    services,
    ...(categories.length > 0 ? { categories } : {}),
    resources,
    ...(faq.length > 0 ? { faq } : {}),
  };
}

export type ProfileIssue = { path: string; code: "faq_spoken" | "faq_clash" | "profile_invalid" };

/** The issues `ShopProfileSchema` finds in a draft's profile, as codes the screens can translate. */
export function profileIssues(draft: Draft, id = "check"): ProfileIssue[] {
  const parsed = ShopProfileSchema.safeParse(buildProfile(draft, id));
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => {
    const path = i.path.join(".");
    if (i.path[0] === "faq" && i.path[2] === "answer") return { path, code: "faq_spoken" as const };
    if (i.path[0] === "faq") return { path, code: "faq_clash" as const };
    return { path, code: "profile_invalid" as const };
  });
}

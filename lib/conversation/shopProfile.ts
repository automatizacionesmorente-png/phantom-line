import { z } from "zod";
import type { ShopRules, Weekday, WeeklyHours } from "@/lib/booking";

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

export const ServiceSchema = z.strictObject({
  id: z.string().min(1).max(60),
  name: Localized,
  /** Other words callers use for it ("cortarme el pelo"); used only to match what the caller said. */
  aliases: z.array(z.string().min(1).max(60)).max(20).optional(),
  durationMin: z.number().int().min(5).max(480),
  priceCents: z.number().int().min(0),
});

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
  })
  .refine((p) => new Set(p.services.map((s) => s.id)).size === p.services.length, "service ids must be unique")
  .refine((p) => new Set(p.resources.map((r) => r.id)).size === p.resources.length, "resource ids must be unique");

export type ShopProfile = z.infer<typeof ShopProfileSchema>;
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

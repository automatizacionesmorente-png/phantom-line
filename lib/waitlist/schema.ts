import { z } from "zod";

/**
 * The waitlist request body (BACKLOG 12). Strict: unknown keys are rejected. `consent` must be the
 * literal `true`, so a missing or false box never reaches the database. Text is trimmed and
 * whitespace-collapsed; the email is lowercased so the unique index catches repeats.
 */
const text = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(2).max(max));

export const WaitlistRequestSchema = z
  .object({
    shopName: text(80),
    city: text(60),
    email: z
      .string()
      .transform((v) => v.trim().toLowerCase())
      .pipe(z.string().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Not a valid email")),
    language: z.enum(["es", "en"]),
    consent: z.literal(true),
  })
  .strict();

export type WaitlistRequest = z.infer<typeof WaitlistRequestSchema>;

/** Per-visitor sign-ups per hour, and all sign-ups per day (a flood guard, not a quota). */
export interface WaitlistLimits {
  perVisitorPerHour: number;
  globalPerDay: number;
}
export const DEFAULT_WAITLIST_LIMITS: WaitlistLimits = { perVisitorPerHour: 5, globalPerDay: 200 };

export interface WaitlistStore {
  /** Counts include this request. */
  hit(visitorKey: string, now: import("temporal-polyfill").Temporal.Instant): Promise<{ visitor: number; day: number }>;
  /** `created: false` when the email was already on the list. */
  add(entry: WaitlistRequest, now: import("temporal-polyfill").Temporal.Instant): Promise<{ created: boolean }>;
}

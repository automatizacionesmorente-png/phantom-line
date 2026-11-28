/**
 * The salon routes' contract: zod request schemas and response types (pure, no server
 * imports, so the browser bundle can use them). Every request is a `z.strictObject`.
 */
import { z } from "zod";
import type { AgendaItem } from "@/lib/owner/api";
import type { OutboxKind } from "./settings";
import { isReviewUrl, REVIEW_URL_MAX } from "./settings";
import { EXPENSE_CATEGORIES, MONTH_RE, type ExpenseItem, type MonthReport } from "./month";

const Instant = z.iso.datetime({ offset: true });

/** Spaces, dots and dashes are typed freely; what is left is E.164 or a Spanish 9-digit number (made +34). */
const Phone = z
  .string()
  .transform((s) => s.replace(/[\s.-]/g, ""))
  .pipe(
    z.union([
      z.literal(""),
      z.string().regex(/^\+[0-9]{6,15}$/),
      z
        .string()
        .regex(/^[6-9][0-9]{8}$/)
        .transform((s) => `+34${s}`),
    ]),
  );

/** POST /api/machine/[shopId]/bookings */
export const ManualBookingSchema = z.strictObject({
  resourceId: z.string().min(1).max(100),
  serviceId: z.string().min(1).max(100),
  start: Instant,
  name: z.string().trim().min(1).max(60),
  phone: Phone.optional(),
});
export type ManualBookingRequest = z.infer<typeof ManualBookingSchema>;

/** POST /api/machine/[shopId]/blocks: `resourceId` null blocks the whole shop. */
export const BlockSchema = z.strictObject({
  resourceId: z.string().min(1).max(100).nullable(),
  start: Instant,
  end: Instant,
  reason: z.string().trim().max(80),
});
export type BlockRequest = z.infer<typeof BlockSchema>;

/** GET /api/machine/[shopId]/blocks?from=&to= (both optional: today, 31 days). */
export const BlocksQuerySchema = z.strictObject({ from: Instant.optional(), to: Instant.optional() });

/** POST /api/machine/[shopId]/bookings/[bookingId]/pay and POST .../payments (a product sale). */
const Money = z.number().int().min(0).max(1_000_000);
const Method = z.enum(["cash", "card", "bizum", "voucher"]);
export const PaySchema = z.strictObject({
  amountCents: Money,
  method: Method,
  productCents: Money.optional(),
  productLabel: z.string().trim().max(60).optional(),
});
export type PayRequest = z.infer<typeof PaySchema>;

/** POST /api/machine/[shopId]/bookings/[bookingId]/note: the visit note, at most 500 characters. */
export const VisitNoteSchema = z.strictObject({ note: z.string().max(500) });
export type VisitNoteRequest = z.infer<typeof VisitNoteSchema>;

/** GET /api/machine/[shopId]/payments?day=YYYY-MM-DD (the shop's local day). */
export const PaymentsQuerySchema = z.strictObject({ day: z.iso.date() });

/** ?month=YYYY-MM; the window (24 months back, 1 ahead) is checked by the handler, which has the clock. */
const Month = z.string().regex(MONTH_RE, "Use YYYY-MM");

/** GET /api/machine/[shopId]/month and .../expenses (month optional: the current one). */
export const MonthQuerySchema = z.strictObject({ month: Month.optional() });

/** GET /api/machine/[shopId]/export?month=&format=csv&lang=es|en */
export const ExportQuerySchema = z.strictObject({
  month: Month,
  format: z.literal("csv").optional(),
  lang: z.enum(["es", "en"]).optional(),
});

/**
 * POST /api/machine/[shopId]/expenses. `day` is the date of a one-off expense or the first day of a
 * monthly one (`recurring`); it may not be more than a year ahead.
 */
export const ExpenseSchema = z.strictObject({
  concept: z.string().trim().min(1).max(80),
  amountCents: z.number().int().min(1).max(10_000_000),
  category: z.enum(EXPENSE_CATEGORIES),
  day: z.iso.date(),
  recurring: z.boolean().optional(),
});
export type ExpenseRequest = z.infer<typeof ExpenseSchema>;

/** POST /api/machine/[shopId]/expenses/[expenseId]: stop a monthly expense after `lastMonth`. */
export const EndExpenseSchema = z.strictObject({ action: z.literal("end"), lastMonth: Month });

/**
 * POST /api/machine/[shopId]/settings. The review link is a Google link only (3 hosts, https, at
 * most 300 characters); a request to turn `review` on without one is answered 422 `review_needs_link`.
 */
export const SettingsSchema = z.strictObject({
  automations: z.strictObject({
    reminder: z.boolean(),
    review: z.boolean(),
    gap: z.boolean(),
    winback: z.boolean(),
    birthday: z.boolean(),
  }),
  googleReviewUrl: z.string().max(REVIEW_URL_MAX).refine(isReviewUrl, "Use a Google review link").nullable(),
  vatRatePct: z.number().int().min(0).max(30),
});
export type SettingsRequest = z.infer<typeof SettingsSchema>;

/** POST /api/machine/[shopId]/outbox/[outboxId]: the Owner sent the message by hand, or does not want it. */
export const OutboxActionSchema = z.strictObject({ action: z.enum(["sent", "dismissed"]) });

// ---------------------------------------------------------------------------
// Responses

export type SettingsResponse = SettingsRequest;
export interface OutboxItemDto {
  id: string;
  kind: OutboxKind;
  clientId: string | null;
  bookingId: string | null;
  phone: string;
  /** The client's first name only, or null when there is no named client. */
  clientFirstName: string | null;
  language: "es" | "en";
  body: string;
  status: "prepared" | "sent" | "dismissed";
  createdAt: string;
  actedAt: string | null;
  /** wa.me link with the text ready. */
  waUrl: string;
}
/** The prepared messages first, then the last 30 days of sent and dismissed ones. */
export interface OutboxResponse {
  items: OutboxItemDto[];
}

export type MonthResponse = MonthReport;
export interface ExpensesResponse {
  month: string;
  items: ExpenseItem[];
  totalCents: number;
}
export interface CreateExpenseResponse {
  id: string;
}
/** The CSV text and its file name (the route sends it as a download). */
export interface ExportResult {
  csv: string;
  filename: string;
}

export interface BlockDto {
  id: string;
  resourceId: string | null;
  start: string;
  end: string;
  reason: string;
}
export interface BlocksResponse {
  blocks: BlockDto[];
}
export interface CreateBookingResponse {
  id: string;
}
/** The block is created; `overlapping` are the active bookings under it, for the warning. */
export interface CreateBlockResponse {
  block: BlockDto;
  /** At most 50. */
  overlapping: AgendaItem[];
  /** True when more than 50 bookings are under the block. */
  truncated: boolean;
}
export interface PayResponse {
  id: string;
  booking: AgendaItem | null;
}
export interface VisitNoteTextResponse {
  note: string;
}
export interface VisitNoteResponse {
  ok: true;
}
export interface PaymentsDayResponse {
  day: string;
  totalCents: number;
  byMethod: Record<"cash" | "card" | "bizum" | "voucher", number>;
  count: number;
}

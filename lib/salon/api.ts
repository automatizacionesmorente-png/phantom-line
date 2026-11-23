/**
 * The salon routes' contract: zod request schemas and response types (pure, no server
 * imports, so the browser bundle can use them). Every request is a `z.strictObject`.
 */
import { z } from "zod";
import type { AgendaItem } from "@/lib/owner/api";

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

// ---------------------------------------------------------------------------
// Responses

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
  overlapping: AgendaItem[];
}
export interface PayResponse {
  id: string;
  booking: AgendaItem | null;
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

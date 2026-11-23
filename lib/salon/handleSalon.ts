/**
 * The salon's use cases (spec 2.1, 2.5, 9): manual bookings, time blocks, the cash desk and
 * the visit note. Like handleOwner, I/O only through the deps, and the session is checked
 * before anything personal is read; every read and write names the shop of the session's URL,
 * so an id of another shop is a 404.
 */
import { Temporal } from "temporal-polyfill";
import { checkBooking, localDateOf, overlaps, toInstant } from "@/lib/booking";
import { toShopRules, type ShopProfile } from "@/lib/conversation/shopProfile";
import type { AgendaBooking } from "@/lib/owner/agenda";
import type { MachineErrorBody } from "@/lib/owner/api";
import { LOCKED, fail, sessionFor, type OwnerFailure, type OwnerResult } from "@/lib/owner/handleOwner";
import { toAgendaItem } from "@/lib/owner/poll";
import type { SessionPayload } from "@/lib/owner/session";
import type { Actor } from "@/lib/owner/types";
import { getSectorPack } from "@/lib/sectors";
import type {
  BlockDto,
  BlockRequest,
  BlocksResponse,
  CreateBlockResponse,
  CreateBookingResponse,
  ManualBookingRequest,
  PayRequest,
  PayResponse,
  PaymentsDayResponse,
  VisitNoteResponse,
} from "./api";
import type { SalonDeps, TimeBlock } from "./types";

const MIDNIGHT = Temporal.PlainTime.from("00:00");
/** A service lasts at most 8 h and a day has 25: 48 h either side covers any booking that can touch a start. */
const MARGIN = { hours: 48 };
/** Most days a block list or a block may cover. */
const MAX_BLOCK_DAYS = 400;
/** A booking can be paid up to 12 h before it starts. */
const PAY_AHEAD = { hours: 12 };

const actorOf = (s: SessionPayload): Actor => ({ sessionId: s.sid, label: s.label });
const invalid = (message: string, path: (string | number)[] = []): OwnerFailure =>
  fail(400, { error: "invalid_request", issues: [{ path, message }] } satisfies MachineErrorBody);

const blockDto = (b: TimeBlock): BlockDto => ({
  id: b.id,
  resourceId: b.resourceId,
  start: b.start.toString(),
  end: b.end.toString(),
  reason: b.reason,
});

/** The shop and the session, or the failure to return. Nothing personal is read before this passes. */
async function open(
  shopId: string,
  token: string | undefined,
  d: SalonDeps,
): Promise<{ ok: true; shop: ShopProfile; session: SessionPayload } | OwnerFailure> {
  const access = await d.repo.getShopAccess(shopId);
  if (!access) return fail(404, { error: "shop_not_found" });
  const session = sessionFor(token, shopId, access.pinSetAt, d);
  if (!session) return LOCKED;
  return { ok: true, shop: access.profile, session };
}

// ---------------------------------------------------------------------------
// Manual bookings (spec 9.3, 9.4)

export async function handleCreateBooking(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  req: ManualBookingRequest,
): Promise<OwnerResult<CreateBookingResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const { shop, session } = g;

  const service = shop.services.find((s) => s.id === req.serviceId);
  if (!service) return invalid("Unknown service", ["serviceId"]);
  const resource = shop.resources.find((r) => r.id === req.resourceId);
  if (!resource) return invalid("Unknown resource", ["resourceId"]);

  const start = Temporal.Instant.from(req.start);
  const now = d.clock();
  const rules = toShopRules(shop);
  const pack = getSectorPack(shop.sectorPackId);
  const existing = await d.core.listBookings(shopId, start.subtract(MARGIN), start.add(MARGIN));
  // The Owner picked the resource, so only that one is tried. The Owner may also write down a
  // visit that has already begun: "never in the past" is judged from the earlier of now and the start.
  const verdict = checkBooking(
    { serviceId: service.id, start },
    {
      now: Temporal.Instant.compare(now, start) < 0 ? now : start,
      shop: { ...rules, resources: rules.resources.filter((r) => r.id === resource.id) },
      pack: { slotStepMin: pack.slotStepMin, rules: pack.rules },
      existing,
    },
  );

  if (!verdict.ok) {
    const slots = verdict.alternatives.map((s) => ({ start: s.start.toString(), resourceId: s.resourceId }));
    switch (verdict.reason) {
      case "closed_day":
        return fail(422, { error: "closed" });
      case "all_resources_busy": {
        const end = start.add({ minutes: service.durationMin });
        const touching = existing.filter((b) => b.resourceId === resource.id && overlaps(b, { start, end }));
        return touching.some((b) => b.id.startsWith("block:"))
          ? fail(422, { error: "blocked" })
          : fail(409, { error: "taken", slots });
      }
      default:
        // outside_hours, does_not_fit, a sector rule, or (unreachable here) an unknown service.
        return fail(422, { error: "outside_hours", reason: verdict.reason });
    }
  }

  const r = await d.salon.insertManualBooking({
    shopId,
    resourceId: resource.id,
    serviceId: service.id,
    start: verdict.start,
    end: verdict.end,
    name: req.name,
    phone: req.phone ?? "",
    priceCents: service.priceCents,
    now,
    actor: actorOf(session),
  });
  // Taken between the check and the write (the receptionist, or another device): nothing was written.
  if (!r.ok) return fail(409, { error: "taken", slots: [] });
  return { ok: true, body: { id: r.id } };
}

// ---------------------------------------------------------------------------
// Time blocks (spec 9.4)

export async function handleListBlocks(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  q: { from?: string; to?: string },
): Promise<OwnerResult<BlocksResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const today = localDateOf(d.clock(), g.shop.timeZone);
  const from = q.from ? Temporal.Instant.from(q.from) : toInstant(today, MIDNIGHT, g.shop.timeZone);
  const to = q.to ? Temporal.Instant.from(q.to) : toInstant(today.add({ days: 31 }), MIDNIGHT, g.shop.timeZone);
  if (Temporal.Instant.compare(to, from) <= 0) return invalid("`to` must be after `from`", ["to"]);
  if (to.epochMilliseconds - from.epochMilliseconds > MAX_BLOCK_DAYS * 86_400_000) return invalid("The range is too long", ["to"]);
  const blocks = await d.salon.listBlocks(shopId, from, to);
  return { ok: true, body: { blocks: blocks.map(blockDto) } };
}

export async function handleCreateBlock(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  req: BlockRequest,
): Promise<OwnerResult<CreateBlockResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const { shop } = g;
  if (req.resourceId !== null && !shop.resources.some((r) => r.id === req.resourceId)) {
    return invalid("Unknown resource", ["resourceId"]);
  }
  const start = Temporal.Instant.from(req.start);
  const end = Temporal.Instant.from(req.end);
  if (Temporal.Instant.compare(end, start) <= 0) return invalid("The end must be after the start", ["end"]);
  if (end.epochMilliseconds - start.epochMilliseconds > MAX_BLOCK_DAYS * 86_400_000) return invalid("The block is too long", ["end"]);

  const block = await d.salon.insertBlock({ shopId, resourceId: req.resourceId, start, end, reason: req.reason });
  // The block stands even over bookings: the dialog warns with the ones it covers (spec 9.4).
  const now = d.clock();
  const near = await d.repo.listAgenda(shopId, start.subtract(MARGIN), end);
  const overlapping = near
    .filter(
      (b: AgendaBooking) =>
        b.status === "confirmed" && (req.resourceId === null || b.resourceId === req.resourceId) && overlaps(b, { start, end }),
    )
    .map((b) => toAgendaItem(b, now));
  return { ok: true, body: { block: blockDto(block), overlapping } };
}

export async function handleDeleteBlock(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  blockId: string,
): Promise<OwnerResult<{ ok: true }>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  if (!(await d.salon.deleteBlock(shopId, blockId))) return fail(404, { error: "block_not_found" });
  return { ok: true, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// The cash desk and the visit note (spec 2.5, 9.2)

export async function handlePay(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  bookingId: string,
  req: PayRequest,
): Promise<OwnerResult<PayResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const productCents = req.productCents ?? 0;
  if (productCents > req.amountCents) return invalid("The product cannot be more than the total", ["productCents"]);

  const now = d.clock();
  // Why a booking cannot be paid, from the row as it is now.
  const refusal = async (): Promise<OwnerFailure | null> => {
    const b = await d.repo.getBooking(shopId, bookingId);
    if (!b) return fail(404, { error: "booking_not_found" });
    if (b.status === "cancelled") return fail(409, { error: "cancelled" });
    if (b.paidCents !== null) return fail(409, { error: "already_paid" });
    if (Temporal.Instant.compare(b.start, now.add(PAY_AHEAD)) > 0) return fail(422, { error: "not_yet" });
    return null;
  };
  const refused = await refusal();
  if (refused) return refused;

  const r = await d.salon.insertPayment({
    shopId,
    bookingId,
    amountCents: req.amountCents,
    method: req.method,
    productCents,
    productLabel: req.productLabel ?? "",
    now,
    actor: actorOf(g.session),
  });
  if (!r.ok) {
    // Lost a race (paid or cancelled in between): say which.
    return (await refusal()) ?? fail(409, { error: "already_paid" });
  }
  const fresh = await d.repo.getBooking(shopId, bookingId);
  return { ok: true, body: { id: r.id, booking: fresh ? toAgendaItem(fresh, now) : null } };
}

/** A product sale with no booking (POST .../payments). `productCents` defaults to the whole amount. */
export async function handleSale(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  req: PayRequest,
): Promise<OwnerResult<PayResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  if (req.amountCents === 0) return invalid("The amount must be more than zero", ["amountCents"]);
  const productCents = req.productCents ?? req.amountCents;
  if (productCents > req.amountCents) return invalid("The product cannot be more than the total", ["productCents"]);
  const r = await d.salon.insertPayment({
    shopId,
    bookingId: null,
    amountCents: req.amountCents,
    method: req.method,
    productCents,
    productLabel: req.productLabel ?? "",
    now: d.clock(),
    actor: actorOf(g.session),
  });
  if (!r.ok) throw new Error("A product sale was not written");
  return { ok: true, body: { id: r.id, booking: null } };
}

export async function handleVisitNote(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  bookingId: string,
  note: string,
): Promise<OwnerResult<VisitNoteResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  if (!(await d.salon.setVisitNote(shopId, bookingId, note.trim()))) return fail(404, { error: "booking_not_found" });
  return { ok: true, body: { ok: true } };
}

/** Today's totals by method: the cash strip (Task 10). `day` is a local date of the shop. */
export async function handlePaymentsDay(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  day: string,
): Promise<OwnerResult<PaymentsDayResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const date = Temporal.PlainDate.from(day);
  const rows = await d.salon.listPayments(
    shopId,
    toInstant(date, MIDNIGHT, g.shop.timeZone),
    toInstant(date.add({ days: 1 }), MIDNIGHT, g.shop.timeZone),
  );
  const byMethod = { cash: 0, card: 0, bizum: 0, voucher: 0 };
  for (const p of rows) byMethod[p.method] += p.amountCents;
  return {
    ok: true,
    body: { day, totalCents: rows.reduce((n, p) => n + p.amountCents, 0), byMethod, count: rows.length },
  };
}

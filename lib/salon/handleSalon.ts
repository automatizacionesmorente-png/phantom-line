/**
 * The salon's use cases (spec 2.1, 2.5, 9): manual bookings, time blocks, the cash desk and
 * the visit note. Like handleOwner, I/O only through the deps, and the session is checked
 * before anything personal is read; every read and write names the shop of the session's URL,
 * so an id of another shop is a 404.
 */
import { Temporal } from "temporal-polyfill";
import { checkBooking, localDateOf, overlaps, toInstant } from "@/lib/booking";
import { summarize } from "@/lib/clients/summary";
import { whatsappUrl } from "@/lib/clients/winback";
import { toShopRules, type ShopProfile } from "@/lib/conversation/shopProfile";
import type { AgendaBooking } from "@/lib/owner/agenda";
import type { MachineErrorBody } from "@/lib/owner/api";
import { CLIENTS_LIMIT, LOCKED, fail, sessionFor, type OwnerFailure, type OwnerResult } from "@/lib/owner/handleOwner";
import { toAgendaItem } from "@/lib/owner/poll";
import type { SessionPayload } from "@/lib/owner/session";
import type { Actor } from "@/lib/owner/types";
import { getSectorPack } from "@/lib/sectors";
import type {
  BlockDto,
  CreateExpenseResponse,
  ExpenseRequest,
  ExpensesResponse,
  ExportResult,
  MonthResponse,
  BlockRequest,
  BlocksResponse,
  CreateBlockResponse,
  CreateBookingResponse,
  ManualBookingRequest,
  PayRequest,
  PayResponse,
  PaymentsDayResponse,
  OutboxItemDto,
  OutboxResponse,
  SettingsRequest,
  SettingsResponse,
  VisitNoteResponse,
  VisitNoteTextResponse,
} from "./api";
import { MAX_DRAFTS, planOutbox, type OutboxClient } from "./outbox";
import { OUTBOX_KINDS, type SalonSettings } from "./settings";
import {
  GAP_WINDOW_HOURS,
  addMonths,
  exportCsv,
  monthBounds,
  monthExpenses,
  monthInWindow,
  monthOf,
  monthReport,
} from "./month";
import type { OutboxRow, SalonDeps, TimeBlock } from "./types";

const MIDNIGHT = Temporal.PlainTime.from("00:00");
/** A service lasts at most 8 h and a day has 25: 48 h either side covers any booking that can touch a start. */
const MARGIN = { hours: 48 };
/** Most days a block list or a block may cover. */
const MAX_BLOCK_DAYS = 400;
/** A booking can be paid up to 12 h before it starts. */
const PAY_AHEAD = { hours: 12 };
/** A manual booking or a block starts at most this far ahead. */
const MAX_AHEAD_DAYS = 365;
/** The most bookings the warning of a new block lists. */
const MAX_OVERLAPPING = 50;
/** Most rows of each kind a shop may keep: a cheap guard against a runaway client. */
export const MAX_EXPENSES = 5000;
export const MAX_BLOCKS = 2000;
const addDays = (i: Temporal.Instant, days: number) => i.add({ hours: days * 24 });

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
  // Not before the shop's today (a visit can be written down later the same day), not over a year ahead.
  const todayStart = toInstant(localDateOf(now, shop.timeZone), MIDNIGHT, shop.timeZone);
  if (Temporal.Instant.compare(start, todayStart) < 0) return fail(422, { error: "in_the_past" });
  if (Temporal.Instant.compare(start, addDays(now, MAX_AHEAD_DAYS)) > 0) return fail(422, { error: "too_far" });
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
        // Blocked or taken? Ask the blocks themselves, not the shape of the busy list ids.
        const end = start.add({ minutes: service.durationMin });
        const blocks = await d.salon.listBlocks(shopId, start, end);
        return blocks.some((b) => b.resourceId === null || b.resourceId === resource.id)
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
  if (Temporal.Instant.compare(start, addDays(d.clock(), MAX_AHEAD_DAYS)) > 0) return invalid("The block starts too far ahead", ["start"]);
  if (end.epochMilliseconds - start.epochMilliseconds > MAX_BLOCK_DAYS * 86_400_000) return invalid("The block is too long", ["end"]);

  if ((await d.salon.countBlocks(shopId)) >= MAX_BLOCKS) return fail(409, { error: "limit_reached" });
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
  return {
    ok: true,
    body: { block: blockDto(block), overlapping: overlapping.slice(0, MAX_OVERLAPPING), truncated: overlapping.length > MAX_OVERLAPPING },
  };
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
  // Paying a pending (unconfirmed) booking is allowed on purpose: the client came.
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
  // A note on a cancelled booking is allowed on purpose.
  if (!(await d.salon.setVisitNote(shopId, bookingId, note.trim()))) return fail(404, { error: "booking_not_found" });
  return { ok: true, body: { ok: true } };
}

/** The visit note text, read on demand because the poll only says whether there is one. */
export async function handleGetVisitNote(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  bookingId: string,
): Promise<OwnerResult<VisitNoteTextResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const b = await d.repo.getBooking(shopId, bookingId);
  if (!b) return fail(404, { error: "booking_not_found" });
  return { ok: true, body: { note: b.visitNote } };
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

// ---------------------------------------------------------------------------
// Month report, expenses and the accountant's export (spec 2.3, 9.5, 9.6, 9.12)

/** The month asked for (default: the current one), or the 400 for one outside 24 months back / 1 ahead. */
function monthParam(month: string | undefined, shop: ShopProfile, d: SalonDeps): { ok: true; month: string } | OwnerFailure {
  const now = d.clock();
  const m = month ?? monthOf(now, shop.timeZone);
  return monthInWindow(m, now, shop.timeZone) ? { ok: true, month: m } : invalid("The month is outside the last 24 months and the next one", ["month"]);
}

const expensesOf = async (d: SalonDeps, shopId: string, month: string) =>
  monthExpenses(await d.salon.listExpenses(shopId, month), month);

async function totalsOf(d: SalonDeps, shopId: string, month: string, tz: string) {
  const { start, end } = monthBounds(month, tz);
  const [payments, expenses] = await Promise.all([d.salon.listPayments(shopId, start, end), expensesOf(d, shopId, month)]);
  const takenCents = payments.reduce((n, p) => n + p.amountCents, 0);
  const expensesCents = expenses.reduce((n, e) => n + e.amountCents, 0);
  return { takenCents, expensesCents, leftCents: takenCents - expensesCents };
}

export async function handleMonth(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  q: { month?: string },
): Promise<OwnerResult<MonthResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const { shop } = g;
  const m = monthParam(q.month, shop, d);
  if (!m.ok) return m;
  const tz = shop.timeZone;
  const { start, end } = monthBounds(m.month, tz);
  const [payments, expenses, bookings, calls, gapSends, prev] = await Promise.all([
    d.salon.listPayments(shopId, start, end),
    expensesOf(d, shopId, m.month),
    d.salon.listMonthBookings(shopId, start, end),
    d.salon.listMonthCalls(shopId, start, end),
    d.salon.listGapSends(shopId, start.subtract({ hours: GAP_WINDOW_HOURS }), end),
    totalsOf(d, shopId, addMonths(m.month, -1), tz),
  ]);
  const catalogue = Object.fromEntries(shop.services.map((s) => [s.id, s.priceCents]));
  return { ok: true, body: monthReport({ month: m.month, tz, payments, expenses, bookings, calls, gapSends, prev, catalogue }) };
}

export async function handleListExpenses(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  q: { month?: string },
): Promise<OwnerResult<ExpensesResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const m = monthParam(q.month, g.shop, d);
  if (!m.ok) return m;
  const items = await expensesOf(d, shopId, m.month);
  return { ok: true, body: { month: m.month, items, totalCents: items.reduce((n, e) => n + e.amountCents, 0) } };
}

export async function handleCreateExpense(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  req: ExpenseRequest,
): Promise<OwnerResult<CreateExpenseResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const now = d.clock();
  const tz = g.shop.timeZone;
  const today = localDateOf(now, tz);
  const day = Temporal.PlainDate.from(req.day);
  if (Temporal.PlainDate.compare(day, today.add({ years: 1 })) > 0) return invalid("The date is more than a year ahead", ["day"]);
  // The reports reach back 24 months, so an older expense could never be seen.
  if (!monthInWindow(req.day.slice(0, 7), now, tz, 24, 12)) return invalid("The date is too far back", ["day"]);
  if ((await d.salon.countExpenses(shopId)) >= MAX_EXPENSES) return fail(409, { error: "limit_reached" });
  const id = await d.salon.insertExpense({
    shopId,
    concept: req.concept,
    category: req.category,
    amountCents: req.amountCents,
    day: req.day,
    recurring: req.recurring ?? false,
  });
  return { ok: true, body: { id } };
}

export async function handleDeleteExpense(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  expenseId: string,
): Promise<OwnerResult<{ ok: true }>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  if (!(await d.salon.deleteExpense(shopId, expenseId))) return fail(404, { error: "expense_not_found" });
  return { ok: true, body: { ok: true } };
}

/** Ends a monthly expense after `lastMonth`: the client then POSTs a new one from the current month to change its amount. */
export async function handleEndExpense(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  expenseId: string,
  lastMonth: string,
): Promise<OwnerResult<{ ok: true }>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const m = monthParam(lastMonth, g.shop, d);
  if (!m.ok) return invalid("The month is outside the last 24 months and the next one", ["lastMonth"]);
  if (!(await d.salon.endRecurring(shopId, expenseId, lastMonth))) return fail(404, { error: "expense_not_found" });
  return { ok: true, body: { ok: true } };
}

export async function handleExport(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  q: { month: string; lang?: "es" | "en" },
): Promise<OwnerResult<ExportResult>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const { shop } = g;
  const m = monthParam(q.month, shop, d);
  if (!m.ok) return m;
  const lang = q.lang ?? "es";
  const { start, end } = monthBounds(m.month, shop.timeZone);
  const [payments, rows, vat] = await Promise.all([
    d.salon.listPayments(shopId, start, end),
    d.salon.listExpenses(shopId, m.month),
    d.salon.vatRatePct(shopId),
  ]);
  const expenses = monthExpenses(rows, m.month);
  const report = monthReport({ month: m.month, tz: shop.timeZone, payments, expenses, bookings: [], calls: [], gapSends: [] });
  const names = Object.fromEntries(shop.services.map((s) => [s.id, s.name[lang]]));
  const safe = shopId.replace(/[^A-Za-z0-9_-]/g, "_");
  return { ok: true, body: { csv: exportCsv(report, payments, expenses, vat, lang, names), filename: `phantom-line-${safe}-${m.month}.csv` } };
}

// ---------------------------------------------------------------------------
// Settings and the outbox (spec 2.4, 9.7, 9.8)

const OUTBOX_HISTORY_DAYS = 30;
/** The bookings one run of the outbox reads. */
const OUTBOX_BOOKINGS_LIMIT = 200;

const settingsDto = (s: SalonSettings): SettingsResponse => ({
  automations: s.automations,
  googleReviewUrl: s.googleReviewUrl,
  vatRatePct: s.vatRatePct,
});

export async function handleGetSettings(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
): Promise<OwnerResult<SettingsResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  return { ok: true, body: settingsDto(await d.salon.getSettings(shopId)) };
}

export async function handleSaveSettings(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  req: SettingsRequest,
): Promise<OwnerResult<SettingsResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  if (req.automations.review && req.googleReviewUrl === null) return fail(422, { error: "review_needs_link" });
  // The switches that are now off dismiss what was waiting, in the same transaction as the save.
  await d.salon.saveSettings(shopId, req, d.clock());
  return { ok: true, body: settingsDto(await d.salon.getSettings(shopId)) };
}

const outboxDto = (r: OutboxRow): OutboxItemDto => ({
  id: r.id,
  kind: r.kind,
  clientId: r.clientId,
  bookingId: r.bookingId,
  phone: r.phone,
  clientFirstName: r.clientFirstName ?? null,
  language: r.language,
  body: r.body,
  status: r.status,
  createdAt: r.createdAt.toString(),
  actedAt: r.actedAt?.toString() ?? null,
  waUrl: whatsappUrl(r.phone, r.body),
});

/** Dismisses the prepared messages of kinds that are off now, without consent, or for a cancelled booking. */
async function dismissStaleNow(d: SalonDeps, shopId: string, now: Temporal.Instant): Promise<void> {
  const fresh = await d.salon.getSettings(shopId);
  await d.salon.dismissStale(shopId, OUTBOX_KINDS.filter((k) => !fresh.automations[k]), now);
}

/** Opening the outbox writes what is due (once per key), then lists it. */
export async function handleOutbox(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
): Promise<OwnerResult<OutboxResponse>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  const { shop } = g;
  const now = d.clock();
  const tz = shop.timeZone;
  const settings = await d.salon.getSettings(shopId);
  const on = settings.automations;

  if (Object.values(on).some(Boolean)) {
    const today = localDateOf(now, tz);
    const [bookingRows, existingKeys, records] = await Promise.all([
      d.salon.listOutboxBookings(
        shopId,
        {
          remindFrom: toInstant(today.add({ days: 1 }), MIDNIGHT, tz),
          remindTo: toInstant(today.add({ days: 2 }), MIDNIGHT, tz),
          paidSince: now.subtract({ hours: 48 }),
          cancelledSince: now.subtract({ hours: 24 }),
          now,
          gapTo: now.add({ hours: 72 }),
        },
        OUTBOX_BOOKINGS_LIMIT,
      ),
      d.salon.outboxKeys(shopId),
      on.gap || on.winback || on.birthday ? d.repo.listClients(shopId, CLIENTS_LIMIT) : Promise.resolve([]),
    ]);
    const clients: OutboxClient[] = records.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      language: r.language,
      birthday: r.birthday,
      promoConsentAt: r.promoConsentAt,
      summary: summarize(r.bookings, now),
    }));
    const drafts = planOutbox({
      now,
      tz,
      shop: { name: shop.name },
      settings,
      bookings: bookingRows.filter((b) => b.status === "confirmed"),
      cancellations: bookingRows.filter((b) => b.status === "cancelled"),
      clients,
      existingKeys,
    }).slice(0, MAX_DRAFTS);
    await d.salon.insertOutbox(drafts.map((x) => ({ shopId, ...x })));
  }

  // Settings, consent and bookings may have changed while this ran (or since the rows were made):
  // what no longer stands is dismissed here, so it is never shown or sendable.
  await dismissStaleNow(d, shopId, now);
  const rows = await d.salon.listOutbox(shopId, now.subtract({ hours: OUTBOX_HISTORY_DAYS * 24 }), 200);
  return { ok: true, body: { items: rows.map(outboxDto) } };
}

export async function handleOutboxAction(
  d: SalonDeps,
  shopId: string,
  token: string | undefined,
  outboxId: string,
  action: "sent" | "dismissed",
): Promise<OwnerResult<OutboxItemDto>> {
  const g = await open(shopId, token, d);
  if (!g.ok) return g;
  await dismissStaleNow(d, shopId, d.clock());
  const r = await d.salon.setOutboxStatus(shopId, outboxId, action, d.clock());
  if (r === "not_found") return fail(404, { error: "outbox_not_found" });
  if (r === "not_prepared") return fail(409, { error: "not_prepared" });
  return { ok: true, body: outboxDto(r) };
}

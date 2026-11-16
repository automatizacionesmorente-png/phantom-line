/**
 * The owner side's use cases (owner-machine design, "handleOwner (ports)"): login, the Poll,
 * the Message actions, the Booking actions and the Move_Slots. I/O only through `OwnerDeps`,
 * so tests run it on PGlite with fixed clocks and the HTTP layer (app/api/machine/handlers.ts)
 * stays a thin translation of these results into Responses.
 *
 * Every function that needs a session takes the raw cookie `token` and verifies it itself,
 * against the `owner_pin_set_at` it reads in the same query as the data it was going to read
 * anyway (1.8). So nothing personal is read before the session is checked (14.1).
 */
import { Temporal } from "temporal-polyfill";
import { daySlots, localDateOf, toInstant, type Slot } from "@/lib/booking";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { Clock, Repository } from "@/lib/conversation/types";
import { agreedText } from "@/lib/messages/agreedText";
import { currentReply } from "@/lib/messages/currentReply";
import { getSectorPack, type SectorPack } from "@/lib/sectors";
import { agendaWindow, allowedActions, groupAgenda, type AgendaBooking } from "./agenda";
import type {
  BookingActionRequest,
  BookingActionResponse,
  EraseResponse,
  MachineErrorBody,
  PlayResponse,
  PollResponse,
  SlotDto,
  SlotsResponse,
  TapeItem,
} from "./api";
import { isDemoShop } from "./demo";
import { runDemoRetention } from "./demoRetention";
import { checkPinAttempts, pinCounterKeys, type PinLimitConfig } from "./limits";
import { decideMove, isMoveDay, moveContext } from "./move";
import { verifyPin } from "./pin";
import { pollResponse, toAgendaDays, toAgendaItem, type Snapshot } from "./poll";
import {
  SESSION_HOURS,
  isUsableSessionSecret,
  normalizeLabel,
  pinVersionOf,
  signSession,
  verifySession,
  type SessionPayload,
} from "./session";
import { consoleOwnerLogger, type Actor, type OwnerCommandResult, type OwnerLogger, type OwnerRepository, type TapeRow } from "./types";

export interface OwnerDeps {
  repo: OwnerRepository;
  /** The same read the caller's path uses, so a move sees what a caller would see. */
  core: Pick<Repository, "listBookings">;
  clock: Clock;
  newId: () => string;
  /** OWNER_SESSION_SECRET, read per request. */
  secret: () => string | undefined;
  pinLimits: PinLimitConfig;
  log?: OwnerLogger;
}

/** The most Messages one Poll sends (design, "The Tape"). */
export const TAPE_LIMIT = 200;

export type OwnerFailure = {
  ok: false;
  status: 400 | 401 | 404 | 409 | 429 | 503;
  /** `null` is the empty `401 locked` body (1.8). */
  body: MachineErrorBody | null;
};
export type OwnerResult<T> = { ok: true; body: T } | OwnerFailure;

const fail = (status: OwnerFailure["status"], body: MachineErrorBody | null): OwnerFailure => ({ ok: false, status, body });
const LOCKED = fail(401, null);

/** The session in the cookie, if it is valid for this shop, this PIN version and this moment. */
function sessionFor(
  token: string | undefined,
  shopId: string,
  pinSetAt: Temporal.Instant | null,
  d: OwnerDeps,
): SessionPayload | null {
  const secret = d.secret();
  if (!isUsableSessionSecret(secret)) return null;
  const check = verifySession(token, secret, { shopId, now: d.clock(), pinSetAt });
  return check.ok ? check.session : null;
}

const actorOf = (s: SessionPayload): Actor => ({ sessionId: s.sid, label: s.label });
const slotDtos = (slots: readonly Slot[]): SlotDto[] =>
  slots.map((s) => ({ start: s.start.toString(), resourceId: s.resourceId }));

// ---------------------------------------------------------------------------
// Login (1.3–1.5, 2)

export interface LoginInput {
  shopId: string;
  pin: string;
  label?: string;
  visitorKey: string;
}

export interface LoginGranted {
  token: string;
  maxAgeSeconds: number;
}

export async function handleLogin(i: LoginInput, d: OwnerDeps): Promise<OwnerResult<LoginGranted>> {
  const log = d.log ?? consoleOwnerLogger;
  const now = d.clock();
  const access = await d.repo.getShopAccess(i.shopId);
  if (!access) return fail(404, { error: "shop_not_found" });
  if (access.pinHash === null || access.pinSetAt === null) {
    log({ event: "owner_auth", outcome: "no_pin", shopId: i.shopId });
    return fail(409, { error: "no_pin" });
  }
  const secret = d.secret();
  if (!isUsableSessionSecret(secret)) {
    log({ event: "owner_auth", outcome: "misconfigured", shopId: i.shopId });
    return fail(503, { error: "machine_not_configured" });
  }

  // The attempt is counted before the PIN is looked at, so a blocked try never reveals
  // whether the PIN was right (2.2).
  const demo = isDemoShop(i.shopId);
  const counts = await d.repo.hitCounters(pinCounterKeys(i.shopId, i.visitorKey, now, demo));
  const seen = { visitor: counts[0] ?? 0, shop: demo ? null : (counts[1] ?? 0) };
  const decision = checkPinAttempts(seen, d.pinLimits);
  if (decision.blocked) {
    log({ event: "owner_auth", outcome: "rate_limited", shopId: i.shopId, limit: decision.limit, counts: seen });
    return fail(429, { error: "too_many_tries" });
  }
  if (!(await verifyPin(i.pin, access.pinHash))) {
    log({ event: "owner_auth", outcome: "wrong_pin", shopId: i.shopId, counts: seen });
    return fail(401, { error: "wrong_pin" });
  }

  const iat = Math.floor(now.epochMilliseconds / 1000);
  const token = signSession(
    {
      v: 1,
      shopId: i.shopId,
      sid: d.newId(),
      label: normalizeLabel(i.label, access.profile.languages[0] ?? "es"),
      iat,
      exp: iat + SESSION_HOURS * 3600,
      pv: pinVersionOf(access.pinSetAt),
    },
    secret,
  );
  // A judge's first view is already clean (16.6). It never throws and only runs after a right PIN.
  if (demo) await runDemoRetention({ repo: d.repo, clock: d.clock, newId: d.newId, log: d.log });
  return { ok: true, body: { token, maxAgeSeconds: SESSION_HOURS * 3600 } };
}


// ---------------------------------------------------------------------------
// The Tape and the Agenda as the page needs them

/** One stored Message as a TapeItem: Agreed_Text and Current_Reply from the Booking as it is now (4.6, 4.7). */
export function tapeItemOf(row: TapeRow, shop: ShopProfile, pack: SectorPack): TapeItem {
  const booking = row.booking;
  const agreed: TapeItem["agreed"] = booking
    ? {
        byLang: {
          es: agreedText(row.outcome, booking, "es", shop, pack),
          en: agreedText(row.outcome, booking, "en", shop, pack),
        },
      }
    : { stored: row.agreed };
  return {
    id: row.id,
    channel: row.channel,
    createdAt: row.createdAt.toString(),
    heard: row.heard,
    callerName: row.callerName,
    callerPhone: row.callerPhone,
    reason: row.reason,
    urgency: row.urgency,
    urgencyBasis: row.urgencyBasis,
    agreed,
    currentReply: currentReply(
      { suggestedReply: row.suggestedReply, callerName: row.callerName, createdAt: row.createdAt },
      row.booking,
      row.callLang,
      shop,
      pack,
    ),
    replyLang: row.callLang,
    ownerLang: shop.languages[0] ?? "es",
    outcome: row.outcome,
    modelFailed: row.modelFailed,
    sample: row.sample,
  };
}

/** The Tape (without Transcripts) and the 8-day Agenda, read at one moment. */
export async function buildSnapshot(shop: ShopProfile, d: Pick<OwnerDeps, "repo" | "clock">): Promise<Snapshot> {
  const now = d.clock();
  const pack = getSectorPack(shop.sectorPackId);
  const window = agendaWindow(now, shop.timeZone);
  const [rows, bookings] = await Promise.all([
    d.repo.listTape(shop.id, TAPE_LIMIT),
    d.repo.listAgenda(shop.id, window.from, window.to),
  ]);
  return {
    now: now.toString(),
    tape: rows.map((r) => tapeItemOf(r, shop, pack)),
    agenda: toAgendaDays(groupAgenda(bookings, window, shop.timeZone), now),
  };
}

// ---------------------------------------------------------------------------
// The Poll (12)

export async function handlePoll(
  i: { shopId: string; since: number | null; token: string | undefined },
  d: OwnerDeps,
): Promise<OwnerResult<PollResponse>> {
  let head = await d.repo.pollHead(i.shopId);
  if (!head) return fail(404, { error: "shop_not_found" });
  if (!sessionFor(i.token, i.shopId, head.pinSetAt, d)) return LOCKED;

  // A machine left open keeps the demo clean. The claim makes this one cheap UPDATE on most
  // Polls; when it did run, the version may have moved, so the head is read again (16.6).
  if (isDemoShop(i.shopId)) {
    const ran = await runDemoRetention({ repo: d.repo, clock: d.clock, newId: d.newId, log: d.log });
    if (ran) head = (await d.repo.pollHead(i.shopId)) ?? head;
  }
  const body = await pollResponse(i.since, head, async () => {
    const access = await d.repo.getShopAccess(i.shopId);
    if (!access) throw new Error(`Shop "${i.shopId}" disappeared during a Poll`);
    return buildSnapshot(access.profile, d);
  });
  return { ok: true, body };
}

// ---------------------------------------------------------------------------
// Messages (7.4, 7.6, 8)

export async function handleMessageAction(
  i: { shopId: string; messageId: string; action: "play" | "erase"; token: string | undefined },
  d: OwnerDeps,
): Promise<OwnerResult<PlayResponse | EraseResponse>> {
  const head = await d.repo.pollHead(i.shopId);
  if (!head) return fail(404, { error: "shop_not_found" });
  const session = sessionFor(i.token, i.shopId, head.pinSetAt, d);
  if (!session) return LOCKED;
  const notFound = fail(404, { error: "message_not_found" });
  const cmd = { shopId: i.shopId, messageId: i.messageId, actor: actorOf(session), now: d.clock() };

  if (i.action === "erase") {
    const r = await d.repo.applyOwnerCommand({ kind: "erase", ...cmd });
    if (r.status === "not_found") return notFound;
    // `noop` (already erased) answers like the first erase: erasing twice is one erase (8.2).
    return { ok: true, body: { version: r.version } };
  }

  // The Transcript is read first: a Message erased elsewhere is `404`, and is never marked heard.
  const transcript = await d.repo.getTranscript(i.shopId, i.messageId);
  if (!transcript) return notFound;
  const r = await d.repo.applyOwnerCommand({ kind: "play", ...cmd });
  if (r.status === "not_found") return notFound;
  return { ok: true, body: { version: r.version, transcript: transcript.lines, lang: transcript.lang } };
}

// ---------------------------------------------------------------------------
// Bookings (10)

const MIDNIGHT = Temporal.PlainTime.from("00:00");

/** Active bookings that can touch a day's sessions: two days either side cover any Service (at most 8 h) and the 25-hour day. */
function readExisting(shopId: string, from: Temporal.Instant, to: Temporal.Instant, d: OwnerDeps) {
  return d.core.listBookings(shopId, from.subtract({ hours: 48 }), to.add({ hours: 48 }));
}

async function slotsOn(
  booking: AgendaBooking,
  date: Temporal.PlainDate,
  shop: ShopProfile,
  pack: SectorPack,
  d: OwnerDeps,
): Promise<Slot[]> {
  const from = toInstant(date, MIDNIGHT, shop.timeZone);
  const to = toInstant(date.add({ days: 1 }), MIDNIGHT, shop.timeZone);
  const existing = await readExisting(shop.id, from, to, d);
  const ctx = moveContext(booking, shop, pack, d.clock(), existing);
  return daySlots({ serviceId: booking.serviceId, ignoreBookingId: booking.id }, date, ctx);
}

export async function handleBookingAction(
  i: { shopId: string; bookingId: string; req: BookingActionRequest; token: string | undefined },
  d: OwnerDeps,
): Promise<OwnerResult<BookingActionResponse>> {
  const access = await d.repo.getShopAccess(i.shopId);
  if (!access) return fail(404, { error: "shop_not_found" });
  const session = sessionFor(i.token, i.shopId, access.pinSetAt, d);
  if (!session) return LOCKED;

  const shop = access.profile;
  const pack = getSectorPack(shop.sectorPackId);
  const now = d.clock();
  const booking = await d.repo.getBooking(i.shopId, i.bookingId);
  if (!booking) return fail(404, { error: "booking_not_found" });

  const current = (b: AgendaBooking) => toAgendaItem(b, now);
  // Another device (or the caller) changed it since this screen loaded: show the current row (10.7).
  if (booking.revision !== i.req.revision) return fail(409, { error: "stale", booking: current(booking) });

  const { req } = i;
  const allowed = allowedActions(booking, now);
  // Confirming an already confirmed booking is a `noop`, not an error (10.2): any action is
  // offered while the booking is active and has not started.
  if (req.action === "confirm" ? allowed.length === 0 : !allowed.includes(req.action)) {
    return fail(409, { error: "not_allowed" });
  }

  const base = { shopId: i.shopId, bookingId: i.bookingId, revision: req.revision, actor: actorOf(session), now };
  let result: OwnerCommandResult;
  let moveDate: Temporal.PlainDate | null = null;
  if (req.action === "move") {
    const start = Temporal.Instant.from(req.start);
    const existing = await readExisting(i.shopId, start, start, d);
    const decision = decideMove({ booking, start, now, shop, pack, existing });
    if (!decision.ok) {
      if (decision.reason === "not_movable") return fail(409, { error: "not_allowed" });
      return fail(409, { error: "rejected", reason: decision.reason, slots: slotDtos(decision.slots) });
    }
    const v = decision.verdict;
    moveDate = localDateOf(start, shop.timeZone);
    result = await d.repo.applyOwnerCommand({
      kind: "move",
      ...base,
      to: { start: v.start, end: v.end, resourceId: v.resourceId },
    });
  } else {
    result = await d.repo.applyOwnerCommand({ kind: req.action, ...base });
  }

  switch (result.status) {
    case "applied":
    case "noop": {
      const fresh = await d.repo.getBooking(i.shopId, i.bookingId);
      if (!fresh) return fail(404, { error: "booking_not_found" });
      return { ok: true, body: { version: result.version, booking: current(fresh) } };
    }
    case "stale": {
      const fresh = await d.repo.getBooking(i.shopId, i.bookingId);
      return fresh ? fail(409, { error: "stale", booking: current(fresh) }) : fail(404, { error: "booking_not_found" });
    }
    case "not_found":
      return fail(404, { error: "booking_not_found" });
    case "overlap": {
      // Taken between listing and saving: nothing was written, no automatic retry (10.5).
      const slots = moveDate ? await slotsOn(booking, moveDate, shop, pack, d) : [];
      return fail(409, { error: "taken", slots: slotDtos(slots) });
    }
  }
}

export async function handleSlots(
  i: { shopId: string; bookingId: string; date: string; token: string | undefined },
  d: OwnerDeps,
): Promise<OwnerResult<SlotsResponse>> {
  const access = await d.repo.getShopAccess(i.shopId);
  if (!access) return fail(404, { error: "shop_not_found" });
  if (!sessionFor(i.token, i.shopId, access.pinSetAt, d)) return LOCKED;

  const shop = access.profile;
  const now = d.clock();
  const booking = await d.repo.getBooking(i.shopId, i.bookingId);
  if (!booking) return fail(404, { error: "booking_not_found" });
  if (!allowedActions(booking, now).includes("move")) return fail(409, { error: "not_allowed" });

  const date = Temporal.PlainDate.from(i.date);
  if (!isMoveDay(date, now, shop.timeZone)) {
    return fail(400, {
      error: "invalid_request",
      issues: [{ path: ["date"], message: "The date is outside the days a booking can be moved to" }],
    });
  }
  const slots = await slotsOn(booking, date, shop, getSectorPack(shop.sectorPackId), d);
  return { ok: true, body: { slots: slotDtos(slots) } };
}

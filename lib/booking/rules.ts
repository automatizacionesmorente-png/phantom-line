import { Temporal } from "temporal-polyfill";
import { localDateOf, overlaps, sessionsOn } from "./time";
import type {
  BookingRequest,
  Evaluation,
  RuleContext,
  SessionInstants,
  SlotSearchOptions,
  Verdict,
} from "./types";
import { findNearestSlots } from "./slots";

type SessionsOf = (date: Temporal.PlainDate) => readonly SessionInstants[];

/**
 * The evaluation itself, with the per-date session lookup injected so the slot
 * search can reuse it across thousands of candidates. Same result as
 * `evaluateBooking` for any lookup that returns `sessionsOn(date, ctx.shop)`.
 */
export function evaluateWith(
  req: BookingRequest,
  ctx: RuleContext,
  sessionsOf: SessionsOf,
): Evaluation {
  const cmp = Temporal.Instant.compare;

  // 1. The service must be in the catalog.
  const service = ctx.shop.services.find((s) => s.id === req.serviceId);
  if (!service) return { ok: false, reason: "unknown_service" };

  // 2. Never in the past.
  if (cmp(req.start, ctx.now) < 0) return { ok: false, reason: "in_the_past" };

  // 3. The local date must have sessions.
  const sessions = sessionsOf(localDateOf(req.start, ctx.shop.timeZone));
  if (sessions.length === 0) return { ok: false, reason: "closed_day" };

  // 4. The start must fall inside a session: open <= start < close.
  const session = sessions.find((s) => cmp(s.open, req.start) <= 0 && cmp(req.start, s.close) < 0);
  if (!session) return { ok: false, reason: "outside_hours" };

  // 5. The service must end by the session's close (real-time arithmetic).
  const end = req.start.add({ minutes: service.durationMin });
  if (cmp(end, session.close) > 0) return { ok: false, reason: "does_not_fit" };

  // 6. Sector rules, first failure wins.
  for (const rule of ctx.pack.rules) {
    const r = rule({ service, start: req.start, end, session, timeZone: ctx.shop.timeZone });
    if (!r.ok) return { ok: false, reason: `sector:${r.reason}` };
  }

  // 7-8. The first resource with no overlapping booking, in resource order.
  const range = { start: req.start, end };
  for (const resource of ctx.shop.resources) {
    const busy = ctx.existing.some(
      (b) => b.id !== req.ignoreBookingId && b.resourceId === resource.id && overlaps(b, range),
    );
    if (!busy) return { ok: true, resourceId: resource.id, start: req.start, end, session };
  }
  return { ok: false, reason: "all_resources_busy" };
}

/** Accept or reject one request, without alternatives. Pure. */
export function evaluateBooking(req: BookingRequest, ctx: RuleContext): Evaluation {
  return evaluateWith(req, ctx, (date) => sessionsOn(date, ctx.shop));
}

/** Accept or reject one request; a rejection carries up to 3 nearest valid slots. Pure. */
export function checkBooking(
  req: BookingRequest,
  ctx: RuleContext,
  opts?: SlotSearchOptions,
): Verdict {
  const evaluation = evaluateBooking(req, ctx);
  if (evaluation.ok) return evaluation;
  const alternatives =
    evaluation.reason === "unknown_service" ? [] : findNearestSlots(req, ctx, opts);
  return { ok: false, reason: evaluation.reason, alternatives };
}

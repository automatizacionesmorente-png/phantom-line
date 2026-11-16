/**
 * The Poll body (owner-machine 12.2, 12.3, 14.2). Pure: the handler reads the head (one
 * query), and only when the Machine_Version moved does it pay for the snapshot. The handler,
 * not this module, sets `Cache-Control: no-store` (12.8).
 */
import type { Temporal } from "temporal-polyfill";
import { agendaStatus, allowedActions, type AgendaBooking, type AgendaDay } from "./agenda";
import type { AgendaDayDto, AgendaItem, PollCounts, PollResponse, TapeItem } from "./api";

/** What `OwnerRepository.pollHead` returns: one row of `shops` plus two counts. */
export interface PollHead {
  version: number;
  counts: PollCounts;
  /** For the session check in the same query (1.8). */
  pinSetAt: Temporal.Instant | null;
}

/** What the full body adds, loaded only when the version moved. */
export interface Snapshot {
  now: string;
  tape: readonly TapeItem[];
  agenda: readonly AgendaDayDto[];
}

/**
 * Copy exactly the fields of a TapeItem. A row object from the repository may carry more
 * (a joined transcript, a visitor key); none of it leaves the server (14.2).
 */
export function toTapeItem(t: TapeItem): TapeItem {
  return {
    id: t.id,
    channel: t.channel,
    createdAt: t.createdAt,
    heard: t.heard,
    callerName: t.callerName,
    callerPhone: t.callerPhone,
    reason: t.reason,
    urgency: t.urgency,
    urgencyBasis: t.urgencyBasis,
    agreed: "byLang" in t.agreed ? { byLang: { es: t.agreed.byLang.es, en: t.agreed.byLang.en } } : { stored: t.agreed.stored },
    currentReply: t.currentReply,
    replyLang: t.replyLang,
    ownerLang: t.ownerLang,
    outcome: t.outcome,
    modelFailed: t.modelFailed,
    sample: t.sample,
  };
}

/** One Agenda row for the page, with the actions allowed at `now`. */
export function toAgendaItem(b: AgendaBooking, now: Temporal.Instant): AgendaItem {
  return {
    id: b.id,
    revision: b.revision,
    resourceId: b.resourceId,
    serviceId: b.serviceId,
    start: b.start.toString(),
    end: b.end.toString(),
    status: agendaStatus(b),
    cancelledBy: b.cancelledBy,
    customerName: b.customerName,
    channel: b.channel,
    actions: allowedActions(b, now),
    lastOwnerAction: b.lastOwnerAction && {
      action: b.lastOwnerAction.action,
      label: b.lastOwnerAction.label,
      at: b.lastOwnerAction.at.toString(),
    },
  };
}

export function toAgendaDays(days: readonly AgendaDay[], now: Temporal.Instant): AgendaDayDto[] {
  return days.map((d) => ({ date: d.date, items: d.items.map((b) => toAgendaItem(b, now)) }));
}

const countsOf = (c: PollCounts): PollCounts => ({ new: c.new, unheard: c.unheard });

/**
 * The small body when `since` equals the head's version (12.2), else the full one (12.3).
 * `load` is not called for the small body. Version and counts always come from the head,
 * so they match each other.
 */
export async function pollResponse(
  since: number | null,
  head: Pick<PollHead, "version" | "counts">,
  load: () => Promise<Snapshot>,
): Promise<PollResponse> {
  if (since !== null && since === head.version) {
    return { changed: false, version: head.version, counts: countsOf(head.counts) };
  }
  const snap = await load();
  return {
    changed: true,
    version: head.version,
    counts: countsOf(head.counts),
    now: snap.now,
    tape: snap.tape.map(toTapeItem),
    agenda: snap.agenda.map((d) => ({ date: d.date, items: [...d.items] })),
  };
}

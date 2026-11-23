/**
 * The customer book as the Machine_Page shows it: each Client with their summary and history,
 * and the lapsed list with its WhatsApp texts. Pure: the time, the stored clients and the shop's
 * existing bookings come in, so a test can run it at any instant (BACKLOG 14, 15).
 */
import { Temporal } from "temporal-polyfill";
import { firstSlotsFrom, localDateOf, type ExistingBooking, type RuleContext } from "@/lib/booking";
import { toShopRules, type ShopProfile } from "@/lib/conversation/shopProfile";
import type { ClientRecord } from "@/lib/owner/types";
import type { SectorPack } from "@/lib/sectors";
import { HISTORY_LIMIT, type ClientDto, type ClientsResponse, type LapsedDto } from "./api";
import { lapsedClients } from "./lapsed";
import { historyState, summarize, usualService } from "./summary";
import { WINBACK_MAX_SLOTS, whatsappUrl, winbackText } from "./winback";

/** "This week": the free slots offered in a win-back text come from the next 7 days. */
export const WINBACK_WINDOW_DAYS = 7;
/** A text starts no sooner than this after now, like the receptionist's own first offer. */
const LEAD_MIN = 30;

/** A service worth searching slots for when the client has no usual one: the first that is not an add-on. */
function defaultService(shop: ShopProfile): string | null {
  return (shop.services.find((s) => !s.addOnTo) ?? shop.services[0])?.id ?? null;
}

/** Up to 3 free slots in the next 7 days, at most one a day, earliest first. */
export function weekSlots(
  serviceId: string | null,
  now: Temporal.Instant,
  shop: ShopProfile,
  pack: SectorPack,
  existing: readonly ExistingBooking[],
): Temporal.Instant[] {
  if (serviceId === null) return [];
  const ctx: RuleContext = {
    now,
    shop: toShopRules(shop),
    pack: { slotStepMin: pack.slotStepMin, rules: pack.rules },
    existing,
  };
  const found = firstSlotsFrom({ serviceId, from: now.add({ minutes: LEAD_MIN }) }, ctx, {
    limit: 60,
    windowDays: WINBACK_WINDOW_DAYS,
  });
  const days = new Set<string>();
  const out: Temporal.Instant[] = [];
  for (const slot of found) {
    const day = localDateOf(slot.start, shop.timeZone).toString();
    if (days.has(day)) continue;
    days.add(day);
    out.push(slot.start);
    if (out.length >= WINBACK_MAX_SLOTS) break;
  }
  return out;
}

export function buildClientBook(
  records: readonly ClientRecord[],
  now: Temporal.Instant,
  shop: ShopProfile,
  pack: SectorPack,
  existing: readonly ExistingBooking[],
): ClientsResponse {
  const summaries = records.map((r) => ({ r, s: summarize(r.bookings, now) }));

  const clients: ClientDto[] = summaries.map(({ r, s }) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    language: r.language,
    note: r.note,
    birthday: r.birthday,
    promoConsentAt: r.promoConsentAt?.toString() ?? null,
    fields: r.fields,
    spentCents: r.spentCents,
    totalVisits: s.totalVisits,
    noShows: s.noShows,
    lastVisit: s.lastVisit?.toString() ?? null,
    upcoming: s.upcoming?.toString() ?? null,
    intervalDays: s.intervalDays,
    usualServices: s.usualServices.slice(0, 3),
    history: [...r.bookings]
      .sort((a, b) => Temporal.Instant.compare(b.start, a.start))
      .slice(0, HISTORY_LIMIT)
      .map((b) => {
        const state = historyState(b, now);
        return {
          bookingId: b.id,
          serviceId: b.serviceId,
          start: b.start.toString(),
          end: b.end.toString(),
          state,
          canMarkNoShow: state === "visit" || state === "no_show",
          paidCents: b.paidCents,
          visitNote: b.visitNote,
        };
      }),
  }));

  const byId = new Map(summaries.map(({ r, s }) => [r.id, { r, s }]));
  const slotsByService = new Map<string | null, Temporal.Instant[]>();
  const lapsed: LapsedDto[] = lapsedClients(
    summaries.map(({ r, s }) => ({ id: r.id, name: r.name, summary: s })),
    now,
  ).map((l) => {
    const { r, s } = byId.get(l.id)!;
    const service = usualService(s) ?? s.usualServices[0]?.serviceId ?? defaultService(shop);
    if (!slotsByService.has(service)) slotsByService.set(service, weekSlots(service, now, shop, pack, existing));
    const text = winbackText({
      name: r.name,
      shopName: shop.name,
      lang: r.language,
      timeZone: shop.timeZone,
      slots: slotsByService.get(service) ?? [],
    });
    return {
      clientId: r.id,
      name: r.name,
      language: r.language,
      daysSince: l.daysSince,
      thresholdDays: l.thresholdDays,
      overdueDays: l.overdueDays,
      text,
      whatsappUrl: whatsappUrl(r.phone, text),
    };
  });

  return { now: now.toString(), clients, lapsed };
}

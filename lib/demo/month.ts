/**
 * The demo shop's living month (salon spec 2.6): past bookings from the 1st of the previous month across both chairs,
 * their payments, expenses (one fixed monthly), blocks, settings and the outbox. Pure and
 * deterministic: the clock, the shop and the id source come in. Every row it makes is `curated`.
 *
 * Consistency rules (checked by tests/demo/month.property.test.ts):
 * - a payment belongs only to a booking that has ended, and never to a no-show or a cancelled one;
 * - a booking's state follows `bookingState` (spec 9.1): paid = done, `noShow` = no-show, the rest
 *   of the past = to collect;
 * - prices are cent snapshots of the catalogue; a payment is the price plus an optional product;
 * - no two active bookings of a chair overlap (the `bookings_no_overlap` constraint), and none
 *   overlaps a block;
 * - the outbox is what `planOutbox` would write for these rows at `now`.
 */
import { Temporal } from "temporal-polyfill";
import { localDateOf, overlaps, sessionsOn, type ShopRules } from "@/lib/booking";
import { summarize, type ClientBooking } from "@/lib/clients/summary";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { Lang } from "@/lib/sectors";
import { addMonths, monthOf, type ExpenseCategory } from "@/lib/salon/month";
import { planOutbox, type OutboxBooking, type OutboxClient } from "@/lib/salon/outbox";
import { NO_AUTOMATIONS, type OutboxKind } from "@/lib/salon/settings";
import type { CuratedBooking, CuratedCall, CuratedClient, CuratedVisit } from "./curated";

export interface CuratedMonthBooking {
  id: string;
  resourceId: string;
  serviceId: string;
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;
  customerName: string;
  /** E.164, or '' for a walk-in at the desk. */
  customerPhone: string;
  clientId: string | null;
  /** 'voice' = made by the receptionist, 'manual' = typed in by the owner. */
  channel: "voice" | "manual";
  status: "confirmed" | "cancelled";
  createdAt: Temporal.Instant;
  cancelledAt: Temporal.Instant | null;
  cancelledBy: "caller" | "owner" | null;
  ownerConfirmed: boolean;
  noShow: boolean;
  priceCents: number;
  visitNote: string;
  callId: string | null;
}

export interface CuratedPayment {
  /** Null for a product sold on its own. */
  bookingId: string | null;
  amountCents: number;
  productCents: number;
  productLabel: string;
  method: "cash" | "card" | "bizum" | "voucher";
  paidAt: Temporal.Instant;
}

export interface CuratedExpense {
  concept: string;
  category: ExpenseCategory;
  amountCents: number;
  /** YYYY-MM-DD for a one-off, null for a monthly template. */
  day: string | null;
  recurring: boolean;
  startMonth: string | null;
  endMonth: string | null;
}

export interface CuratedBlock {
  resourceId: string | null;
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;
  reason: string;
}

export interface CuratedSettings {
  automations: Record<OutboxKind, boolean>;
  googleReviewUrl: string;
  vatRatePct: number;
}

export interface CuratedOutboxRow {
  kind: OutboxKind;
  dedupeKey: string;
  clientId: string | null;
  bookingId: string | null;
  phone: string;
  language: Lang;
  body: string;
  status: "prepared" | "sent";
  createdAt: Temporal.Instant;
  actedAt: Temporal.Instant | null;
}

export interface CuratedSalon {
  /** The clients made by the month's bookings (one card each). */
  clients: CuratedClient[];
  /** Past month of bookings, plus one future cancellation that frees a gap. */
  month: CuratedMonthBooking[];
  /** Payments of the month and of the clients' older visits. */
  payments: CuratedPayment[];
  expenses: CuratedExpense[];
  blocks: CuratedBlock[];
  settings: CuratedSettings;
  outbox: CuratedOutboxRow[];
  /** Calls behind the month's receptionist bookings, and a few that ended in no booking. */
  calls: CuratedCall[];
}

/** A Google review link of the right shape that points at nothing real. */
export const SAMPLE_REVIEW_URL = "https://g.page/r/demo-peluqueria-lola/review";

/** The seeded history starts on the 1st of the previous calendar month, so both months are whole. */
const BASE_MIX = [
  "corte-mujer", "tinte-raiz", "corte-hombre", "mechas", "lavar-peinar", "balayage", "tinte-completo",
  "corte-mujer", "keratina", "matiz", "hidratante", "corte-hombre", "recogido", "tinte-raiz", "permanente",
  "decoloracion", "corte-mujer", "peinado-evento", "arreglo-barba", "corte-infantil", "degradado",
] as const;
/** Two rounds of the everyday mix and one wedding hairdo, so a bride turns up a few times a month. */
const MIX = [...BASE_MIX, ...BASE_MIX, "peinado-novia"] as const;
/** Minutes of rest between two bookings of a chair, rotated. */
const GAPS = [0, 10, 0, 15, 0, 5, 20, 0] as const;
const METHODS = ["card", "card", "cash", "bizum", "card", "cash", "bizum", "card"] as const;
const PRODUCTS: readonly { label: string; cents: number }[] = [
  { label: "Champú reparador", cents: 1490 },
  { label: "Mascarilla hidratante", cents: 1790 },
  { label: "Sérum anti-encrespamiento", cents: 1290 },
  { label: "Laca fijación fuerte", cents: 990 },
];
const FIRST = [
  "Alba", "Bruno", "Clara", "Diego", "Eva", "Fran", "Gema", "Hector", "Inés", "Jorge", "Karen", "Luis",
  "Mireia", "Nando", "Olga", "Pedro", "Quique", "Rosa", "Sonia", "Tere", "Uxía", "Víctor", "Wendy", "Xavi",
  "Yolanda", "Zoe", "Aitana", "Borja", "Celia", "Dani",
];
const LAST = [
  "Aguilar", "Bravo", "Cabrera", "Duran", "Esteban", "Fuentes", "Galán", "Hidalgo", "Iglesias", "Jiménez",
  "Lozano", "Marín", "Núñez", "Ochoa", "Pascual", "Quintero", "Rivas", "Santos", "Toledo", "Urbano",
  "Vargas", "Yáñez", "Zamora", "Arroyo", "Benítez", "Crespo", "Domínguez", "Escudero", "Ferrer", "Garrido",
];
const WALK_INS = ["Cliente de mostrador", "Paso por aquí", "Sin cita (mostrador)"];
const NOTES = [
  "Alergia al amoníaco: tintes sin amoníaco.",
  "Piel sensible; hacer siempre la prueba de alergia.",
  "Prefiere citas por la tarde.",
  "Alérgica al níquel: cuidado con las pinzas metálicas.",
  "Le gusta hablar poco durante el corte.",
];
const BIRTHDAYS = ["01-19", "02-07", "03-14", "04-30", "05-22", "06-09", "08-03", "09-27", "10-11", "12-02"];
const VISIT_NOTES: Record<string, string> = {
  "tinte-raiz": "Raíz 6.3 + oxidante 20 vol, 35 min.",
  "tinte-completo": "Color 7.1 + oxidante 20 vol, 40 min.",
  mechas: "Decoloración 30 vol, tonalizador 9.1.",
  balayage: "Balayage, matiz 9.02, 20 min.",
  matiz: "Matiz 8.1, 15 min.",
};

const E164 = (n: number) => `+3460000${String(n).padStart(4, "0")}`;
const cmp = Temporal.Instant.compare;
const mmdd = (d: Temporal.PlainDate) => `${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

interface Input {
  now: Temporal.Instant;
  shop: ShopProfile;
  rules: ShopRules;
  newId: () => string;
  /** The five curated clients, with their ids. */
  coreClients: readonly CuratedClient[];
  /** The week ahead (future, confirmed) and the core clients' history: busy time and outbox input. */
  week: readonly CuratedBooking[];
  history: readonly CuratedVisit[];
  /** Today's planned bookings that already ended at `now`: they become today's finished visits, so the morning is never empty. */
  todayPast?: readonly { chair: string; serviceId: string; start: Temporal.Instant; end: Temporal.Instant }[];
}

/** The catalogue price of a service id, `+` joining the parts of a combined visit. */
export function priceOf(shop: ShopProfile, serviceId: string): number {
  return serviceId.split("+").reduce((sum, part) => {
    const s = shop.services.find((x) => x.id === part);
    if (!s) throw new Error(`demo month needs service "${part}" in the catalogue`);
    return sum + s.priceCents;
  }, 0);
}

export function buildSalonMonth(i: Input): CuratedSalon {
  const { now, shop, rules } = i;
  const tz = shop.timeZone;
  const today = localDateOf(now, tz);
  const service = (id: string) => {
    const s = shop.services.find((x) => x.id === id);
    if (!s) throw new Error(`demo month needs service "${id}" in the catalogue`);
    return s;
  };
  const chairs = rules.resources.map((r) => r.id);

  // ---- Blocks: one in the past (a doctor's visit), one ahead (a course) after the week's bookings.
  const blocks: CuratedBlock[] = [];
  const pastDay = openDayNear(today.subtract({ days: 12 }), -1, rules);
  const pastSession = sessionsOn(pastDay, rules).at(-1)!;
  blocks.push({
    resourceId: chairs[0],
    startsAt: pastSession.open,
    endsAt: pastSession.open.add({ minutes: 120 }),
    reason: "Cita médica de Lola",
  });
  const aheadDay = openDayNear(today.add({ days: 8 }), 1, rules);
  const aheadSession = sessionsOn(aheadDay, rules)[0];
  blocks.push({
    resourceId: chairs[1] ?? chairs[0],
    startsAt: aheadSession.open,
    endsAt: aheadSession.close,
    reason: "Curso de colorimetría",
  });

  // ---- Bookings: both chairs, every open day since the 1st of the previous month, around what is already there.
  const busy = new Map<string, { start: Temporal.Instant; end: Temporal.Instant }[]>(chairs.map((c) => [c, []]));
  for (const h of i.history) busy.get(h.resourceId)?.push({ start: h.startsAt, end: h.endsAt });
  for (const b of blocks) for (const c of b.resourceId ? [b.resourceId] : chairs) busy.get(c)?.push({ start: b.startsAt, end: b.endsAt });
  for (const b of i.week) busy.get(b.resourceId)?.push({ start: b.startsAt, end: b.endsAt });

  const month: CuratedMonthBooking[] = [];
  const clients: CuratedClient[] = [];
  const draft: { start: Temporal.Instant; end: Temporal.Instant; chair: string; serviceId: string }[] = [];
  let mix = 0;
  let skip = 0;
  let gap = 0;
  const daysBack = today.since(Temporal.PlainDate.from(`${addMonths(monthOf(now, tz), -1)}-01`), { largestUnit: "days" }).days;
  for (let k = daysBack; k >= 1; k--) {
    const date = today.subtract({ days: k });
    for (const session of sessionsOn(date, rules)) {
      chairs.forEach((chair, ci) => {
        const taken = busy.get(chair)!;
        let cur = session.open.add({ minutes: ci * 15 });
        for (;;) {
          const serviceId = MIX[mix++ % MIX.length];
          const end = cur.add({ minutes: service(serviceId).durationMin });
          if (cmp(end, session.close) > 0) break;
          if (skip++ % 9 === 8) {
            cur = end;
            continue;
          }
          const hit = taken.find((t) => overlaps({ start: cur, end }, t));
          if (hit) {
            cur = hit.end;
            continue;
          }
          taken.push({ start: cur, end });
          draft.push({ start: cur, end, chair, serviceId });
          cur = end.add({ minutes: GAPS[gap++ % GAPS.length] });
        }
      });
    }
  }
  draft.sort((a, b) => cmp(a.start, b.start) || a.chair.localeCompare(b.chair));

  // Three no-shows in each calendar month that has enough bookings (spread through it).
  const noShowAt = new Set<number>();
  const perMonth = new Map<string, number[]>();
  draft.forEach((d, idx) => {
    const m = monthOf(d.start, tz);
    perMonth.set(m, [...(perMonth.get(m) ?? []), idx]);
  });
  for (const list of perMonth.values()) {
    if (list.length < 12) continue;
    for (const f of [0.18, 0.5, 0.83]) noShowAt.add(list[Math.floor(list.length * f)]);
  }
  const callSlots = new Map<string, number>();
  const calls: CuratedCall[] = [];
  /** A short answered call on the open day before `start`, at the next free six-minute slot. */
  const addCall = (start: Temporal.Instant, lang: Lang, extra: number): CuratedCall => {
    const day = openDayNear(localDateOf(start, tz).subtract({ days: 1 }), -1, rules);
    const slot = callSlots.get(day.toString()) ?? 0;
    callSlots.set(day.toString(), slot + 1);
    const first = sessionsOn(day, rules)[0].open;
    const startedAt = first.add({ minutes: 2 + (slot * 6) % 230 });
    const call = { id: i.newId(), language: lang, transcript: [], startedAt, endedAt: startedAt.add({ minutes: 2 + (extra % 3) }) };
    calls.push(call);
    return call;
  };

  let walkIn = 0;
  draft.forEach((d, idx) => {
    const manual = idx % 10 < 3;
    const anonymous = manual && idx % 10 === 2;
    const cancelled = idx % 53 === 7 && !noShowAt.has(idx);
    const lang: Lang = idx % 9 === 4 ? "en" : "es";
    let name: string;
    let phone = "";
    let clientId: string | null = null;
    if (anonymous) {
      name = WALK_INS[walkIn++ % WALK_INS.length];
    } else {
      const c = newClient(clients.length, lang, i.now, tz, today, i.newId);
      clients.push(c);
      name = c.name;
      phone = c.phone;
      clientId = c.id;
    }
    const call = manual ? null : addCall(d.start, "es", idx);
    const createdAt = manual ? d.start.subtract({ minutes: manual && idx % 2 ? 5 : 90 }) : call!.endedAt;
    month.push({
      id: i.newId(),
      resourceId: d.chair,
      serviceId: d.serviceId,
      startsAt: d.start,
      endsAt: d.end,
      customerName: name,
      customerPhone: phone,
      clientId,
      channel: manual ? "manual" : "voice",
      status: cancelled ? "cancelled" : "confirmed",
      createdAt,
      cancelledAt: cancelled ? d.start.subtract({ hours: 26 }) : null,
      cancelledBy: cancelled ? (idx % 2 ? "caller" : "owner") : null,
      ownerConfirmed: !manual,
      noShow: noShowAt.has(idx),
      priceCents: priceOf(shop, d.serviceId),
      visitNote: VISIT_NOTES[d.serviceId] ?? "",
      callId: call?.id ?? null,
    });
    // A call that ended in no booking, now and then.
    if (!manual && idx % 3 === 1) addCall(d.start, "es", idx + 1);
  });

  // ---- Today, up to now: the visits already done, so "Hoy" is alive whatever the hour of the reset.
  // Every third one is a walk-in at the counter; the rest came by phone. Payments are decided below.
  const todayIds = new Set<string>();
  let tj = 0;
  for (const p of [...(i.todayPast ?? [])].sort((a, b) => cmp(a.start, b.start) || a.chair.localeCompare(b.chair))) {
    const taken = busy.get(p.chair);
    if (!taken || taken.some((t) => overlaps({ start: p.start, end: p.end }, t))) continue;
    taken.push({ start: p.start, end: p.end });
    const manual = tj % 3 === 2;
    const anonymous = manual && tj % 6 === 5;
    let name: string;
    let phone = "";
    let clientId: string | null = null;
    if (anonymous) {
      name = WALK_INS[walkIn++ % WALK_INS.length];
    } else {
      const c = newClient(clients.length, "es", i.now, tz, today, i.newId);
      clients.push(c);
      name = c.name;
      phone = c.phone;
      clientId = c.id;
    }
    const call = manual ? null : addCall(p.start, "es", 40 + tj);
    const id = i.newId();
    todayIds.add(id);
    month.push({
      id,
      resourceId: p.chair,
      serviceId: p.serviceId,
      startsAt: p.start,
      endsAt: p.end,
      customerName: name,
      customerPhone: phone,
      clientId,
      channel: manual ? "manual" : "voice",
      status: "confirmed",
      createdAt: manual ? p.start.subtract({ minutes: 5 }) : call!.endedAt,
      cancelledAt: null,
      cancelledBy: null,
      ownerConfirmed: !manual,
      noShow: false,
      priceCents: priceOf(shop, p.serviceId),
      visitNote: VISIT_NOTES[p.serviceId] ?? "",
      callId: call?.id ?? null,
    });
    tj++;
  }

  // ---- One future cancellation that frees a slot within 72 h (the gap offer needs it).
  const freed = freeSlotSoon(now, rules, [...i.week.map((b) => ({ start: b.startsAt, end: b.endsAt, chair: b.resourceId })), ...blocks.map((b) => ({ start: b.startsAt, end: b.endsAt, chair: b.resourceId }))], service("corte-mujer").durationMin, chairs);
  if (freed) {
    const c = newClient(clients.length, "es", now, tz, today, i.newId);
    clients.push(c);
    month.push({
      id: i.newId(),
      resourceId: freed.chair,
      serviceId: "corte-mujer",
      startsAt: freed.start,
      endsAt: freed.end,
      customerName: c.name,
      customerPhone: c.phone,
      clientId: c.id,
      channel: "voice",
      status: "cancelled",
      createdAt: now.subtract({ hours: 72 }),
      cancelledAt: now.subtract({ hours: 3 }),
      cancelledBy: "caller",
      ownerConfirmed: true,
      noShow: false,
      priceCents: priceOf(shop, "corte-mujer"),
      visitNote: "",
      callId: null,
    });
  }

  // ---- Payments: the past month except the no-shows, the cancelled and some left "to collect".
  const payments: CuratedPayment[] = [];
  const pay = (bookingId: string, priceCents: number, end: Temporal.Instant, idx: number, cap?: Temporal.Instant) => {
    const product = idx % 5 === 3 ? PRODUCTS[idx % PRODUCTS.length] : null;
    payments.push({
      bookingId,
      amountCents: priceCents + (product?.cents ?? 0),
      productCents: product?.cents ?? 0,
      productLabel: product?.label ?? "",
      method: idx % 23 === 5 ? "voucher" : METHODS[idx % METHODS.length],
      paidAt: cap && cmp(end.add({ minutes: 4 + (idx % 9) }), cap) > 0 ? cap : end.add({ minutes: 4 + (idx % 9) }),
    });
  };
  let todayNo = 0;
  month.forEach((b, idx) => {
    if (b.status === "cancelled" || b.noShow || cmp(b.endsAt, now) > 0) return;
    if (todayIds.has(b.id)) {
      // Today's: all paid except every third, which is left "to collect" (the day's cash strip shows the rest).
      const at = todayNo++;
      if (at % 3 === 2) return;
      pay(b.id, b.priceCents, b.endsAt, idx, now);
      return;
    }
    // About two in ten are left "to collect": the owner has not cashed them yet.
    if (idx % 10 === 2 || idx % 10 === 6) return;
    pay(b.id, b.priceCents, b.endsAt, idx);
  });
  i.history.forEach((h, idx) => {
    if (h.noShow) return;
    pay(h.id, priceOf(shop, h.serviceId), h.endsAt, idx + 1000);
  });
  // A few products sold on their own, on past open days.
  [3, 9, 16, 23, 31, 38, 45, 52].filter((back) => back < daysBack).forEach((back, idx) => {
    const day = openDayNear(today.subtract({ days: back }), -1, rules);
    const p = PRODUCTS[idx % PRODUCTS.length];
    payments.push({
      bookingId: null,
      amountCents: p.cents,
      productCents: p.cents,
      productLabel: p.label,
      method: METHODS[(idx + 2) % METHODS.length],
      paidAt: sessionsOn(day, rules)[0].open.add({ minutes: 50 + idx * 25 }),
    });
  });

  // ---- Expenses: this month and the whole last one; the rent and the gestoría are fixed monthly templates that start well before it.
  const cur = monthOf(now, tz);
  const prev = addMonths(cur, -1);
  const dayIn = (m: string, d: number) => `${m}-${String(d).padStart(2, "0")}`;
  // The same bills fall on the same days of both months, and this month's only exist once their day has come,
  // so the month so far and the same days of last month compare like with like.
  const expenses: CuratedExpense[] = [
    { concept: "Alquiler del local", category: "rent", amountCents: 90_000, day: null, recurring: true, startMonth: addMonths(cur, -5), endMonth: null },
    { concept: "Gestoría", category: "other", amountCents: 6_050, day: null, recurring: true, startMonth: addMonths(cur, -5), endMonth: null },
    { concept: "Tintes y oxidantes (distribuidor)", category: "products", amountCents: 58_900, day: dayIn(prev, 5), recurring: false, startMonth: null, endMonth: null },
    { concept: "Luz y agua", category: "utilities", amountCents: 17_420, day: dayIn(prev, 9), recurring: false, startMonth: null, endMonth: null },
    { concept: "Champús y mascarillas para la venta", category: "products", amountCents: 19_500, day: dayIn(prev, 14), recurring: false, startMonth: null, endMonth: null },
    { concept: "Tintes y oxidantes (distribuidor)", category: "products", amountCents: 64_300, day: dayIn(cur, 5), recurring: false, startMonth: null, endMonth: null },
    { concept: "Luz y agua", category: "utilities", amountCents: 18_650, day: dayIn(cur, 9), recurring: false, startMonth: null, endMonth: null },
    { concept: "Champús y mascarillas para la venta", category: "products", amountCents: 21_800, day: dayIn(cur, 14), recurring: false, startMonth: null, endMonth: null },
  ];

  expenses.splice(0, expenses.length, ...expenses.filter((e) => e.recurring || e.day! <= today.toString()));

  const settings: CuratedSettings = {
    automations: { ...NO_AUTOMATIONS, reminder: true, review: true },
    googleReviewUrl: SAMPLE_REVIEW_URL,
    vatRatePct: 21,
  };

  const allClients = [...i.coreClients, ...clients];
  const outbox = buildOutbox({ ...i, tz, month, payments, settings, allClients });

  return { clients, month, payments, expenses, blocks, settings, outbox, calls };
}

/** The open day nearest `from`, looking in `dir` (-1 back, 1 forward). */
function openDayNear(from: Temporal.PlainDate, dir: 1 | -1, rules: ShopRules): Temporal.PlainDate {
  let d = from;
  for (let n = 0; n < 14; n++, d = d.add({ days: dir })) if (sessionsOn(d, rules).length > 0) return d;
  throw new Error("demo month needs an open day within two weeks");
}

/** A free slot within 72 h ahead: the first open session start with no booking or block on that chair. */
function freeSlotSoon(
  now: Temporal.Instant,
  rules: ShopRules,
  taken: readonly { start: Temporal.Instant; end: Temporal.Instant; chair: string | null }[],
  minutes: number,
  chairs: readonly string[],
): { start: Temporal.Instant; end: Temporal.Instant; chair: string } | null {
  const today = localDateOf(now, rules.timeZone);
  for (let k = 0; k <= 2; k++) {
    for (const s of sessionsOn(today.add({ days: k }), rules)) {
      for (let off = 0; off + minutes <= (s.close.epochMilliseconds - s.open.epochMilliseconds) / 60_000; off += 30) {
        const start = s.open.add({ minutes: off });
        const end = start.add({ minutes });
        if (cmp(start, now.add({ hours: 5 })) < 0 || cmp(end, now.add({ hours: 70 })) > 0) continue;
        for (const chair of chairs) {
          if (!taken.some((t) => (t.chair === null || t.chair === chair) && overlaps({ start, end }, t))) return { start, end, chair };
        }
      }
    }
  }
  return null;
}

function newClient(index: number, lang: Lang, now: Temporal.Instant, tz: string, today: Temporal.PlainDate, newId: () => string): CuratedClient {
  const first = FIRST[index % FIRST.length];
  const last = LAST[(index * 7 + Math.floor(index / FIRST.length) * 11) % LAST.length];
  return {
    id: newId(),
    name: `${first} ${last}`,
    phone: E164(300 + index),
    language: lang,
    note: index % 8 === 1 ? NOTES[(index >> 3) % NOTES.length] : "",
    // The first of them has her birthday today; one in five is known; consent is a little under half.
    birthday: index === 0 ? mmdd(today) : index % 5 === 2 ? BIRTHDAYS[(index >> 1) % BIRTHDAYS.length] : null,
    promoConsent: index === 0 || index % 9 < 4,
  };
}

function buildOutbox(a: Input & {
  tz: string;
  month: readonly CuratedMonthBooking[];
  payments: readonly CuratedPayment[];
  settings: CuratedSettings;
  allClients: readonly CuratedClient[];
}): CuratedOutboxRow[] {
  const { now, tz } = a;
  const paidAt = new Map<string, Temporal.Instant>();
  for (const p of a.payments) {
    if (!p.bookingId) continue;
    const prev = paidAt.get(p.bookingId);
    if (!prev || cmp(p.paidAt, prev) > 0) paidAt.set(p.bookingId, p.paidAt);
  }
  const clientOf = new Map(a.allClients.map((c) => [c.phone, c]));
  const langOf = (phone: string): Lang => clientOf.get(phone)?.language ?? "es";
  const rows: { id: string; clientId: string | null; name: string; phone: string; start: Temporal.Instant; end: Temporal.Instant; status: "confirmed" | "cancelled"; cancelledAt: Temporal.Instant | null; noShow: boolean; serviceId: string; priceCents: number | null }[] = [
    ...a.week.map((b) => ({ id: b.id, clientId: null, name: b.customerName, phone: b.customerPhone, start: b.startsAt, end: b.endsAt, status: "confirmed" as const, cancelledAt: null, noShow: false, serviceId: b.serviceId, priceCents: null })),
    ...a.history.map((b) => ({ id: b.id, clientId: clientOf.get(b.customerPhone)?.id ?? null, name: b.customerName, phone: b.customerPhone, start: b.startsAt, end: b.endsAt, status: "confirmed" as const, cancelledAt: null, noShow: b.noShow, serviceId: b.serviceId, priceCents: null })),
    ...a.month.map((b) => ({ id: b.id, clientId: b.clientId, name: b.customerName, phone: b.customerPhone, start: b.startsAt, end: b.endsAt, status: b.status, cancelledAt: b.cancelledAt, noShow: b.noShow, serviceId: b.serviceId, priceCents: b.priceCents })),
  ];
  const outboxBookings: OutboxBooking[] = rows.map((b) => ({
    id: b.id,
    clientId: b.clientId,
    name: b.name,
    phone: b.phone,
    language: langOf(b.phone),
    start: b.start,
    status: b.status,
    cancelledAt: b.cancelledAt,
    paidAt: paidAt.get(b.id) ?? null,
  }));
  const bookingsOf = new Map<string, ClientBooking[]>();
  for (const b of rows) {
    if (!b.clientId) continue;
    const list = bookingsOf.get(b.clientId) ?? [];
    list.push({ id: b.id, serviceId: b.serviceId, start: b.start, end: b.end, status: b.status, noShow: b.noShow, paidCents: paidAt.has(b.id) ? (b.priceCents ?? 0) : null, visitNote: "" });
    bookingsOf.set(b.clientId, list);
  }
  const outboxClients: OutboxClient[] = a.allClients.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    language: c.language,
    birthday: c.birthday,
    promoConsentAt: c.promoConsent ? now : null,
    summary: summarize(bookingsOf.get(c.id) ?? [], now),
  }));
  const drafts = planOutbox({
    now,
    tz,
    shop: { name: a.shop.name },
    settings: { automations: a.settings.automations, googleReviewUrl: a.settings.googleReviewUrl },
    bookings: outboxBookings.filter((b) => b.status === "confirmed"),
    cancellations: outboxBookings.filter((b) => b.status === "cancelled"),
    clients: outboxClients,
    existingKeys: new Set(),
  });
  // The first two reminders have already gone out by hand.
  let sent = 0;
  return drafts.map((d) => {
    const done = d.kind === "reminder" && sent++ < 2;
    return { ...d, status: done ? "sent" : "prepared", createdAt: now, actedAt: done ? now : null };
  });
}

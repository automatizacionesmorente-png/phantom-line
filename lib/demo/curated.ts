/**
 * The curated demo set of Peluquería Lola (BACKLOG 1): 4 believable Messages and a week of
 * Bookings across both chairs. Pure: the time, the profile and the id source come in, so a
 * test can run it at any instant. Every row carries `curated: true`, which Demo_Retention
 * never erases or deletes. Bookings are checked against the real Booking_Rules (hours,
 * durations, one booking per chair at a time), never hand-placed.
 */
import { Temporal } from "temporal-polyfill";
import { evaluateBooking, localDateOf, sessionsOn, type RuleContext } from "@/lib/booking";
import { toShopRules, type ShopProfile } from "@/lib/conversation/shopProfile";
import type { Line, Outcome, Urgency } from "@/lib/conversation/types";
import { callerLinesOf, decideUrgency, type FinalUrgency, type UrgencyBasis } from "@/lib/messages/urgency";
import { phrases } from "@/lib/receptionist/phrases";
import { getSectorPack, type Lang } from "@/lib/sectors";

export interface CuratedBooking {
  id: string;
  resourceId: string;
  serviceId: string;
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;
  customerName: string;
  customerPhone: string;
  callId: string | null;
  ownerConfirmed: boolean;
}

export interface CuratedMessage {
  callId: string;
  callerName: string;
  callerPhone: string;
  reason: string;
  urgency: FinalUrgency;
  urgencySuggested: Urgency | null;
  urgencyBasis: UrgencyBasis;
  agreed: string;
  suggestedReply: string;
  outcome: Outcome;
  bookingId: string | null;
  createdAt: Temporal.Instant;
}

export interface CuratedCall {
  id: string;
  language: Lang;
  transcript: Line[];
  startedAt: Temporal.Instant;
  endedAt: Temporal.Instant;
}

/** A finished booking of a curated client (clients tab history); `noShow` is the Owner's "No vino". */
export interface CuratedVisit extends CuratedBooking {
  noShow: boolean;
}

/** A client of the demo customer book, with a private note and a believable visit history. */
export interface CuratedClient {
  name: string;
  phone: string;
  language: Lang;
  note: string;
}

export interface CuratedSet {
  calls: CuratedCall[];
  messages: CuratedMessage[];
  bookings: CuratedBooking[];
  /** Five clients for the "Clientes" tab (BACKLOG 14), two of them overdue (BACKLOG 15). */
  clients: CuratedClient[];
  /** Their past bookings. Kept apart from `bookings`, which is the Agenda's week. */
  history: CuratedVisit[];
}

export interface CuratedContext {
  now: Temporal.Instant;
  shop: ShopProfile;
  newId: () => string;
}

/** Names the reset removes as leftovers of manual testing, besides the rest of the shop's rows. */
export const TEST_BOOKING_NAMES = ["Ana Prueba", "John Test"] as const;

/** Spanish-looking numbers in a block nobody owns; the machine shows them as written. */
const phone = (n: number) => `+3460000${String(n).padStart(4, "0")}`;

const CUSTOMERS = [
  "Carmen Ruiz",
  "Javier Molina",
  "Lucía Herrera",
  "Pablo Navarro",
  "Elena Castro",
  "Andrés Gil",
  "Marina Ortega",
  "Daniel Vidal",
  "Rocío Serrano",
  "Hugo Prieto",
  "Irene Campos",
  "Álvaro Delgado",
  "Beatriz Lara",
  "Sergio Mora",
  "Nuria Ibáñez",
  "Tomás Rey",
  "Cristina Soler",
  "Iván Cano",
  "Paula Giménez",
  "Raúl Peña",
];

/** One planned booking: minutes after the session's opening, which session, chair, service. */
interface Plan {
  session: 0 | 1;
  offset: number;
  chair: "chair-1" | "chair-2";
  service: string;
}

/** Three day shapes, rotated over the open days. Gaps are on purpose: a salon is never wall to wall. */
const SHAPES: readonly (readonly Plan[])[] = [
  [
    { session: 0, offset: 0, chair: "chair-1", service: "corte-mujer" },
    { session: 0, offset: 60, chair: "chair-1", service: "tinte-raiz" },
    { session: 0, offset: 15, chair: "chair-2", service: "corte-hombre" },
    { session: 0, offset: 60, chair: "chair-2", service: "arreglo-barba" },
    { session: 0, offset: 105, chair: "chair-2", service: "lavar-peinar" },
    { session: 1, offset: 0, chair: "chair-1", service: "peinado-evento" },
    { session: 1, offset: 90, chair: "chair-1", service: "corte-mujer" },
    { session: 1, offset: 30, chair: "chair-2", service: "degradado" },
  ],
  [
    { session: 0, offset: 0, chair: "chair-1", service: "mechas" },
    { session: 0, offset: 30, chair: "chair-2", service: "corte-infantil" },
    { session: 0, offset: 75, chair: "chair-2", service: "corte-hombre" },
    { session: 0, offset: 120, chair: "chair-2", service: "barba" },
    { session: 1, offset: 0, chair: "chair-1", service: "tinte-completo" },
    { session: 1, offset: 15, chair: "chair-2", service: "lavar-peinar" },
    { session: 1, offset: 60, chair: "chair-2", service: "hidratante" },
  ],
  [
    { session: 0, offset: 0, chair: "chair-1", service: "corte-mujer" },
    { session: 0, offset: 60, chair: "chair-1", service: "recogido" },
    { session: 0, offset: 0, chair: "chair-2", service: "balayage" },
    { session: 1, offset: 0, chair: "chair-1", service: "corte-hombre" },
    { session: 1, offset: 45, chair: "chair-1", service: "degradado" },
    { session: 1, offset: 90, chair: "chair-1", service: "matiz" },
    { session: 1, offset: 0, chair: "chair-2", service: "tinte-raiz" },
    { session: 1, offset: 90, chair: "chair-2", service: "corte-mujer" },
  ],
];

/** Days, counting today, that the week covers. */
const WEEK_DAYS = 7;

/**
 * Checks one booking against the real Booking_Rules with only `chair` as a resource and
 * only that chair's bookings as busy time. Rejections that just mean "not today / taken"
 * return null; anything else is a bug in the plan, and throws.
 */
function place(
  plan: { serviceId: string; start: Temporal.Instant; chair: string },
  ctx: RuleContext,
  taken: readonly CuratedBooking[],
) {
  const own: RuleContext = {
    ...ctx,
    shop: { ...ctx.shop, resources: [{ id: plan.chair }] },
    existing: taken
      .filter((b) => b.resourceId === plan.chair)
      .map((b) => ({ id: b.id, resourceId: b.resourceId, start: b.startsAt, end: b.endsAt })),
  };
  const v = evaluateBooking({ serviceId: plan.serviceId, start: plan.start }, own);
  if (v.ok) return v;
  if (v.reason === "in_the_past" || v.reason === "all_resources_busy") return null;
  throw new Error(`demo plan rejected: ${plan.serviceId} at ${plan.start.toString()}: ${v.reason}`);
}

export function buildCuratedSet(ctx: CuratedContext): CuratedSet {
  const { now, shop } = ctx;
  const tz = shop.timeZone;
  const pack = getSectorPack(shop.sectorPackId);
  const rules: RuleContext = {
    now,
    shop: toShopRules(shop),
    pack: { slotStepMin: pack.slotStepMin, rules: pack.rules },
    existing: [],
  };
  const today = localDateOf(now, tz);
  const service = (id: string) => {
    const s = shop.services.find((x) => x.id === id);
    if (!s) throw new Error(`demo set needs service "${id}" in the catalogue`);
    return s;
  };

  const calls: CuratedCall[] = [];
  const messages: CuratedMessage[] = [];
  const bookings: CuratedBooking[] = [];
  let customer = 0;
  let phoneNo = 10;
  const nextCustomer = () => ({ name: CUSTOMERS[customer++ % CUSTOMERS.length], phone: phone(phoneNo++) });

  const es = phrases("es", pack, shop, undefined, now);
  const en = phrases("en", pack, shop, undefined, now);
  const minutesAgo = (m: number) => now.subtract({ minutes: m });

  /** The first day after today with opening hours; its first afternoon session holds the booked Message. */
  let confirmedStart: Temporal.Instant | null = null;
  for (let k = 1; k <= 14 && !confirmedStart; k++) {
    const sessions = sessionsOn(today.add({ days: k }), rules.shop);
    if (sessions.length > 0) confirmedStart = sessions[sessions.length - 1].open;
  }
  if (!confirmedStart) throw new Error("demo set needs at least one open day in the next two weeks");

  const addMessage = (
    lang: Lang,
    ago: number,
    m: { name: string; phone: string; transcript: Line[]; reason: string; agreed: string; reply: string; outcome: Outcome; suggested: Urgency },
    booking: CuratedBooking | null,
  ) => {
    const createdAt = minutesAgo(ago);
    const decision = decideUrgency({
      callerLines: callerLinesOf(m.transcript),
      vocabulary: pack.vocabulary,
      timeZone: tz,
      now,
      requestedDate: booking ? localDateOf(booking.startsAt, tz) : null,
      bookingStart: booking?.startsAt ?? null,
      outcome: m.outcome,
      modelFailed: false,
      suggested: m.suggested,
    });
    const callId = booking?.callId ?? ctx.newId();
    calls.push({ id: callId, language: lang, transcript: m.transcript, startedAt: createdAt.subtract({ minutes: 3 }), endedAt: createdAt });
    messages.push({
      callId,
      callerName: m.name,
      callerPhone: m.phone,
      reason: m.reason,
      urgency: decision.final,
      urgencySuggested: decision.suggested,
      urgencyBasis: decision.basis,
      agreed: m.agreed,
      suggestedReply: m.reply,
      outcome: m.outcome,
      bookingId: booking?.id ?? null,
      createdAt,
    });
  };
  const greeting = (p: typeof es): Line => ({ caller: "", receptionist: p.greeting().text });

  // 1. Booking confirmed (es), the one the week is built around.
  {
    const c = { name: "Sofía Marín", phone: phone(1) };
    const svc = service("corte-mujer");
    const v = place({ serviceId: svc.id, start: confirmedStart, chair: "chair-1" }, rules, []);
    if (!v) throw new Error("demo set: the confirmed booking does not fit");
    const callId = ctx.newId();
    const booking: CuratedBooking = {
      id: ctx.newId(),
      resourceId: v.resourceId,
      serviceId: svc.id,
      startsAt: v.start,
      endsAt: v.end,
      customerName: c.name,
      customerPhone: c.phone,
      callId,
      ownerConfirmed: true,
    };
    bookings.push(booking);
    const spoken = svc.spokenName?.es ?? svc.name.es;
    addMessage(
      "es",
      130,
      {
        name: c.name,
        phone: c.phone,
        transcript: [
          greeting(es),
          { caller: `Hola, quería ${spoken}.`, receptionist: es.askDayAndTime(null).text },
          { caller: "El primer día que abráis, por la tarde.", receptionist: es.timeAcceptedAskName(v.start).text },
          { caller: `${c.name}.`, receptionist: es.askPhone().text },
          { caller: "Seis cero cero, cero cero, cero cero, cero uno.", receptionist: es.readBack(svc.id, v.start, c.name, c.phone).text },
          { caller: "Sí, perfecto.", receptionist: es.booked(svc.id, v.start).text },
        ],
        reason: `Quiere ${spoken}`,
        agreed: es.owner.agreedBooked(svc.id, v.start, v.resourceId),
        reply: es.owner.replyBooked(c.name, svc.id, v.start),
        outcome: "booked",
        suggested: "normal",
      },
      booking,
    );
  }

  // 2. Urgent (es).
  {
    const c = { name: "Pilar Gómez", phone: phone(2) };
    const reason = "Reacción al tinte de ayer, le pica el cuero cabelludo";
    addMessage(
      "es",
      12,
      {
        name: c.name,
        phone: c.phone,
        transcript: [
          greeting(es),
          { caller: "Me teñí ayer y hoy tengo una reacción, me pica mucho el cuero cabelludo.", receptionist: `${es.dontKnow().text} ${es.askName().text}` },
          { caller: `${c.name}.`, receptionist: es.askPhone().text },
          { caller: "Seis cero cero, cero cero, cero cero, cero dos.", receptionist: es.goodbye().text },
        ],
        reason,
        agreed: es.owner.agreedNothing(reason),
        reply: es.owner.replyCallBack(c.name),
        outcome: "message",
        suggested: "urgent",
      },
      null,
    );
  }

  // 3. English call, a price question for Lola. The reason is for the owner (Spanish); the reply goes to the caller (English).
  {
    const c = { name: "James Carter", phone: phone(3) };
    const reason = "Pregunta cuánto cuesta el balayage y pide que Lola le llame (llamada en inglés)";
    addMessage(
      "en",
      47,
      {
        name: c.name,
        phone: c.phone,
        transcript: [
          greeting(en),
          { caller: "Hi, I'm visiting Madrid. How much is balayage, and could Lola call me back?", receptionist: `${en.dontKnow().text} ${en.askName().text}` },
          { caller: `${c.name}.`, receptionist: en.askPhone().text },
          { caller: "Six zero zero, zero zero, zero zero, zero three.", receptionist: en.goodbye().text },
        ],
        reason,
        agreed: es.owner.agreedNothing(reason),
        reply: en.owner.replyCallBack(c.name),
        outcome: "message",
        suggested: "normal",
      },
      null,
    );
  }

  // 4. A question the receptionist answered from the shop's own FAQ.
  {
    const faq = (shop.faq ?? []).find((f) => f.id === "pago");
    if (!faq) throw new Error('demo set needs the "pago" FAQ entry');
    const c = { name: "Luis Romero", phone: phone(4) };
    const reason = "Pregunta cómo se puede pagar";
    addMessage(
      "es",
      200,
      {
        name: c.name,
        phone: c.phone,
        transcript: [
          greeting(es),
          { caller: "¿Se puede pagar con tarjeta?", receptionist: faq.answer.es },
          { caller: "Vale, gracias.", receptionist: es.goodbye().text },
        ],
        reason,
        agreed: es.owner.agreedNothing(reason),
        reply: es.owner.replyCallBack(c.name),
        outcome: "answered",
        suggested: "low",
      },
      null,
    );
  }

  // The week: from today to six days ahead, open days only, rotating the three shapes.
  let shapeNo = 0;
  for (let k = 0; k < WEEK_DAYS; k++) {
    const date = today.add({ days: k });
    const sessions = sessionsOn(date, rules.shop);
    if (sessions.length === 0) continue;
    const shape = SHAPES[shapeNo++ % SHAPES.length];
    for (const plan of shape) {
      const session = sessions[Math.min(plan.session, sessions.length - 1)];
      const svc = service(plan.service);
      const v = place({ serviceId: svc.id, start: session.open.add({ minutes: plan.offset }), chair: plan.chair }, rules, bookings);
      if (!v) continue;
      const c = nextCustomer();
      bookings.push({
        id: ctx.newId(),
        resourceId: v.resourceId,
        serviceId: svc.id,
        startsAt: v.start,
        endsAt: v.end,
        customerName: c.name,
        customerPhone: c.phone,
        callId: null,
        ownerConfirmed: bookings.length % 3 !== 0,
      });
    }
  }
  bookings.sort((a, b) => Temporal.Instant.compare(a.startsAt, b.startsAt));
  const { clients, history } = buildClients(ctx, rules);
  return { calls, messages, bookings, clients, history };
}

/** One curated client: who, and when their visits were, in days before now (oldest first). */
interface ClientPlan extends CuratedClient {
  service: string;
  visitsDaysAgo: number[];
  /** Days ago of visits the Owner marked "No vino". */
  noShowsDaysAgo?: number[];
}

/**
 * Carlos is regular and not due; Marta (every ~5 weeks, last 58 days ago) and John (every 4 weeks,
 * last 49 days ago) are overdue against their own interval; Elena has one old visit (60-day rule);
 * Lucía has a no-show and is not due. All numbers are Spanish-looking ones nobody owns.
 */
const CLIENT_PLANS: readonly ClientPlan[] = [
  {
    name: "Carlos Vega",
    phone: phone(101),
    language: "es",
    note: "Prefiere el sillón 2. Le gusta que le avisen si hay hueco antes.",
    service: "corte-hombre+degradado",
    visitsDaysAgo: [81, 60, 39, 18],
  },
  {
    name: "Marta Ibáñez",
    phone: phone(102),
    language: "es",
    note: "Alérgica a algunos tintes: usar siempre la prueba de alergia.",
    service: "tinte-raiz",
    visitsDaysAgo: [128, 93, 58],
  },
  {
    name: "John Carter",
    phone: phone(103),
    language: "en",
    note: "Visiting from the UK every few weeks. Prefers to chat in English.",
    service: "corte-hombre",
    visitsDaysAgo: [105, 77, 49],
  },
  {
    name: "Elena Soto",
    phone: phone(104),
    language: "es",
    note: "",
    service: "tinte-completo",
    visitsDaysAgo: [74],
  },
  {
    name: "Lucía Pardo",
    phone: phone(105),
    language: "es",
    note: "Faltó a una cita sin avisar; confirmar siempre el día antes.",
    service: "corte-mujer",
    visitsDaysAgo: [40, 19, 6],
    noShowsDaysAgo: [27],
  },
];

function buildClients(ctx: CuratedContext, rules: RuleContext): { clients: CuratedClient[]; history: CuratedVisit[] } {
  const { now, shop } = ctx;
  const tz = shop.timeZone;
  const today = localDateOf(now, tz);
  const history: CuratedVisit[] = [];
  const taken = new Map<string, Temporal.Instant[]>();
  const duration = (id: string) =>
    id.split("+").reduce((sum, part) => sum + (shop.services.find((x) => x.id === part)?.durationMin ?? 30), 0);

  CLIENT_PLANS.forEach((plan, index) => {
    const chair = index % 2 === 0 ? "chair-1" : "chair-2";
    const minutes = duration(plan.service);
    const place = (daysAgo: number, noShow: boolean) => {
      // The nearest open day on or before the target, so the history looks like a real week.
      for (let back = 0; back < 7; back++) {
        const date = today.subtract({ days: daysAgo + back });
        const sessions = sessionsOn(date, rules.shop);
        if (sessions.length === 0) continue;
        const open = sessions[0].open;
        const key = `${chair}:${date.toString()}`;
        const busy = taken.get(key) ?? [];
        // Clients of the same chair on the same day take turns, never overlap.
        let start = open.add({ minutes: busy.length * 90 });
        if (Temporal.Instant.compare(start.add({ minutes }), sessions[0].close) > 0) start = open;
        taken.set(key, [...busy, start]);
        history.push({
          id: ctx.newId(),
          resourceId: chair,
          serviceId: plan.service,
          startsAt: start,
          endsAt: start.add({ minutes }),
          customerName: plan.name,
          customerPhone: plan.phone,
          callId: null,
          ownerConfirmed: true,
          noShow,
        });
        return;
      }
    };
    plan.visitsDaysAgo.forEach((d) => place(d, false));
    (plan.noShowsDaysAgo ?? []).forEach((d) => place(d, true));
  });
  history.sort((a, b) => Temporal.Instant.compare(a.startsAt, b.startsAt));
  return { clients: CLIENT_PLANS.map(({ name, phone: p, language, note }) => ({ name, phone: p, language, note })), history };
}

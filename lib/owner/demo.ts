/**
 * The public demo's own rules (owner-machine Requirement 3.3, 7.12, 16). Only the
 * Demo_Shop, recognised by its id, forgets old calls and is refilled with three fixed
 * Sample_Messages; a Real_Shop keeps everything. Pure: `demoRetention.ts` (task 8) does
 * the I/O through ports and calls these.
 */
import { Temporal } from "temporal-polyfill";
import { daySlots, evaluateBooking, localDateOf, sessionsOn, type RuleContext } from "@/lib/booking";
import { toShopRules, type ShopProfile } from "@/lib/conversation/shopProfile";
import type { Line, Outcome, OwnerMessage, Urgency } from "@/lib/conversation/types";
import { callerLinesOf, decideUrgency, type FinalUrgency, type UrgencyBasis } from "@/lib/messages/urgency";
import { phrases } from "@/lib/receptionist/phrases";
import type { Lang, SectorPack } from "@/lib/sectors";
import { SAMPLE_KEYS, type SampleKey } from "./api";
import { formatClock } from "./format";

export { SAMPLE_KEYS, type SampleKey } from "./api";

/** Peluquería Lola, the shop the seed creates. The seed imports this id (task 8). */
export const DEMO_SHOP_ID = "peluqueria-lola";

export function isDemoShop(shopId: string): boolean {
  return shopId === DEMO_SHOP_ID;
}

/** A demo Message leaves the Tape this many hours after it was created (16.2). */
export const DEMO_ERASE_AFTER_HOURS = 24;
/** Demo Calls, their Messages, and Bookings that ended, are deleted after this many days (16.3). */
export const DEMO_DELETE_AFTER_DAYS = 7;
/** Fewer New_Messages than this and the samples come back (16.4). */
export const DEMO_MIN_TAPE = 3;
/** Demo_Retention runs at most once in this many minutes (16.6). */
export const DEMO_RETENTION_EVERY_MIN = 10;

export interface DemoCutoffs {
  now: Temporal.Instant;
  /** New_Messages created before this are erased. */
  eraseBefore: Temporal.Instant;
  /** Calls started, and Bookings ended, before this are deleted. */
  deleteBefore: Temporal.Instant;
}

/**
 * `now − 24 h` and `now − 7 × 24 h`, in exact hours. An Instant has no calendar, so a
 * DST change in between does not stretch or shrink a "day" here.
 */
export function demoCutoffs(now: Temporal.Instant): DemoCutoffs {
  return {
    now,
    eraseBefore: now.subtract({ hours: DEMO_ERASE_AFTER_HOURS }),
    deleteBefore: now.subtract({ hours: DEMO_DELETE_AFTER_DAYS * 24 }),
  };
}

/** Every key not on the Tape when the Tape holds fewer than 3 New_Messages; otherwise none (16.4). */
export function samplesToRestore(s: { newCount: number; activeSampleKeys: readonly SampleKey[] }): SampleKey[] {
  if (s.newCount >= DEMO_MIN_TAPE) return [];
  return SAMPLE_KEYS.filter((k) => !s.activeSampleKeys.includes(k));
}

const NOTICE: Record<Lang, string> = {
  es: "Demo: no dejes datos personales reales",
  en: "Demo: do not leave real personal data",
};

/** The Demo_Notice in the page's selected language (3.2, 3.3). */
export function demoNotice(lang: Lang): string {
  return NOTICE[lang];
}

// ---------------------------------------------------------------------------
// Sample_Messages (16.5)

export interface DemoSample {
  key: SampleKey;
  call: { id: string; channel: "voice"; language: Lang; transcript: Line[]; startedAt: Temporal.Instant };
  /** The urgency comes from `decideUrgency`, like any other Message's (16.5). */
  message: OwnerMessage & {
    urgency: FinalUrgency;
    urgencyBasis: UrgencyBasis;
    urgencySuggested: Urgency | null;
    sampleKey: SampleKey;
  };
  /**
   * The booking sample only: the slot its Agreed_Text names. Never written as a Booking
   * row (16.5); it is here so the slot can be checked against the Booking_Rules.
   */
  agreedSlot?: { serviceId: string; start: Temporal.Instant; resourceId: string };
}

export interface DemoSampleContext {
  now: Temporal.Instant;
  shop: ShopProfile;
  pack: SectorPack;
  newId: () => string;
}

/** "+34 000 000 001" to "003" in E.164, like every stored phone. Spanish numbers never start with 0. */
const PHONES: Record<SampleKey, string> = {
  urgent: "+34000000001",
  booking: "+34000000002",
  question: "+34000000003",
};

const TEXT = {
  es: {
    example: "ejemplo",
    names: { urgent: "Marta", booking: "Ana", question: "Luis" },
    phoneWords: {
      urgent: "Mi teléfono es el cero cero cero, cero cero cero, cero cero uno.",
      booking: "El cero cero cero, cero cero cero, cero cero dos.",
      question: "",
    },
    urgentLine: "Me teñí ayer y hoy tengo una reacción, me pica mucho el cuero cabelludo.",
    urgentReason: "Reacción al tinte de ayer, le pica el cuero cabelludo",
    wants: (service: string) => `Hola, quería ${service}.`,
    when: "El próximo día que abráis, a media mañana.",
    yes: "Sí, perfecto.",
    bookingReason: (service: string) => `Quiere ${service}`,
    question: "¿Abrís el sábado por la tarde?",
    questionReason: "Pregunta si abrís el sábado por la tarde",
    saturdayOpen: (from: string, to: string) => `Sí, el sábado por la tarde abrimos de ${from} a ${to}.`,
    saturdayClosed: "No, el sábado por la tarde está cerrado.",
    thanks: "Vale, gracias.",
  },
  en: {
    example: "example",
    names: { urgent: "Marta", booking: "Ana", question: "Luis" },
    phoneWords: {
      urgent: "My number is zero zero zero, zero zero zero, zero zero one.",
      booking: "Zero zero zero, zero zero zero, zero zero two.",
      question: "",
    },
    urgentLine: "I dyed my hair yesterday and today I have a reaction, my scalp is itching a lot.",
    urgentReason: "Reaction to yesterday's colour, itchy scalp",
    wants: (service: string) => `Hi, I'd like ${service}.`,
    when: "The next day you're open, mid-morning.",
    yes: "Yes, perfect.",
    bookingReason: (service: string) => `Wants ${service}`,
    question: "Are you open on Saturday afternoon?",
    questionReason: "Asks if you open on Saturday afternoon",
    saturdayOpen: (from: string, to: string) => `Yes, on Saturday afternoon we're open from ${from} to ${to}.`,
    saturdayClosed: "No, we're closed on Saturday afternoon.",
    thanks: "OK, thanks.",
  },
} as const;

/** How far ahead the booking sample looks for an open day. */
const SAMPLE_SEARCH_DAYS = 14;

/**
 * The booking sample's start: the first open day after today, at its first session's
 * start + 1 hour, if the Booking_Rules accept it against an empty agenda; otherwise that
 * day's first accepted grid slot; otherwise the next open day. Null when no day in two
 * weeks has room, which no seeded shop hits.
 */
function bookingSampleStart(serviceId: string, ctx: RuleContext, today: Temporal.PlainDate) {
  for (let k = 1; k <= SAMPLE_SEARCH_DAYS; k++) {
    const date = today.add({ days: k });
    const sessions = sessionsOn(date, ctx.shop);
    if (sessions.length === 0) continue;
    const preferred = evaluateBooking({ serviceId, start: sessions[0].open.add({ hours: 1 }) }, ctx);
    if (preferred.ok) return preferred;
    const first = daySlots({ serviceId }, date, ctx)[0];
    if (first) {
      const e = evaluateBooking({ serviceId, start: first.start }, ctx);
      if (e.ok) return e;
    }
  }
  return null;
}

/**
 * The fixed Sample_Messages for `keys`, in the Shop's first language, each with its own
 * short Call and Transcript. Names are marked "(ejemplo)" / "(example)" and phones cannot
 * be dialled. No sample creates a Booking: the booking sample only says what was agreed,
 * so it never takes a chair and never appears in the Agenda (16.5). Every Message is
 * created at `now` (16.4). The booking sample is left out only if the shop has no room
 * in the next two weeks.
 */
export function demoSamples(keys: readonly SampleKey[], ctx: DemoSampleContext): DemoSample[] {
  const { now, shop, pack } = ctx;
  const lang = shop.languages[0];
  const t = TEXT[lang];
  const p = phrases(lang, pack, shop, undefined, now);
  const o = p.owner;
  const tz = shop.timeZone;
  const today = localDateOf(now, tz);
  const ruleCtx: RuleContext = {
    now,
    shop: toShopRules(shop),
    pack: { slotStepMin: pack.slotStepMin, rules: pack.rules },
    existing: [],
  };

  const out: DemoSample[] = [];
  const make = (
    key: SampleKey,
    transcript: Line[],
    m: { reason: string; agreed: string; suggestedReply: string; outcome: Outcome; suggested: Urgency },
    booking?: { serviceId: string; start: Temporal.Instant; resourceId: string },
  ) => {
    const decision = decideUrgency({
      callerLines: callerLinesOf(transcript),
      vocabulary: pack.vocabulary,
      timeZone: tz,
      now,
      requestedDate: booking ? localDateOf(booking.start, tz) : null,
      bookingStart: booking?.start ?? null,
      outcome: m.outcome,
      modelFailed: false,
      suggested: m.suggested,
    });
    out.push({
      key,
      call: { id: ctx.newId(), channel: "voice", language: lang, transcript, startedAt: now },
      message: {
        callerName: `${t.names[key]} (${t.example})`,
        callerPhone: PHONES[key],
        reason: m.reason,
        urgency: decision.final,
        urgencyBasis: decision.basis,
        urgencySuggested: decision.suggested,
        agreed: m.agreed,
        suggestedReply: m.suggestedReply,
        outcome: m.outcome,
        modelFailed: false,
        sampleKey: key,
      },
      ...(booking ? { agreedSlot: booking } : {}),
    });
  };

  for (const key of SAMPLE_KEYS.filter((k) => keys.includes(k))) {
    const name = t.names[key];
    const greeting: Line = { caller: "", receptionist: p.greeting().text };

    if (key === "urgent") {
      make(
        key,
        [
          greeting,
          { caller: t.urgentLine, receptionist: `${p.dontKnow().text} ${p.askName().text}` },
          { caller: `${name}.`, receptionist: p.askPhone().text },
          { caller: t.phoneWords.urgent, receptionist: p.goodbye().text },
        ],
        {
          reason: t.urgentReason,
          agreed: o.agreedNothing(t.urgentReason),
          suggestedReply: o.replyCallBack(name),
          outcome: "message",
          suggested: "urgent",
        },
      );
    } else if (key === "booking") {
      const service = shop.services[0];
      const v = service ? bookingSampleStart(service.id, ruleCtx, today) : null;
      if (!service || !v) continue;
      const spoken = service.spokenName?.[lang] ?? service.name[lang];
      make(
        key,
        [
          greeting,
          { caller: t.wants(spoken), receptionist: p.askDayAndTime(null).text },
          { caller: t.when, receptionist: p.timeAcceptedAskName(v.start).text },
          { caller: `${name}.`, receptionist: p.askPhone().text },
          { caller: t.phoneWords.booking, receptionist: p.readBack(service.id, v.start, name, PHONES[key]).text },
          { caller: t.yes, receptionist: p.booked(service.id, v.start).text },
        ],
        {
          reason: t.bookingReason(spoken),
          agreed: o.agreedBooked(service.id, v.start, v.resourceId),
          suggestedReply: o.replyBooked(name, service.id, v.start),
          outcome: "booked",
          suggested: "normal",
        },
        { serviceId: service.id, start: v.start, resourceId: v.resourceId },
      );
    } else {
      // Saturday's afternoon sessions, from the shop's own hours: never invented.
      const afternoon = (shop.hours[6] ?? []).filter((s) => s.open >= "14:00");
      const clock = (hhmm: string) =>
        formatClock(today.toZonedDateTime({ timeZone: tz, plainTime: Temporal.PlainTime.from(hhmm) }).toInstant(), tz, lang);
      const answer =
        afternoon.length > 0
          ? t.saturdayOpen(clock(afternoon[0].open), clock(afternoon[afternoon.length - 1].close))
          : t.saturdayClosed;
      make(
        key,
        [greeting, { caller: t.question, receptionist: answer }, { caller: t.thanks, receptionist: p.goodbye().text }],
        {
          reason: t.questionReason,
          agreed: o.agreedNothing(t.questionReason),
          suggestedReply: o.replyCallBack(name),
          outcome: "answered",
          suggested: "low",
        },
      );
    }
  }
  return out;
}
